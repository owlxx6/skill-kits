import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import { errorMessage } from "./errors";
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
const API_ATTEMPTS = 3;
const RAW_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 2000;
const MAX_FILE_BYTES = 1_000_000;

function httpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function hasBlockField(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("response" in error)) return false;
  const response = (error as { response: unknown }).response;
  if (typeof response !== "object" || response === null || !("data" in response)) return false;
  const data = (response as { data: unknown }).data;
  return typeof data === "object" && data !== null && "block" in data;
}

const encodePath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createGitHubClient(
  token: string | undefined,
  options: { retryDelayMs?: number } = {},
): GitHubClient {
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  // Retries network errors and 5xx responses. Rate limits are handled by the throttling plugin.
  async function withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await call();
      } catch (error) {
        const status = httpStatus(error);
        const retryable = status === undefined || status >= 500;
        if (!retryable || attempt >= API_ATTEMPTS) throw error;
        await sleep(attempt * retryDelayMs);
      }
    }
  }

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
        const { data } = await withRetry(() => octokit.rest.search.repos({
          q: `topic:${topic} stars:>=${minStars} archived:false`,
          sort: "stars",
          order: "desc",
          per_page: 100,
          page,
        }));
        if (data.incomplete_results) {
          throw new Error(`GitHub search for topic ${topic} returned incomplete results (page ${page})`);
        }
        names.push(...data.items.map((item) => item.full_name));
        if (data.items.length < 100) break;
      }
      return names;
    },

    async getRepo(fullName) {
      const [owner, repo] = fullName.split("/");
      try {
        const { data } = await withRetry(() => octokit.rest.repos.get({ owner, repo }));
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
        // 403 with a "block" field: blocked for a terms-of-service violation.
        // Any other 403 (such as a rate limit) must still fail the run.
        if (status === 403 && hasBlockField(error)) return null;
        throw error;
      }
    },

    async getTree(fullName, ref) {
      const [owner, repo] = fullName.split("/");
      try {
        const { data } = await withRetry(() =>
          octokit.rest.git.getTree({ owner, repo, tree_sha: ref, recursive: "1" }),
        );
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
      let lastError = "";
      for (let attempt = 1; attempt <= RAW_ATTEMPTS; attempt += 1) {
        let response: Response | undefined;
        try {
          response = await fetch(url, { signal: AbortSignal.timeout(RAW_TIMEOUT_MS) });
        } catch (error) {
          lastError = errorMessage(error);
        }
        if (response?.ok) {
          const declared = Number(response.headers.get("content-length"));
          if (response.headers.has("content-length") && declared > MAX_FILE_BYTES) {
            await response.body?.cancel();
            throw new Error(`${url} is larger than ${MAX_FILE_BYTES} bytes`);
          }
          let text: string | undefined;
          try {
            text = await response.text();
          } catch (error) {
            lastError = errorMessage(error);
          }
          if (text !== undefined) {
            if (text.length > MAX_FILE_BYTES) {
              throw new Error(`${url} is larger than ${MAX_FILE_BYTES} bytes`);
            }
            return text;
          }
        } else if (response) {
          lastStatus = response.status;
          lastError = "";
          await response.body?.cancel();
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable) break;
        }
        if (attempt < RAW_ATTEMPTS) await sleep(attempt * retryDelayMs);
      }
      if (lastError) throw new Error(`GET ${url} failed: ${lastError}`);
      throw new Error(`GET ${url} failed with status ${lastStatus}`);
    },
  };
}
