import { errorMessage } from "./lib/errors";
import type { GitHubClient } from "./lib/github";
import {
  identifyLicenseText,
  indexLicenseFiles,
  isLicenseEligible,
  type LicenseIndex,
  type LicenseQuery,
  licenseFilesFor,
  resolveLicense,
} from "./lib/license";
import type {
  ExtractStats,
  LicenseCache,
  LicenseResolution,
  LicenseStats,
  RepoMeta,
  SkillRecord,
} from "./lib/schemas";
import {
  findSkillLocations,
  parseSkillFrontmatter,
  skillFilePath,
  skillId,
} from "./lib/skillfile";
import { compareText } from "./lib/text";

type ExtractClient = Pick<GitHubClient, "getTree" | "getFileText">;

// The front matter license a resolution was computed with: a reused record is not
// downloaded again, so its front matter value comes from its previous evidence.
function frontmatterLicenseOf(license: LicenseResolution): string | undefined {
  const entry = license.evidence.find((evidence) => evidence.kind === "frontmatter");
  return entry?.kind === "frontmatter" ? entry.value : undefined;
}

// Downloads and identifies the license files the skills need, skipping blob ids already in
// the cache. A failed download is not cached: the file is unidentified for this run only.
async function identifyLicenseFiles(
  gh: ExtractClient,
  repo: RepoMeta,
  index: LicenseIndex,
  queries: LicenseQuery[],
  cache: LicenseCache,
): Promise<number> {
  const failed = new Set<string>();
  for (const query of queries) {
    for (const file of licenseFilesFor(index, query)) {
      if (Object.hasOwn(cache, file.blob) || failed.has(file.blob)) continue;
      try {
        const text = await gh.getFileText(repo.fullName, repo.defaultBranch, file.path);
        cache[file.blob] = { spdx: identifyLicenseText(text) };
      } catch (error) {
        console.warn(`License file ${repo.fullName}/${file.path} not read: ${errorMessage(error)}`);
        failed.add(file.blob);
      }
    }
  }
  return failed.size;
}

export async function extractRepo(
  gh: ExtractClient,
  repo: RepoMeta,
  previous: Map<string, SkillRecord>,
  licenseCache: LicenseCache = {},
): Promise<{
  skills: SkillRecord[];
  invalid: number;
  failedDownloads: number;
  licenseFailedDownloads: number;
  truncated: boolean;
}> {
  const tree = await gh.getTree(repo.fullName, repo.defaultBranch);
  const skills: SkillRecord[] = [];
  // Records whose license is resolved from this tree, by position in skills.
  const toResolve: { position: number; query: LicenseQuery }[] = [];
  const queue = (record: SkillRecord, frontmatterLicense: string | undefined): void => {
    toResolve.push({
      position: skills.length,
      query: {
        skillPath: record.path,
        frontmatterLicense,
        githubLicense: repo.license,
        truncated: tree.truncated,
      },
    });
    skills.push(record);
  };
  let invalid = 0;
  let failedDownloads = 0;
  const locations = findSkillLocations(tree.entries);
  for (const location of locations) {
    // A folder name with a backtick or a line break could break out of a Markdown code span.
    if (/[\x00-\x1f\x7f`]/.test(location.dir)) {
      console.warn(`Unsafe skill folder name skipped in ${repo.fullName}`);
      invalid += 1;
      continue;
    }
    const id = skillId(repo.fullName, location.dir);
    const known = previous.get(id);
    // A record written before license resolution has no front matter evidence: its
    // SKILL.md is read again once, so its license is never resolved without it.
    if (known && known.fingerprint === location.fingerprint && known.license) {
      queue(known, frontmatterLicenseOf(known.license));
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
      // A failed download must not drop a skill that already has a record; it keeps its
      // previous license, or none.
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
    queue(
      {
        id,
        repo: repo.fullName,
        path: location.dir,
        name: frontmatter.name,
        description: frontmatter.description,
        fingerprint: location.fingerprint,
        files: location.files,
      },
      frontmatter.license,
    );
  }
  // Every listed skill is resolved again from the current tree: a license file outside the
  // skill folder can change while the skill's fingerprint does not.
  const index = indexLicenseFiles(tree.entries);
  const licenseFailedDownloads = await identifyLicenseFiles(
    gh,
    repo,
    index,
    toResolve.map((item) => item.query),
    licenseCache,
  );
  const spdxOfBlob = (blob: string): string | null =>
    Object.hasOwn(licenseCache, blob) ? licenseCache[blob].spdx : null;
  for (const { position, query } of toResolve) {
    const { license: _previous, ...record } = skills[position];
    skills[position] = { ...record, license: resolveLicense(index, query, spdxOfBlob) };
  }
  // A truncated listing is partial: skills past the cut are unknown, not deleted. They keep
  // their previous license, or none.
  if (tree.truncated) {
    const listedIds = new Set(locations.map((location) => skillId(repo.fullName, location.dir)));
    for (const record of previous.values()) {
      if (record.repo === repo.fullName && !listedIds.has(record.id)) skills.push(record);
    }
  }
  return { skills, invalid, failedDownloads, licenseFailedDownloads, truncated: tree.truncated };
}

export interface ExtractLicenseOptions {
  // Identified license texts by blob id, completed in place.
  cache: LicenseCache;
  save: (cache: LicenseCache) => Promise<void>;
  // config.filter.allowedLicenses, for the statistics.
  allowed: readonly string[];
}

export function countLicenses(
  skills: SkillRecord[],
  allowed: readonly string[],
  failedDownloads: number,
): LicenseStats {
  const stats: LicenseStats = {
    identifiedAllowed: 0,
    identifiedNotAllowed: 0,
    custom: 0,
    ambiguous: 0,
    missing: 0,
    unresolved: 0,
    failedDownloads,
  };
  for (const skill of skills) {
    const outcome = skill.license?.outcome;
    if (outcome === undefined) stats.unresolved += 1;
    else if (outcome !== "identified") stats[outcome] += 1;
    else if (isLicenseEligible(skill.license, allowed)) stats.identifiedAllowed += 1;
    else stats.identifiedNotAllowed += 1;
  }
  return stats;
}

export async function runExtract(
  gh: ExtractClient,
  repos: RepoMeta[],
  previous: SkillRecord[],
  save: (skills: SkillRecord[]) => Promise<void>,
  licenses: ExtractLicenseOptions = { cache: {}, save: async () => {}, allowed: [] },
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
  let licenseFailedDownloads = 0;
  let savedLicenseCount = Object.keys(licenses.cache).length;

  for (const repo of repos) {
    try {
      const result = await extractRepo(gh, repo, previousById, licenses.cache);
      licenseFailedDownloads += result.licenseFailedDownloads;
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
    // The cache only grows: a new entry means something to save.
    const licenseCount = Object.keys(licenses.cache).length;
    if (licenseCount !== savedLicenseCount) {
      await licenses.save(licenses.cache);
      savedLicenseCount = licenseCount;
    }
  }
  const skills = all();
  stats.skills = skills.length;
  stats.licenses = countLicenses(skills, licenses.allowed, licenseFailedDownloads);
  return { skills, stats };
}
