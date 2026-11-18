import { mapLimit } from "./lib/concurrency";
import { errorMessage } from "./lib/errors";
import type { GitHubClient } from "./lib/github";
import {
  gitBlobId,
  identifyLicenseText,
  indexLicenseFiles,
  isLicenseEligible,
  isNotReRead,
  type LicenseFileRef,
  type LicenseIndex,
  type LicenseQuery,
  licenseFilesFor,
  NO_SAFETY_SCAN,
  notReReadLicense,
  publication,
  resolveLicense,
  resolveLinkTarget,
  type SafetyCleared,
  type TextIdentification,
  WAITING_FOR_SAFETY_SCAN,
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
  type SkillFrontmatter,
  type SkillLocation,
  skillFilePath,
  skillId,
} from "./lib/skillfile";
import {
  type SafetyCache,
  type SafetyCounts,
  type SafetyLimits,
  safetyCleared,
  type ScanContext,
  type ScanOverride,
  scanWaitingSkills,
  summarizeSafety,
} from "./lib/skill-safety";
import { compareText } from "./lib/text";

type ExtractClient = Pick<GitHubClient, "getTree" | "getFileText" | "getFileBytes">;

const SYMLINK_MODE = "120000";

// SKILL.md files read at the same time in one repository.
const SKILL_READ_CONCURRENCY = 8;

// What extractRepo does with each skill folder of a listing.
type ReadPlan = {
  kind: "read";
  location: SkillLocation;
  id: string;
  known: SkillRecord | undefined;
  // Set once the SKILL.md was read: its front matter (null when invalid), or the error.
  outcome?: { frontmatter: SkillFrontmatter | null } | { error: unknown };
};
type ExtractPlan =
  | { kind: "unsafe" }
  | { kind: "reuse"; known: SkillRecord; frontmatterLicense: string | undefined }
  | ReadPlan;

// The front matter license a resolution was computed with: a reused record is not
// downloaded again, so its front matter value comes from its previous evidence.
function frontmatterLicenseOf(license: LicenseResolution): string | undefined {
  const entry = license.evidence.find((evidence) => evidence.kind === "frontmatter");
  return entry?.kind === "frontmatter" ? entry.value : undefined;
}

// Reads and identifies the license files the skills need, skipping blob ids already in the
// cache. The downloaded bytes must have the listed blob id: the tree is listed by branch name
// and the branch can move before the download. A file not read (failed download, other
// content, unresolved link) is never cached and stays unread for this run.
async function readLicenseFiles(
  gh: ExtractClient,
  repo: RepoMeta,
  index: LicenseIndex,
  files: LicenseFileRef[],
  cache: LicenseCache,
): Promise<{ results: Map<string, TextIdentification>; unread: number }> {
  const results = new Map<string, TextIdentification>();
  const failed = new Set<string>();
  const decoder = new TextDecoder("utf-8");
  // The bytes of a file, or undefined when they could not be read or are not the listed blob.
  const download = async (file: LicenseFileRef): Promise<Uint8Array | undefined> => {
    try {
      const bytes = await gh.getFileBytes(repo.fullName, repo.defaultBranch, file.path);
      if (gitBlobId(bytes) === file.blob) return bytes;
      console.warn(`License file ${repo.fullName}/${file.path} changed since the listing: not used`);
    } catch (error) {
      console.warn(`License file ${repo.fullName}/${file.path} not read: ${errorMessage(error)}`);
    }
    return undefined;
  };
  const identify = async (file: LicenseFileRef): Promise<TextIdentification | undefined> => {
    if (Object.hasOwn(cache, file.blob)) return cache[file.blob];
    if (failed.has(file.blob)) return undefined;
    const bytes = await download(file);
    if (bytes === undefined) {
      failed.add(file.blob);
      return undefined;
    }
    const identification = identifyLicenseText(decoder.decode(bytes));
    cache[file.blob] = identification;
    return identification;
  };
  for (const file of files) {
    if (results.has(file.path) || failed.has(`link:${file.path}`)) continue;
    let target: LicenseFileRef | undefined = file;
    if (file.mode === SYMLINK_MODE) {
      // A link's blob holds the target path: follow it one hop, inside the repository.
      const bytes = await download(file);
      target = bytes === undefined ? undefined : resolveLinkTarget(index, file, decoder.decode(bytes));
      if (target === undefined) {
        console.warn(`License link ${repo.fullName}/${file.path} not resolved inside the repository`);
        failed.add(`link:${file.path}`);
        continue;
      }
    }
    const identification = await identify(target);
    if (identification !== undefined) results.set(file.path, identification);
  }
  return { results, unread: failed.size };
}

