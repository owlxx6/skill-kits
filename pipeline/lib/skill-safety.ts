import { createHash } from "node:crypto";
import { z } from "zod";
import { mapLimit } from "./concurrency";
import { errorMessage } from "./errors";
import type { GitHubClient } from "./github";
import {
  gitBlobId,
  NO_SAFETY_SCAN,
  publication,
  type SafetyCleared,
  WAITING_FOR_SAFETY_SCAN,
} from "./license";
import { isMediaPath, SAFETY_RULES_VERSION, type SafetyInputFile, scanSkillFiles } from "./safety";
import type { RepoMeta, SafetyStats, SkillRecord } from "./schemas";
import { listSkillFiles, type SkillFileEntry, type TreeEntry } from "./skillfile";
import { readYamlFile } from "./store";
import { compareText } from "./text";

// Wires the static scanner (pipeline/lib/safety.ts, docs/SAFETY-SCAN.md) into the extract
// step: it downloads the files of the skills that need the scan, scans them, and keeps the
// reports in a cache the review and rank steps read through isSafetyCleared.
//
// The reports hold excerpts of third-party files: they are admin-only. They live in
// data/cache/safety.json, which is not versioned, and never reach catalog.json or the
// public summary (which only gets counts).

const gitObjectId = z.string().regex(/^[0-9a-f]{40,64}$/, "expected a git object id");

const SafetyFindingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["info", "warn", "block"]),
  path: z.string(),
  line: z.number().int().min(0),
  excerpt: z.string(),
  reason: z.string(),
});

// What the scan found in one skill. fingerprint is the skill record's: an entry of another
// fingerprint is stale. contentId covers every scanned file (path and git blob id) and the
// limits: it catches a change the fingerprint misses (a root skill's fingerprint only tracks
// its SKILL.md).
export const SafetyEntrySchema = z.object({
  fingerprint: gitObjectId,
  contentId: z.string().regex(/^[0-9a-f]{64}$/),
  verdict: z.enum(["clear", "review", "block"]),
  scannedFiles: z.number().int().min(0),
  skippedFiles: z.number().int().min(0),
  // Warn and block findings only: info findings never change a verdict, they are counted.
  findings: z.array(SafetyFindingSchema),
  infoFindings: z.number().int().min(0),
});
export type SafetyEntry = z.infer<typeof SafetyEntrySchema>;

// By skill id.
export type SafetyCache = Record<string, SafetyEntry>;

export const SafetyCacheFileSchema = z.object({
  rulesVersion: z.number().int(),
  entries: z.record(z.string(), SafetyEntrySchema),
});
export type SafetyCacheFile = z.infer<typeof SafetyCacheFileSchema>;

// The cached entries when they were made by the current rules. Another version, or no file:
// an empty cache, so every skill is scanned again. A file of the current version with an
// invalid entry is an error, like any corrupted cache.
export function readSafetyCache(data: unknown): SafetyCache {
  const versioned = z.object({ rulesVersion: z.number().int() }).safeParse(data);
  if (!versioned.success || versioned.data.rulesVersion !== SAFETY_RULES_VERSION) return {};
  return SafetyCacheFileSchema.parse(data).entries;
}

// Sorted by skill id so the file only changes where a skill changed.
export function safetyCacheFile(cache: SafetyCache): SafetyCacheFile {
  return {
    rulesVersion: SAFETY_RULES_VERSION,
    entries: Object.fromEntries(Object.entries(cache).sort(([a], [b]) => compareText(a, b))),
  };
}

// The owner's decision about one skill whose scan verdict is `review`: its findings were read
// and judged harmless (documentation that names a tool, a data file that cannot be scanned).
// It binds to the exact content that was read: the skill fingerprint and the scan's contentId.
// A change to either makes the decision stale, and the skill waits for a new look. A `block`
// verdict is never overridden. The file is versioned and public, so it holds no finding text:
// the reports stay admin-only.
export const ScanOverrideSchema = z.object({
  id: z.string().min(1),
  fingerprint: gitObjectId,
  contentId: z.string().regex(/^[0-9a-f]{64}$/),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date"),
  // A short neutral category, not a quote from the reviewed files.
  basis: z.string().min(1).max(120),
});
export type ScanOverride = z.infer<typeof ScanOverrideSchema>;

export const ScanOverridesFileSchema = z
  .object({ overrides: z.array(ScanOverrideSchema) })
  .refine(
    (file) => new Set(file.overrides.map((entry) => entry.id)).size === file.overrides.length,
    "a skill is listed twice",
  );

