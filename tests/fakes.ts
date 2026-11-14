import { createHash } from "node:crypto";
import type { GitHubClient } from "../pipeline/lib/github";
import type { LlmClient, LlmResult, ReviewInput, TriageItem } from "../pipeline/lib/llm";
import type { RepoMeta } from "../pipeline/lib/schemas";
import type { TreeEntry } from "../pipeline/lib/skillfile";

export interface FakeRepo {
  meta: RepoMeta;
  files: Record<string, string>;
}

const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex");

// In-memory GitHub. Tree ids are derived from file contents, like git does,
// so editing a file in a test changes the fingerprint of its folder.
export class FakeGitHub implements GitHubClient {
  fileReads: string[] = [];
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

  async getTree(fullName: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    if (this.inSet(this.failTreeFor, fullName)) throw new Error(`network error for ${fullName}`);
    const repo = this.find(fullName);
    if (!repo) return { entries: [], truncated: false };
    const files = Object.entries(repo.files);
    const entries: TreeEntry[] = [];
    const dirs = new Set<string>();
    for (const [filePath, content] of files) {
      entries.push({ path: filePath, type: "blob", sha: sha1(content) });
      const parts = filePath.split("/");
      for (let depth = 1; depth < parts.length; depth += 1) {
        dirs.add(parts.slice(0, depth).join("/"));
      }
    }
    for (const dir of dirs) {
      const inside = files
        .filter(([filePath]) => filePath.startsWith(`${dir}/`))
        .map(([filePath, content]) => `${filePath}:${sha1(content)}`)
        .sort()
        .join("\n");
      entries.push({ path: dir, type: "tree", sha: sha1(inside) });
    }
    return { entries, truncated: this.inSet(this.truncateTreeFor, fullName) };
  }

  async getFileText(fullName: string, _ref: string, filePath: string): Promise<string> {
    this.fileReads.push(`${fullName}/${filePath}`);
    if (this.inSet(this.failFileFor, `${fullName}/${filePath}`)) {
      throw new Error(`network error for ${fullName}/${filePath}`);
    }
    const content = this.find(fullName)?.files[filePath];
    if (content === undefined) throw new Error(`missing file ${fullName}/${filePath}`);
    return content;
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
    const attempt = this.reviewCalls.filter((call) => call.name === input.name).length;
    const data = this.onReview(input, attempt);
    const usage = { inputTokens: 1000, outputTokens: 100 };
    if (data === REFUSAL) return { data: null, usage, refusal: true };
    return { data, usage, refusal: false };
  }
}