export async function extractRepo(
  gh: ExtractClient,
  repo: RepoMeta,
  previous: Map<string, SkillRecord>,
  licenseCache: LicenseCache = {},
  // The safety scan of the skills that need it, run once their licenses are resolved. Absent:
  // no skill is scanned.
  safety?: ScanContext,
): Promise<{
  skills: SkillRecord[];
  invalid: number;
  failedDownloads: number;
  licenseFailedDownloads: number;
  truncated: boolean;
  safety?: SafetyCounts;
}> {
  const tree = await gh.getTree(repo.fullName, repo.defaultBranch);
  const skills: SkillRecord[] = [];
  // Records whose license is resolved from this tree, by position in skills.
  const toResolve: { position: number; query: LicenseQuery }[] = [];
  const revision = tree.sha === undefined ? {} : { revision: tree.sha };
  const queue = (record: SkillRecord, frontmatterLicense: string | undefined): void => {
    toResolve.push({
      position: skills.length,
      query: {
        skillPath: record.path,
        frontmatterLicense,
        githubLicense: repo.license,
        truncated: tree.truncated,
        ...revision,
      },
    });
    skills.push(record);
  };
  let invalid = 0;
  let failedDownloads = 0;
  const locations = findSkillLocations(tree.entries);
  // First decide, in listing order, what each skill needs. The SKILL.md files to read are then
  // downloaded a few at a time (they come from raw.githubusercontent.com, outside the API
  // quota: one after the other, a repository of thousands of skills takes hours), and the
  // records are built in listing order, so the result does not depend on the download order.
  const plans = locations.map((location): ExtractPlan => {
    // A folder name with a backtick or a line break could break out of a Markdown code span.
    if (/[\x00-\x1f\x7f`]/.test(location.dir)) return { kind: "unsafe" };
    const id = skillId(repo.fullName, location.dir);
    const known = previous.get(id);
    // A record written before license resolution, or whose SKILL.md was not re-read, has no
    // front matter evidence: its SKILL.md is read again, so its license is never resolved
    // without it.
    const license = known?.license;
    const knowsFrontmatter =
      license !== undefined && !(license.outcome === "ambiguous" && license.unread === "skill-file");
    if (known && license && knowsFrontmatter && known.fingerprint === location.fingerprint) {
      return { kind: "reuse", known, frontmatterLicense: frontmatterLicenseOf(license) };
    }
    return { kind: "read", location, id, known };
  });
  await mapLimit(
    plans.filter((plan): plan is ReadPlan => plan.kind === "read"),
    SKILL_READ_CONCURRENCY,
    async (plan) => {
      try {
        const content = await gh.getFileText(repo.fullName, repo.defaultBranch, skillFilePath(plan.location.dir));
        // Only the front matter is kept: a repository of thousands of skills must not hold all their text.
        plan.outcome = { frontmatter: parseSkillFrontmatter(content) };
      } catch (error) {
        plan.outcome = { error };
      }
    },
  );
  for (const plan of plans) {
    if (plan.kind === "unsafe") {
      console.warn(`Unsafe skill folder name skipped in ${repo.fullName}`);
      invalid += 1;
      continue;
    }
    if (plan.kind === "reuse") {
      queue(plan.known, plan.frontmatterLicense);
      continue;
    }
    const { location, id, known, outcome } = plan;
    if (outcome === undefined || "error" in outcome) {
      console.warn(`Skipping ${id}: ${errorMessage(outcome === undefined ? "not read" : outcome.error)}`);
      // A failed download must not drop a skill that already has a record. Its license is
      // not known for the changed content: not re-read, so neither eligible nor removed.
      failedDownloads += 1;
      if (known) skills.push({ ...known, license: notReReadLicense(tree.sha) });
      continue;
    }
    const frontmatter = outcome.frontmatter;
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
  const { results, unread: licenseFailedDownloads } = await readLicenseFiles(
    gh,
    repo,
    index,
    toResolve.flatMap((item) => licenseFilesFor(index, item.query)),
    licenseCache,
  );
  for (const { position, query } of toResolve) {
    const { license: _previous, ...record } = skills[position];
    skills[position] = { ...record, license: resolveLicense(index, query, (file) => results.get(file.path)) };
  }
  // A truncated listing is partial: skills past the cut are unknown, not deleted. They keep
  // their previous license, or none.
  if (tree.truncated) {
    const listedIds = new Set(locations.map((location) => skillId(repo.fullName, location.dir)));
    for (const record of previous.values()) {
      if (record.repo === repo.fullName && !listedIds.has(record.id)) skills.push(record);
    }
  }
  const scanned =
    safety === undefined
      ? {}
      : { safety: await scanWaitingSkills(gh, repo, { entries: tree.entries, truncated: tree.truncated }, skills, safety) };
  return { skills, invalid, failedDownloads, licenseFailedDownloads, truncated: tree.truncated, ...scanned };
}

export interface ExtractSafetyOptions {
  scanRepos?: readonly string[];
  // Reports by skill id, completed in place. The file is admin-only and not versioned.
  cache: SafetyCache;
  save: (cache: SafetyCache) => Promise<void>;
  limits?: Partial<SafetyLimits>;
  // The owner's decisions about `review` verdicts (data/scan-overrides.yaml).
  overrides?: readonly ScanOverride[];
}

export interface ExtractLicenseOptions {
  // Identified license texts by blob id, completed in place.
  cache: LicenseCache;
  save: (cache: LicenseCache) => Promise<void>;
  // config.filter.allowedLicenses, for the statistics.
  allowed: readonly string[];
  // Whether the safety scan cleared a skill, for the count of skills waiting for it. With
  // `safety`, the scan of this run decides; without either, no skill is cleared.
  isSafetyCleared?: SafetyCleared;
  // Scans the skills that need the scan (license not allowed, missing or unclear).
  safety?: ExtractSafetyOptions;
  // Progress: one line per repository.
  log?: (message: string) => void;
}

export function countLicenses(
  skills: SkillRecord[],
  allowed: readonly string[],
  failedDownloads: number,
  isSafetyCleared: SafetyCleared = NO_SAFETY_SCAN,
): LicenseStats {
  const stats: LicenseStats = {
    identifiedAllowed: 0,
    identifiedNotAllowed: 0,
    custom: 0,
    ambiguous: 0,
    missing: 0,
    notReRead: 0,
    waitingForSafetyScan: 0,
    unresolved: 0,
    failedDownloads,
  };
  for (const skill of skills) {
    const status = publication(skill, allowed, isSafetyCleared);
    if (status.status === "waiting" && status.reason === WAITING_FOR_SAFETY_SCAN) stats.waitingForSafetyScan += 1;
    const outcome = skill.license?.outcome;
    if (outcome === undefined) stats.unresolved += 1;
    else if (isNotReRead(skill.license)) stats.notReRead += 1;
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
  const safety = licenses.safety;
  const safetyContext: ScanContext | undefined =
    safety === undefined
      ? undefined
      : {
          cache: safety.cache,
          allowed: licenses.allowed,
          scanRepos: safety.scanRepos,
          ...(safety.limits ? { limits: safety.limits } : {}),
          checkpoint: () => safety.save(safety.cache),
        };
  const safetyCounts = { scanned: 0, reused: 0, failedDownloads: 0 };

  // Small repositories first: the many repositories of a few skills are done and saved within
  // minutes, and the few registries of thousands of skills (nothing is saved for a repository
  // before it is done) come last, so a stop or a failure there loses the least. The result is
  // sorted by skill id and does not depend on this order. Repositories of the same size keep the
  // order of the list (the sort is stable).
  const sizeOf = (repo: RepoMeta): number => byRepo.get(repo.fullName)?.length ?? 0;
  const ordered = [...repos].sort((a, b) => sizeOf(a) - sizeOf(b));

  for (const [position, repo] of ordered.entries()) {
    try {
      const result = await extractRepo(gh, repo, previousById, licenses.cache, safetyContext);
      licenses.log?.(
        `[${position + 1}/${ordered.length}] ${repo.fullName}: ${result.skills.length} skills${result.safety ? `, ${result.safety.scanned} scanned, ${result.safety.reused} reused, ${result.safety.failedDownloads} not scanned` : ""}`,
      );
      licenseFailedDownloads += result.licenseFailedDownloads;
      if (result.safety) {
        safetyCounts.scanned += result.safety.scanned;
        safetyCounts.reused += result.safety.reused;
        safetyCounts.failedDownloads += result.safety.failedDownloads;
        // Saved after each repository: a long run that stops keeps the reports already made.
        if (result.safety.changed && safety) await safety.save(safety.cache);
      }
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
  const isSafetyCleared =
    licenses.isSafetyCleared ??
    (safety === undefined ? NO_SAFETY_SCAN : safetyCleared(safety.cache, safety.overrides));
  if (safety !== undefined) {
    const summary = summarizeSafety(skills, licenses.allowed, safety.cache, safetyCounts, safety.scanRepos);
    stats.safety = summary.stats;
    // Reports of skills that are gone or no longer need the scan are dropped.
    if (summary.pruned) await safety.save(safety.cache);
  }
  stats.licenses = countLicenses(skills, licenses.allowed, licenseFailedDownloads, isSafetyCleared);
  return { skills, stats };
}