// data/scan-overrides.yaml. No file is no override.
export async function readScanOverrides(file: string): Promise<ScanOverride[]> {
  try {
    return (await readYamlFile(file, ScanOverridesFileSchema)).overrides;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// A skill is cleared by a scan of its current fingerprint that found no signal at all beyond
// information. A `review` verdict (warnings, or files that could not be scanned) is not cleared
// unless the owner's decision for the same fingerprint and scanned content says so. A `block`
// verdict, a skill without an entry and a stale entry are never cleared. The function reads the
// cache when called, so it sees entries added while the extract step runs.
export function safetyCleared(cache: SafetyCache, overrides: readonly ScanOverride[] = []): SafetyCleared {
  const overrideById = new Map(overrides.map((entry) => [entry.id, entry]));
  return (skill) => {
    const entry = Object.hasOwn(cache, skill.id) ? cache[skill.id] : undefined;
    if (entry === undefined || entry.fingerprint !== skill.fingerprint) return false;
    if (entry.verdict === "clear") return true;
    if (entry.verdict !== "review") return false;
    const decision = overrideById.get(skill.id);
    return (
      decision !== undefined &&
      decision.fingerprint === skill.fingerprint &&
      decision.contentId === entry.contentId
    );
  };
}

// Skills whose publication depends on the scan: the license does not publish them alone.
export function needsSafetyScan(skill: SkillRecord, allowed: readonly string[]): boolean {
  const status = publication(skill, allowed, NO_SAFETY_SCAN);
  return status.status === "waiting" && status.reason === WAITING_FOR_SAFETY_SCAN;
}

// Work is bounded per skill: a skill with more than these is not scanned in full, and what is
// left out is reported to the scanner as unscanned files (a `review` verdict, never `clear`).
export interface SafetyLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  // Skills read at the same time.
  concurrency: number;
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  // Documentation-heavy skills have close to 100 files (the Anthropic claude-api skill: 96).
  maxFiles: 200,
  // The download limit of the GitHub client.
  maxFileBytes: 1_000_000,
  maxTotalBytes: 10_000_000,
  concurrency: 6,
};

export interface SafetyCounts {
  // Skills downloaded and scanned in this call.
  scanned: number;
  // Skills whose cached report was still valid.
  reused: number;
  // Skills left without a report because a file could not be read.
  failedDownloads: number;
  // Whether the cache was modified: it needs saving.
  changed: boolean;
}

// New reports between two saves of the cache while a repository is being scanned.
export const CHECKPOINT_EVERY = 100;

export interface ScanContext {
  cache: SafetyCache;
  allowed: readonly string[];
  limits?: Partial<SafetyLimits>;
  // Saves the cache. Called about every CHECKPOINT_EVERY new reports, never twice at once.
  checkpoint?: () => Promise<void>;
}

type Downloader = Pick<GitHubClient, "getFileBytes">;

const BINARY_PROBE_BYTES = 8000;

function contentIdOf(files: readonly SkillFileEntry[], limits: SafetyLimits): string {
  const hash = createHash("sha256");
  hash.update(`limits:${limits.maxFiles}:${limits.maxFileBytes}:${limits.maxTotalBytes}\n`);
  for (const file of files) hash.update(`${file.path}\0${file.sha}\n`);
  return hash.digest("hex");
}

type SkillScan = { entry: SafetyEntry } | { incomplete: string };

// Downloads the files of one skill and scans them. Nothing is executed or followed: the
// files are read as text. A file that cannot be read, or that is not the listed blob (the
// branch moved after the listing), makes the whole scan incomplete: no report is better than
// a report that missed a file.
async function scanOne(
  gh: Downloader,
  repo: RepoMeta,
  skill: SkillRecord,
  files: readonly SkillFileEntry[],
  limits: SafetyLimits,
): Promise<SkillScan> {
  // SKILL.md first, so the files left out by the limits are the least important ones.
  const ordered = [...files].sort(
    (a, b) => Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md") || compareText(a.path, b.path),
  );
  const inputs: SafetyInputFile[] = [];
  const toRead: SkillFileEntry[] = [];
  let budget = limits.maxTotalBytes;
  for (const file of ordered) {
    const tooBig = file.size !== undefined && (file.size > limits.maxFileBytes || file.size > budget);
    if (isMediaPath(file.path) || toRead.length >= limits.maxFiles || tooBig) {
      inputs.push({ path: file.path, size: file.size ?? 0 });
      continue;
    }
    toRead.push(file);
    budget -= file.size ?? 0;
  }
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let failure: string | undefined;
  const read: SafetyInputFile[] = [];
  for (const file of toRead) {
    try {
      const bytes = await gh.getFileBytes(
        repo.fullName,
        repo.defaultBranch,
        skill.path ? `${skill.path}/${file.path}` : file.path,
      );
      if (gitBlobId(bytes) !== file.sha) {
        failure = `${file.path} changed since the listing`;
        break;
      }
      // A NUL byte early in the file means binary content: reported as unscanned, not decoded.
      read.push(
        bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)
          ? { path: file.path, size: bytes.length }
          : { path: file.path, content: decoder.decode(bytes) },
      );
    } catch (error) {
      failure = `${file.path}: ${errorMessage(error)}`;
      break;
    }
  }
  if (failure !== undefined) return { incomplete: failure };
  const report = scanSkillFiles([...inputs, ...read]);
  return {
    entry: {
      fingerprint: skill.fingerprint,
      contentId: contentIdOf(ordered, limits),
      verdict: report.verdict,
      scannedFiles: report.scannedFiles.length,
      skippedFiles: report.skippedFiles.length,
      findings: report.findings.filter((finding) => finding.severity !== "info"),
      infoFindings: report.findings.filter((finding) => finding.severity === "info").length,
    },
  };
}

