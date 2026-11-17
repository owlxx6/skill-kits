import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "./errors";
import type { GitHubClient } from "./github";
import { gitBlobId, licenseCategory, licenseLabel, publication } from "./license";
import { isMediaPath } from "./safety";
import type { Kit, RepoMeta, SkillRecord } from "./schemas";
import { keywordPattern } from "./session-reviews";
import { DEFAULT_SAFETY_LIMITS, type SafetyCache, type SafetyLimits, needsSafetyScan } from "./skill-safety";
import { findSkillLocations, listSkillFiles } from "./skillfile";
import { writeJsonFile } from "./store";
import { compareText } from "./text";

// Two helpers for sharing the extraction between agents and for reading skills in a session:
// a table of candidate skills for some kits, with their eligibility, and the complete files of
// a skill. Neither calls a model, and neither writes outside the folder it is given.

// ---------------------------------------------------------------------------------------
// Candidate table

export interface KitHit {
  kit: string;
  // Number of the kit's keywords found in the skill's name and description.
  hits: number;
}

export interface CandidateRow {
  id: string;
  name: string;
  description: string;
  repo: string;
  stars: number;
  // The skill folder inside the repository.
  path: string;
  // Git id of the skill folder: the revision a review is about. It changes when any file of the
  // folder changes (a root skill's id covers its SKILL.md only).
  revision: string;
  // Git id of the repository tree the license was resolved from, when known.
  listingRevision: string | null;
  eligibility: { status: "publishable" | "waiting"; reason: string | null };
  license: string;
  licenseCategory: string;
  // Verdict of the safety scan: no finding, excerpt or path (those are for the owner only).
  safety: "clear" | "review" | "block" | "not scanned" | "not needed";
  // A review exists for this revision, from any agent or the API.
  reviewed: boolean;
  // Kits asked for that the skill mentions.
  kits: KitHit[];
  // The other kits it mentions: the overlap to settle between agents so a skill is reviewed once.
  otherKits: KitHit[];
}

const MAX_DESCRIPTION_CHARS = 300;

export interface CandidateInput {
  skills: readonly SkillRecord[];
  repos: readonly RepoMeta[];
  kits: readonly Kit[];
  // Kit ids to export.
  requested: readonly string[];
  // Fingerprints that already have a review.
  reviewed: ReadonlySet<string>;
  allowed: readonly string[];
  safety: SafetyCache;
  isSafetyCleared: (skill: SkillRecord) => boolean;
}

function safetyOf(skill: SkillRecord, input: CandidateInput): CandidateRow["safety"] {
  if (!needsSafetyScan(skill, input.allowed)) return "not needed";
  const entry = Object.hasOwn(input.safety, skill.id) ? input.safety[skill.id] : undefined;
  return entry === undefined || entry.fingerprint !== skill.fingerprint ? "not scanned" : entry.verdict;
}

// Every skill of a listed repository that mentions at least one keyword of a requested kit,
// whatever its eligibility: the status is in the row. The best match of a requested kit first,
// then the most starred repository.
export function buildCandidateRows(input: CandidateInput): CandidateRow[] {
  const known = new Set(input.kits.map((kit) => kit.id));
  const unknown = input.requested.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`Unknown kit ids: ${unknown.join(", ")}`);
  const stars = new Map(input.repos.map((repo) => [repo.fullName, repo.stars]));
  const requested = new Set(input.requested);
  const patterns = input.kits.map((kit) => ({ id: kit.id, patterns: kit.keywords.map(keywordPattern) }));
  const rows: CandidateRow[] = [];
  for (const skill of input.skills) {
    if (!stars.has(skill.repo)) continue;
    const text = `${skill.name} ${skill.description}`.toLowerCase();
    const hits: KitHit[] = patterns
      .map(({ id, patterns: list }) => ({ kit: id, hits: list.filter((pattern) => pattern.test(text)).length }))
      .filter((entry) => entry.hits > 0)
      .sort((a, b) => b.hits - a.hits || compareText(a.kit, b.kit));
    const kits = hits.filter((entry) => requested.has(entry.kit));
    if (kits.length === 0) continue;
    const status = publication(skill, input.allowed, input.isSafetyCleared);
    rows.push({
      id: skill.id,
      name: skill.name,
      description: skill.description.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_CHARS),
      repo: skill.repo,
      stars: stars.get(skill.repo) ?? 0,
      path: skill.path,
      revision: skill.fingerprint,
      listingRevision: skill.license?.revision ?? null,
      eligibility:
        status.status === "publishable"
          ? { status: "publishable", reason: null }
          : { status: "waiting", reason: status.reason },
      license: skill.license ? licenseLabel(skill.license) : "unresolved",
      licenseCategory: skill.license ? licenseCategory(skill.license, input.allowed) : "unresolved",
      safety: safetyOf(skill, input),
      reviewed: input.reviewed.has(skill.fingerprint),
      kits,
      otherKits: hits.filter((entry) => !requested.has(entry.kit)),
    });
  }
  return rows.sort(
    (a, b) =>
      b.kits[0].hits - a.kits[0].hits ||
      b.stars - a.stars ||
      compareText(a.id, b.id),
  );
}

