import type { GitHubClient } from "./lib/github";
import type { Sources } from "./lib/schemas";

export const DRY_RUN_REPOS = 5;

export async function discover(
  gh: Pick<GitHubClient, "searchReposByTopic">,
  sources: Sources,
  minStars: number,
  dryRun: boolean,
): Promise<string[]> {
  const names = dryRun ? sources.repos.slice(0, DRY_RUN_REPOS) : [...sources.repos];
  if (!dryRun) {
    for (const topic of sources.topics) {
      names.push(...(await gh.searchReposByTopic(topic, minStars, sources.maxSearchPages)));
    }
  }
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
