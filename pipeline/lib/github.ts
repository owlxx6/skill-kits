import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import type { RepoMeta } from "./schemas";
import type { TreeEntry } from "./skillfile";

export interface GitHubClient {
  searchReposByTopic(topic: string, minStars: number, maxPages: number): Promise<string[]>;
  getRepo(fullName: string): Promise<RepoMeta | null>;
  getTree(fullName: string, ref: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  getFileText(fullName: string, ref: string, filePath: string): Promise<string>;
}

const ThrottledOctokit = Octokit.plugin(throttling);
const RAW_ATTEMPTS = 3;
const MAX_FILE_BYTES = 1_000_000;

function httpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

const encodePath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createGitHubClient(token: string | undefined): GitHubClient {
  const octokit = new ThrottledOctokit({
    auth: token,
    throttle: {
      // On a rate limit, wait the time GitHub asks for and retry, at most twice.
      onRateLimit: (retryAfter: number, _options: unknown, _octokit: unknown, retryCount: number) => {
        console.warn(`GitHub rate limit reached, waiting ${retryAfter}s (retry ${retryCount + 1})`);
        return retryCount < 2;
      },
      onSecondaryRateLimit: (
        retryAfter: number,
        _options: unknown,
        _octokit: unknown,
        retryCount: number,
      ) => {
        console.warn(`GitHub secondary rate limit, waiting ${retryAfter}s (retry ${retryCount + 1})`);
        return retryCount < 2;
      },
    },
  });

  return {
    async searchReposByTopic(topic, minStars, maxPages) {
      const names: string[] = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const { data } = await octokit.rest.search.repos({
          q: `topic:${topic} stars:>=${minStars} archived:false`,
          sort: "stars",
          order: "desc",
          per_page: 100,
          page,
        });
        names.push(...data.items.map((item) => item.full_name));
        if (data.items.length < 100) break;
      }
      return names;
    },

    async getRepo(fullName) {
      const [owner, repo] = fullName.split("/");
      try {
        const { data } = await octokit.rest.repos.get({ owner, repo });
        return {
          fullName: data.full_name,
          url: data.html_url,
          description: data.description ?? null,
          stars: data.stargazers_count,
          forks: data.forks_count,
          license: data.license?.spdx_id ?? null,
          pushedAt: data.pushed_at ?? "",
          defaultBranch: data.default_branch,
          archived: data.archived,
        };
      } catch (error) {
        // 404: deleted or private. 451: taken down. Both mean "no longer available".
        const status = httpStatus(error);
        if (status === 404 || status === 451) return null;
        throw error;
      }
    },

    async getTree(fullName, ref) {
      const [owner, repo] = fullName.split("/");
      try {
        const { data } = await octokit.rest.git.getTree({
          owner,
          repo,
          tree_sha: ref,
          recursive: "1",
        });
        const entries: TreeEntry[] = [];
        for (const item of data.tree) {
          if (!item.path || !item.sha) continue;
          if (item.type !== "blob" && item.type !== "tree") continue;
          entries.push({ path: item.path, type: item.type, sha: item.sha });
        }
        return { entries, truncated: data.truncated };
      } catch (error) {
        // 404: branch missing. 409: empty repository. Both mean "no files".
        const status = httpStatus(error);
        if (status === 404 || status === 409) return { entries: [], truncated: false };
        throw error;
      }
    },

    // File contents come from raw.githubusercontent.com so they do not count
    // against the API quota, which is small for the token GitHub Actions provides.
    async getFileText(fullName, ref, filePath) {
      const url = `https://raw.githubusercontent.com/${fullName}/${encodePath(ref)}/${encodePath(filePath)}`;
      let lastStatus = 0;
      for (let attempt = 1; attempt <= RAW_ATTEMPTS; attempt += 1) {
        const response = await fetch(url);
        if (response.ok) {
          const declared = Number(response.headers.get("content-length"));
          if (response.headers.has("content-length") && declared > MAX_FILE_BYTES) {
            throw new Error(`${url} is larger than ${MAX_FILE_BYTES} bytes`);
          }
          const text = await response.text();
          if (text.length > MAX_FILE_BYTES) {
            throw new Error(`${url} is larger than ${MAX_FILE_BYTES} bytes`);
          }
          return text;
        }
        lastStatus = response.status;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) break;
        await sleep(attempt * 2000);
      }
      throw new Error(`GET ${url} failed with status ${lastStatus}`);
    },
  };
}