// Scans the skills of one repository that need the scan, and drops the reports that are no
// longer valid. Called by the extract step once the licenses are resolved, with the tree it
// listed. The cache is completed in place.
//
// A truncated listing is partial: files past the cut are unknown, so no report can claim to
// cover the skill. The reports of that repository are dropped and its skills stay waiting.
export async function scanWaitingSkills(
  gh: Downloader,
  repo: RepoMeta,
  tree: { entries: TreeEntry[]; truncated: boolean },
  skills: readonly SkillRecord[],
  context: ScanContext,
): Promise<SafetyCounts> {
  const limits = { ...DEFAULT_SAFETY_LIMITS, ...context.limits };
  const counts: SafetyCounts = { scanned: 0, reused: 0, failedDownloads: 0, changed: false };
  const drop = (id: string): void => {
    if (!Object.hasOwn(context.cache, id)) return;
    delete context.cache[id];
    counts.changed = true;
  };
  const waiting = skills.filter((skill) => needsSafetyScan(skill, context.allowed));
  if (tree.truncated) {
    for (const skill of skills) drop(skill.id);
    return counts;
  }
  const filesByDir = listSkillFiles(tree.entries);
  const todo: { skill: SkillRecord; files: SkillFileEntry[]; contentId: string }[] = [];
  for (const skill of waiting) {
    const files = filesByDir.get(skill.path);
    if (files === undefined) {
      drop(skill.id);
      continue;
    }
    const contentId = contentIdOf(
      [...files].sort(
        (a, b) => Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md") || compareText(a.path, b.path),
      ),
      limits,
    );
    const entry = Object.hasOwn(context.cache, skill.id) ? context.cache[skill.id] : undefined;
    if (entry !== undefined && entry.fingerprint === skill.fingerprint && entry.contentId === contentId) {
      counts.reused += 1;
    } else {
      todo.push({ skill, files, contentId });
    }
  }
  let sinceCheckpoint = 0;
  let saving: Promise<void> | undefined;
  await mapLimit(todo, limits.concurrency, async ({ skill, files }) => {
    const result = await scanOne(gh, repo, skill, files, limits);
    if ("incomplete" in result) {
      console.warn(`Safety scan incomplete for ${skill.id}: ${result.incomplete}`);
      // A stale report must not keep clearing a skill whose files changed.
      drop(skill.id);
      counts.failedDownloads += 1;
      return;
    }
    context.cache[skill.id] = result.entry;
    counts.changed = true;
    counts.scanned += 1;
    // A repository can hold thousands of skills and nothing else is saved before it is done:
    // save the reports made so far from time to time, one save at a time.
    sinceCheckpoint += 1;
    if (context.checkpoint && sinceCheckpoint >= CHECKPOINT_EVERY && saving === undefined) {
      sinceCheckpoint = 0;
      const checkpoint = context.checkpoint;
      saving = checkpoint()
        .catch((error: unknown) => console.warn(`Safety reports not saved yet: ${errorMessage(error)}`))
        .finally(() => {
          saving = undefined;
        });
      await saving;
    }
  });
  return counts;
}

// Counts per verdict for the skills that need the scan, and removes the reports of skills that
// are gone or no longer need it, so the cache never grows with dead entries. Counts only: the
// findings stay in the cache.
export function summarizeSafety(
  skills: readonly SkillRecord[],
  allowed: readonly string[],
  cache: SafetyCache,
  counts: Pick<SafetyCounts, "scanned" | "reused" | "failedDownloads">,
): { stats: SafetyStats; pruned: boolean } {
  const stats: SafetyStats = {
    scanned: counts.scanned,
    reused: counts.reused,
    clear: 0,
    review: 0,
    block: 0,
    notScanned: 0,
    failedDownloads: counts.failedDownloads,
  };
  const live = new Set<string>();
  for (const skill of skills) {
    if (!needsSafetyScan(skill, allowed)) continue;
    live.add(skill.id);
    const entry = Object.hasOwn(cache, skill.id) ? cache[skill.id] : undefined;
    if (entry === undefined || entry.fingerprint !== skill.fingerprint) stats.notScanned += 1;
    else stats[entry.verdict] += 1;
  }
  let pruned = false;
  for (const id of Object.keys(cache)) {
    if (!live.has(id)) {
      delete cache[id];
      pruned = true;
    }
  }
  return { stats, pruned };
}
