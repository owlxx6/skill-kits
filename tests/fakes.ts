import { createHash } from "node:crypto";
import type { GitHubClient } from "../pipeline/lib/github";
import { gitBlobId } from "../pipeline/lib/license";
import type { LlmClient, LlmResult, ReviewInput, TriageItem } from "../pipeline/lib/llm";
import type { RepoMeta } from "../pipeline/lib/schemas";
import type { TreeEntry } from "../pipeline/lib/skillfile";

export interface FakeRepo {
  meta: RepoMeta;
  files: Record<string, string>;
  // Symbolic links: path -> link text (the target path), stored as a blob of mode 120000.
  links?: Record<string, string>;
}

const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex");
export const blobIdOf = (text: string): string => gitBlobId(new TextEncoder().encode(text));

// In-memory GitHub. Blob ids are git blob ids of the contents and tree ids derive from them,
// so editing a file in a test changes the fingerprint of its folder.
export class FakeGitHub implements GitHubClient {
  fileReads: string[] = [];
  // owner/repo/path -> content served instead of the listed one, as when a branch moves
  // between the tree listing and the download.
  serveInstead = new Map<string, string>();
  failTreeFor = new Set<string>();
  truncateTreeFor = new Set<string>();
  failFileFor = new Set<string>();
  failRepoFor = new Set<string>();
  searchCalls: string[] = [];

  constructor(
    private readonly repos: FakeRepo[],
    private readonly topics: Record<string, string[]> = {},
    // Maps an old repository name to its current name, like a GitHub redirect.
    private readonly redirects: Record<string, string> = {},
  ) {}

  private inSet(set: Set<string>, fullName: string): boolean {
    const wanted = fullName.toLowerCase();
    return [...set].some((name) => name.toLowerCase() === wanted);
  }

  private find(fullName: string): FakeRepo | undefined {
    return this.repos.find(
      (repo) => repo.meta.fullName.toLowerCase() === fullName.toLowerCase(),
    );
  }

  async searchReposByTopic(topic: string): Promise<string[]> {
    this.searchCalls.push(topic);
    return this.topics[topic] ?? [];
  }

  async getRepo(fullName: string): Promise<RepoMeta | null> {
    if (this.inSet(this.failRepoFor, fullName)) throw new Error(`network error for ${fullName}`);
    const wanted = fullName.toLowerCase();
    const target = Object.entries(this.redirects).find(([old]) => old.toLowerCase() === wanted)?.[1];
    return this.find(target ?? fullName)?.meta ?? null;
  }

  async getTree(fullName: string): Promise<{ entries: TreeEntry[]; truncated: boolean; sha?: string }> {
    if (this.inSet(this.failTreeFor, fullName)) throw new Error(`network error for ${fullName}`);
    const repo = this.find(fullName);
    if (!repo) return { entries: [], truncated: false };
    const links = Object.entries(repo.links ?? {});
    const files = [...Object.entries(repo.files), ...links];
    const linkPaths = new Set(links.map(([filePath]) => filePath));
    const entries: TreeEntry[] = [];
    const dirs = new Set<string>();
    for (const [filePath, content] of files) {
      entries.push(
        linkPaths.has(filePath)
          ? { path: filePath, type: "blob", sha: blobIdOf(content), mode: "120000" }
          : { path: filePath, type: "blob", sha: blobIdOf(content), mode: "100644" },
      );
      const parts = filePath.split("/");
      for (let depth = 1; depth < parts.length; depth += 1) {
        dirs.add(parts.slice(0, depth).join("/"));
      }
    }
    for (const dir of dirs) {
      const inside = files
        .filter(([filePath]) => filePath.startsWith(`${dir}/`))
        .map(([filePath, content]) => `${filePath}:${blobIdOf(content)}`)
        .sort()
        .join("\n");
      entries.push({ path: dir, type: "tree", sha: sha1(inside), mode: "040000" });
    }
    const all = files.map(([filePath, content]) => `${filePath}:${blobIdOf(content)}`).sort().join("\n");
    return { entries, truncated: this.inSet(this.truncateTreeFor, fullName), sha: sha1(all) };
  }

  async getFileText(fullName: string, _ref: string, filePath: string): Promise<string> {
    this.fileReads.push(`${fullName}/${filePath}`);
    if (this.inSet(this.failFileFor, `${fullName}/${filePath}`)) {
      throw new Error(`network error for ${fullName}/${filePath}`);
    }
    const repo = this.find(fullName);
    const content =
      this.serveInstead.get(`${fullName}/${filePath}`) ?? repo?.files[filePath] ?? repo?.links?.[filePath];
    if (content === undefined) throw new Error(`missing file ${fullName}/${filePath}`);
    return content;
  }

  async getFileBytes(fullName: string, ref: string, filePath: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.getFileText(fullName, ref, filePath));
  }
}

export const REFUSAL = Symbol("refusal");

// Scripted model. onReview receives the attempt number for that skill name (1, 2, ...)
// and returns the raw data, or REFUSAL to simulate a refusal. Either callback may throw.
export class FakeLlm implements LlmClient {
  triageCalls: TriageItem[][] = [];
  reviewCalls: ReviewInput[] = [];

  constructor(
    private readonly onTriage: (items: TriageItem[]) => unknown,
    private readonly onReview: (input: ReviewInput, attempt: number) => unknown,
  ) {}

  async triage(items: TriageItem[]): Promise<LlmResult> {
    this.triageCalls.push(items);
    return {
      data: this.onTriage(items),
      usage: { inputTokens: 100, outputTokens: 10 },
      refusal: false,
    };
  }

  async review(input: ReviewInput): Promise<LlmResult> {
    this.reviewCalls.push(input);
    const attempt = this.reviewCalls.filter((call) => `${call.repo}:${call.name}` === `${input.repo}:${input.name}`).length;
    const data = this.onReview(input, attempt);
    const usage = { inputTokens: 1000, outputTokens: 100 };
    if (data === REFUSAL) return { data: null, usage, refusal: true };
    return { data, usage, refusal: false };
  }
}
