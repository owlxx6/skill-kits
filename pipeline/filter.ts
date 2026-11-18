import { errorMessage } from "./lib/errors";
import type { GitHubClient } from "./lib/github";
import { compareText } from "./lib/text";
import { RepoMetaSchema } from "./lib/schemas";
import type { Config, FilteredRepo, RenamedRepo, RepoMeta } from "./lib/schemas";

export type FilterVerdict = { ok: true } | { ok: false; reason: string };

// pushedAt is the last push to any branch: the closest signal GitHub gives
// for "last commit" without one more request per repo.
// No license check here: licenses are resolved per skill after extraction, and
// RepoMeta.license is only evidence (docs/LICENSE-RESOLUTION.md).
// minStars bounds topic discovery only: a repository nominated in sources.yaml is never
// rejected for its stars.
export function checkRepo(
  repo: RepoMeta,
  filter: Config["filter"],
  now: Date,
  nominated = false,
): FilterVerdict {
  if (repo.archived) return { ok: false, reason: "archived" };
  if (!nominated && repo.stars < filter.minStars) {
    return { ok: false, reason: `stars ${repo.stars} < ${filter.minStars}` };
  }
  if (!RepoMetaSchema.shape.pushedAt.safeParse(repo.pushedAt).success) {
    return { ok: false, reason: "no valid push date" };
  }
  // Last-push age is metadata, not evidence of usefulness or grounds for rejection.
  return { ok: true };
}

export async function filterRepos(
  gh: Pick<GitHubClient, "getRepo">,
  candidates: string[],
  filter: Config["filter"],
  now: Date,
  // Repositories listed in sources.yaml, compared case-insensitively.
  nominated: ReadonlySet<string> = new Set(),
): Promise<{ repos: RepoMeta[]; filtered: FilteredRepo[]; renamed: RenamedRepo[] }> {
  const nominatedLower = new Set([...nominated].map((name) => name.toLowerCase()));
  const repos: RepoMeta[] = [];
  const filtered: FilteredRepo[] = [];
  const renamed: RenamedRepo[] = [];
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
    // A nominated repository that was renamed is still listed under its old name.
    const isNominated = nominatedLower.has(candidate.toLowerCase()) || nominatedLower.has(key);
    const verdict = checkRepo(repo, filter, now, isNominated);
    // Renamed or transferred: GitHub followed a redirect to another name.
    const moved = key !== candidate.toLowerCase();
    if (verdict.ok) {
      repos.push(repo);
      // Approved ids still carry the old name: the curator has to update them.
      if (moved) renamed.push({ from: candidate, to: repo.fullName });
    } else {
      // A renamed or transferred repository is shown with the name listed in sources.yaml.
      const fullName = moved ? `${repo.fullName} (listed as ${candidate})` : repo.fullName;
      filtered.push({ fullName, reason: verdict.reason });
    }
  }
  repos.sort((a, b) => compareText(a.fullName, b.fullName));
  filtered.sort((a, b) => compareText(a.fullName, b.fullName));
  renamed.sort((a, b) => compareText(a.from, b.from));
  return { repos, filtered, renamed };
}
