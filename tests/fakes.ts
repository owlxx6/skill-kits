import { createHash } from "node:crypto";
import type { GitHubClient } from "../pipeline/lib/github";
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

  constructor(
    private readonly repos: FakeRepo[],
    private readonly topics: Record<string, string[]> = {},
  ) {}

  private find(fullName: string): FakeRepo | undefined {
    return this.repos.find(
      (repo) => repo.meta.fullName.toLowerCase() === fullName.toLowerCase(),
    );
  }

  async searchReposByTopic(topic: string): Promise<string[]> {
    return this.topics[topic] ?? [];
  }

  async getRepo(fullName: string): Promise<RepoMeta | null> {
    return this.find(fullName)?.meta ?? null;
  }

  async getTree(fullName: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    if (this.failTreeFor.has(fullName)) throw new Error(`network error for ${fullName}`);
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
    return { entries, truncated: false };
  }

  async getFileText(fullName: string, _ref: string, filePath: string): Promise<string> {
    this.fileReads.push(`${fullName}/${filePath}`);
    const content = this.find(fullName)?.files[filePath];
    if (content === undefined) throw new Error(`missing file ${fullName}/${filePath}`);
    return content;
  }
}
