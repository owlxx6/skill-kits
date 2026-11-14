import { errorMessage } from "./lib/errors";
import type { GitHubClient } from "./lib/github";
import { compareText } from "./lib/text";
import { RepoMetaSchema } from "./lib/schemas";
import type { Config, FilteredRepo, RepoMeta } from "./lib/schemas";
import { daysBetween } from "./lib/scores";

export type FilterVerdict = { ok: true } | { ok: false; reason: string };

// pushedAt is the last push to any branch: the closest signal GitHub gives
// for "last commit" without one more request per repo.
export function checkRepo(repo: RepoMeta, filter: Config["filter"], now: Date): FilterVerdict {
  if (repo.archived) return { ok: false, reason: "archived" };
  if (!repo.license || !filter.allowedLicenses.includes(repo.license)) {
    return { ok: false, reason: `license ${repo.license ?? "none"} not allowed` };
  }
  if (repo.stars < filter.minStars) {
    return { ok: false, reason: `stars ${repo.stars} < ${filter.minStars}` };
  }
  if (!RepoMetaSchema.shape.pushedAt.safeParse(repo.pushedAt).success) {
    return { ok: false, reason: "no valid push date" };
  }
  const days = daysBetween(repo.pushedAt, now);
  if (days > filter.maxDaysSinceLastCommit) {
    return { ok: false, reason: `last push ${Math.ceil(days)} days ago (limit ${filter.maxDaysSinceLastCommit})` };
  }
  return { ok: true };
}

export async function filterRepos(
  gh: Pick<GitHubClient, "getRepo">,
  candidates: string[],
  filter: Config["filter"],
  now: Date,
): Promise<{ repos: RepoMeta[]; filtered: FilteredRepo[] }> {
  const repos: RepoMeta[] = [];
  const filtered: FilteredRepo[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    let repo: RepoMeta | null;
    try {
      repo = await gh.getRepo(candidate);
    } catch (error) {
      throw new Error(`filter: getRepo ${candidate} failed: ${errorMessage(error)}`, { cause: error });
    }
    if (!repo) {
      filtered.push({ fullName: candidate, reason: "not found" });
      continue;
    }
    const key = repo.fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const verdict = checkRepo(repo, filter, now);
    if (verdict.ok) repos.push(repo);
    else {
      // A renamed or transferred repository is shown with the name listed in sources.yaml.
      const renamed = key !== candidate.toLowerCase();
      const fullName = renamed ? `${repo.fullName} (listed as ${candidate})` : repo.fullName;
      filtered.push({ fullName, reason: verdict.reason });
    }
  }
  repos.sort((a, b) => compareText(a.fullName, b.fullName));
  filtered.sort((a, b) => compareText(a.fullName, b.fullName));
  return { repos, filtered };
}