// A spreadsheet runs a cell that starts with one of these as a formula: skill names and
// descriptions are third-party text.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | number | boolean | null): string {
  let text = value === null ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CANDIDATE_CSV_COLUMNS = [
  "id",
  "name",
  "repo",
  "path",
  "revision",
  "listingRevision",
  "eligibility",
  "reason",
  "license",
  "licenseCategory",
  "safety",
  "reviewed",
  "kits",
  "otherKits",
  "stars",
  "description",
] as const;

export function candidatesCsv(rows: readonly CandidateRow[]): string {
  const kitsText = (hits: readonly KitHit[]): string => hits.map((entry) => `${entry.kit}:${entry.hits}`).join(" ");
  const lines = [CANDIDATE_CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.name,
        row.repo,
        row.path,
        row.revision,
        row.listingRevision,
        row.eligibility.status,
        row.eligibility.reason,
        row.license,
        row.licenseCategory,
        row.safety,
        row.reviewed,
        kitsText(row.kits),
        kitsText(row.otherKits),
        row.stars,
        row.description,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function writeCandidates(
  dir: string,
  rows: readonly CandidateRow[],
  info: { generatedAt: string; kits: readonly string[] },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeJsonFile(path.join(dir, "candidates.json"), {
    generatedAt: info.generatedAt,
    kits: info.kits,
    count: rows.length,
    candidates: rows,
  });
  await writeFile(path.join(dir, "candidates.csv"), candidatesCsv(rows), "utf8");
}

// ---------------------------------------------------------------------------------------
// Complete files of a skill

// A path from a repository tree becomes a path on this disk: no way out of the folder, no
// character Windows refuses.
export function isSafeRelativePath(relative: string): boolean {
  if (relative === "" || relative.startsWith("/") || /[\\:*?"<>|\x00-\x1f\x7f]/.test(relative)) return false;
  return relative.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && segment.length <= 200);
}

export interface SavedFile {
  path: string;
  size: number;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface SavedSkillFiles {
  // Folder holding the files of the skill, named by its revision.
  dir: string;
  files: SavedFile[];
  skipped: SkippedFile[];
}

// Writes every text file of a skill (SKILL.md, scripts, references) to <out>/<revision>/, in full,
// so a session can read them with its file tools. The tree is listed again and must still have
// the revision of the record: what is read is what was extracted. Each file must be the listed
// blob. Limits are the safety scan's (files, bytes per file, bytes in all); media and binary
// files are listed as skipped. An index <out>/<revision>.index.json names what was saved.
export async function saveSkillFiles(
  gh: Pick<GitHubClient, "getTree" | "getFileBytes">,
  repo: RepoMeta,
  skill: SkillRecord,
  out: string,
  limits: Partial<SafetyLimits> = {},
): Promise<SavedSkillFiles> {
  const { maxFiles, maxFileBytes, maxTotalBytes } = { ...DEFAULT_SAFETY_LIMITS, ...limits };
  const tree = await gh.getTree(repo.fullName, repo.defaultBranch);
  if (tree.truncated) throw new Error(`the listing of ${repo.fullName} is truncated: the files cannot be listed in full`);
  const location = findSkillLocations(tree.entries).find((entry) => entry.dir === skill.path);
  if (!location) throw new Error(`${skill.id} is no longer in the repository`);
  if (location.fingerprint !== skill.fingerprint) {
    throw new Error(
      `${skill.id} changed since the extraction (revision ${skill.fingerprint.slice(0, 10)} is now ${location.fingerprint.slice(0, 10)}): run extract again`,
    );
  }
  const listed = listSkillFiles(tree.entries).get(skill.path) ?? [];
  const dir = path.join(out, skill.fingerprint);
  const files: SavedFile[] = [];
  const skipped: SkippedFile[] = [];
  let budget = maxTotalBytes;
  for (const file of listed) {
    const skip = (reason: string): void => {
      skipped.push({ path: file.path, reason });
    };
    if (!isSafeRelativePath(file.path)) {
      skip("unsafe file name");
    } else if (isMediaPath(file.path)) {
      skip("media");
    } else if (files.length >= maxFiles) {
      skip(`more than ${maxFiles} files`);
    } else if (file.size !== undefined && file.size > maxFileBytes) {
      skip(`larger than ${maxFileBytes} bytes`);
    } else if (file.size !== undefined && file.size > budget) {
      skip(`more than ${maxTotalBytes} bytes in all`);
    } else {
      try {
        const bytes = await gh.getFileBytes(repo.fullName, repo.defaultBranch, skill.path ? `${skill.path}/${file.path}` : file.path);
        if (gitBlobId(bytes) !== file.sha) {
          skip("changed since the listing");
        } else if (bytes.subarray(0, 8000).includes(0)) {
          skip("binary");
        } else {
          const target = path.join(dir, ...file.path.split("/"));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, bytes);
          budget -= bytes.length;
          files.push({ path: file.path, size: bytes.length });
        }
      } catch (error) {
        skip(errorMessage(error));
      }
    }
  }
  await mkdir(out, { recursive: true });
  await writeJsonFile(path.join(out, `${skill.fingerprint}.index.json`), {
    id: skill.id,
    repo: skill.repo,
    path: skill.path,
    revision: skill.fingerprint,
    files,
    skipped,
  });
  return { dir, files, skipped };
}
