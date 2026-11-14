import { errorMessage } from "./lib/errors";
import type { GitHubClient } from "./lib/github";
import type { ExtractStats, RepoMeta, SkillRecord } from "./lib/schemas";
import {
  findSkillLocations,
  parseSkillFrontmatter,
  skillFilePath,
  skillId,
} from "./lib/skillfile";
import { compareText } from "./lib/text";

type ExtractClient = Pick<GitHubClient, "getTree" | "getFileText">;

export async function extractRepo(
  gh: ExtractClient,
  repo: RepoMeta,
  previous: Map<string, SkillRecord>,
): Promise<{
  skills: SkillRecord[];
  invalid: number;
  failedDownloads: number;
  truncated: boolean;
}> {
  const tree = await gh.getTree(repo.fullName, repo.defaultBranch);
  const skills: SkillRecord[] = [];
  let invalid = 0;
  let failedDownloads = 0;
  const locations = findSkillLocations(tree.entries);
  for (const location of locations) {
    const id = skillId(repo.fullName, location.dir);
    const known = previous.get(id);
    if (known && known.fingerprint === location.fingerprint) {
      skills.push(known);
      continue;
    }
    let content: string;
    try {
      content = await gh.getFileText(
        repo.fullName,
        repo.defaultBranch,
        skillFilePath(location.dir),
      );
    } catch (error) {
      console.warn(`Skipping ${id}: ${errorMessage(error)}`);
      // A failed download must not drop a skill that already has a record.
      failedDownloads += 1;
      if (known) skills.push(known);
      continue;
    }
    const frontmatter = parseSkillFrontmatter(content);
    if (!frontmatter) {
      console.warn(`Invalid SKILL.md front matter: ${id}`);
      invalid += 1;
      continue;
    }
    skills.push({
      id,
      repo: repo.fullName,
      path: location.dir,
      name: frontmatter.name,
      description: frontmatter.description,
      fingerprint: location.fingerprint,
      files: location.files,
    });
  }
  // A truncated listing is partial: skills past the cut are unknown, not deleted.
  if (tree.truncated) {
    const listedIds = new Set(locations.map((location) => skillId(repo.fullName, location.dir)));
    for (const record of previous.values()) {
      if (record.repo === repo.fullName && !listedIds.has(record.id)) skills.push(record);
    }
  }
  return { skills, invalid, failedDownloads, truncated: tree.truncated };
}

export async function runExtract(
  gh: ExtractClient,
  repos: RepoMeta[],
  previous: SkillRecord[],
  save: (skills: SkillRecord[]) => Promise<void>,
): Promise<{ skills: SkillRecord[]; stats: ExtractStats }> {
  const previousById = new Map(previous.map((skill) => [skill.id, skill]));
  const listed = new Set(repos.map((repo) => repo.fullName));
  const byRepo = new Map<string, SkillRecord[]>();
  for (const skill of previous) {
    if (!listed.has(skill.repo)) continue;
    const list = byRepo.get(skill.repo) ?? [];
    list.push(skill);
    byRepo.set(skill.repo, list);
  }
  const stats: ExtractStats = {
    repos: 0,
    skills: 0,
    invalid: 0,
    failedDownloads: 0,
    truncatedRepos: [],
    failedRepos: [],
  };
  const all = (): SkillRecord[] =>
    [...byRepo.values()].flat().sort((a, b) => compareText(a.id, b.id));

  for (const repo of repos) {
    try {
      const result = await extractRepo(gh, repo, previousById);
      if (result.skills.length === 0 && (byRepo.get(repo.fullName)?.length ?? 0) > 0) {
        console.warn(`No skill found anymore in ${repo.fullName}: its records are dropped`);
      }
      byRepo.set(repo.fullName, result.skills);
      stats.repos += 1;
      stats.invalid += result.invalid;
      stats.failedDownloads += result.failedDownloads;
      if (result.truncated) stats.truncatedRepos.push(repo.fullName);
    } catch (error) {
      // Keep this repo's previous records: one network error must not empty the catalog.
      stats.failedRepos.push({ repo: repo.fullName, error: errorMessage(error) });
    }
    await save(all());
  }
  const skills = all();
  stats.skills = skills.length;
  return { skills, stats };
}
