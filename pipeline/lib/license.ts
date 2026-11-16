import { createHash } from "node:crypto";
import { z } from "zod";
import {
  APACHE_2_HEADER_TEMPLATE,
  APACHE_2_TEMPLATE,
  APACHE_2_TERMS_TEMPLATE,
  BSD_2_CLAUSE_TEMPLATE,
  BSD_3_CLAUSE_TEMPLATE,
  ISC_TEMPLATE,
  MIT_TEMPLATE,
} from "./license-templates";
import {
  type LicenseCache,
  LicenseCacheSchema,
  type LicenseEvidence,
  type LicenseResolution,
  type SkillRecord,
  type TextIdentification,
} from "./schemas";
import { type TreeEntry, skillFilePath } from "./skillfile";
import { compareText } from "./text";

export type { TextIdentification };

// Pure license resolution, see docs/LICENSE-RESOLUTION.md. No network: the caller reads the
// license files and passes what each one was identified as.

// Bump whenever identification changes (texts, templates, thresholds, file names): cached
// results from other rules are discarded and every license text is identified again.
export const LICENSE_RULES_VERSION = 2;

// The ids this module can identify, in their canonical spelling.
export const KNOWN_SPDX = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "GPL-2.0",
  "GPL-3.0",
  "LGPL-2.1",
  "LGPL-3.0",
  "AGPL-3.0",
] as const;

const KNOWN_BY_LOWER = new Map<string, string>(KNOWN_SPDX.map((id) => [id.toLowerCase(), id]));

const SYMLINK_MODE = "120000";

// ---------------------------------------------------------------------------------------
// License file names

// LICENSE, LICENCE, COPYING or UNLICENSE, alone or followed by an extension or suffix.
const LICENSE_NAME = /^(?:licen[cs]e|copying|unlicense)(?:[.\-_][a-z0-9.+_-]*)?$/i;
// A source file named license.py is code, not a license text.
const CODE_EXTENSION =
  /\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx|py|sh|bash|zsh|rb|go|rs|java|kt|toml|css|php|c|h|cc|cpp|cs|swift|pl|lua|ps1|bat)$/i;
// Recorded but never deciding: data files, third-party lists, notices, headers, templates.
const DATA_EXTENSION = /\.(?:csv|json|ya?ml|html?|xml)$/i;
const AUXILIARY_WORD = /third-?party|thirdparty|3rd-?party|notice|header|template/i;
// The names that decide: the base name, optionally with -<id>, .<id> or _<id>, optionally
// followed by a text extension.
const DECIDING_NAME = /^(?:licen[cs]e|copying|unlicense)(?:[-._][a-z0-9][a-z0-9.+-]*?)?(?:\.(?:txt|md|rst))?$/i;
const TEXT_EXTENSION = /\.(?:txt|md|markdown|rst|text)$/i;

const baseName = (filePath: string): string => filePath.slice(filePath.lastIndexOf("/") + 1);

// A file recorded as license evidence.
export function isLicenseFileName(name: string): boolean {
  return LICENSE_NAME.test(name) && !CODE_EXTENSION.test(name);
}

// A license file that can decide; the other recorded files are auxiliary.
export function isDecidingLicenseName(name: string): boolean {
  return (
    isLicenseFileName(name) &&
    DECIDING_NAME.test(name) &&
    !DATA_EXTENSION.test(name) &&
    !AUXILIARY_WORD.test(name)
  );
}

// ---------------------------------------------------------------------------------------
// License texts

// Lower case, no BOM, Unix line endings, straight quotes, no Markdown emphasis or heading
// marks: a reformatted copy of a license reads the same.
function prepare(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[*_`#>]/g, "")
    .toLowerCase();
}

const wordsOf = (text: string): string[] => text.match(/[a-z0-9]+/g) ?? [];

const COPYRIGHT_LINE = /^\s*(?:copyright\b|\(c\)|\u00a9|all rights reserved)/;
const TITLE_WORDS = new Set([
  "the",
  "mit",
  "license",
  "licence",
  "isc",
  "bsd",
  "new",
  "simplified",
  "revised",
  "modified",
  "clause",
  "2",
  "3",
  "apache",
  "version",
  "0",
  "spdx",
  "identifier",
  "expat",
]);

// The words a license is compared on: leading title lines and copyright lines are dropped,
// since they hold names and years that differ from one project to the next.
function bodyWords(prepared: string): string[] {
  const kept: string[] = [];
  let started = false;
  for (const line of prepared.split("\n")) {
    if (COPYRIGHT_LINE.test(line)) continue;
    const words = wordsOf(line);
    if (words.length === 0) continue;
    if (!started && words.length <= 8 && words.every((word) => TITLE_WORDS.has(word))) continue;
    started = true;
    kept.push(...words);
  }
  return kept;
}

interface Template {
  spdx: string;
  words: string[];
}

const template = (spdx: string, text: string): Template => ({ spdx, words: bodyWords(prepare(text)) });

// A text matches a template when it adds at most MAX_EXTRA_WORDS words (a name in a clause, a
// reworded title) and keeps at least MIN_COVERAGE of the template's words, in order.
const MAX_EXTRA_WORDS = 5;
const MIN_COVERAGE = 0.98;
// An added word from this list turns a match into a restriction.
const RESTRICTION_WORDS = new Set([
  "commercial",
  "noncommercial",
  "noncommercially",
  "commons",
  "resold",
  "resell",
  "resale",
  "prohibited",
  "prohibit",
  "forbidden",
  "military",
  "evil",
  "train",
  "training",
  "ai",
  "revocable",
  "revoke",
  "except",
  "exclusively",
  "only",
  "not",
  "no",
]);

interface Family {
  // A distinctive phrase, in words: a text containing it is taken for this license family.
  phrase: string;
  // Allowed licenses are compared word by word with these templates.
  templates: Template[];
  // A GNU license (none is allowed) is identified by its title and version alone: a false
  // match there can never publish anything, and restriction words are not checked.
  spdx?: string;
}

const FAMILIES: Family[] = [
  {
    phrase: "permission is hereby granted free of charge to any person obtaining a copy",
    templates: [template("MIT", MIT_TEMPLATE)],
  },
  {
    phrase: "distribute this software for any purpose with or without fee is hereby granted",
    templates: [template("ISC", ISC_TEMPLATE)],
  },
  {
    phrase: "redistribution and use in source and binary forms with or without modification are permitted",
    templates: [template("BSD-2-Clause", BSD_2_CLAUSE_TEMPLATE), template("BSD-3-Clause", BSD_3_CLAUSE_TEMPLATE)],
  },
  {
    phrase: "apache license version 2 0",
    templates: [
      template("Apache-2.0", APACHE_2_TEMPLATE),
      template("Apache-2.0", APACHE_2_TERMS_TEMPLATE),
      template("Apache-2.0", APACHE_2_HEADER_TEMPLATE),
    ],
  },
  { phrase: "gnu general public license version 2 june 1991", templates: [], spdx: "GPL-2.0" },
  { phrase: "gnu general public license version 3 29 june 2007", templates: [], spdx: "GPL-3.0" },
  { phrase: "gnu lesser general public license version 2 1 february 1999", templates: [], spdx: "LGPL-2.1" },
  { phrase: "gnu lesser general public license version 3 29 june 2007", templates: [], spdx: "LGPL-3.0" },
  { phrase: "gnu affero general public license version 3 19 november 2007", templates: [], spdx: "AGPL-3.0" },
];

// Length of the longest common subsequence of two word lists.
function commonWords(a: string[], b: string[]): number {
  const ids = new Map<string, number>();
  const toIds = (words: string[]): Int32Array =>
    Int32Array.from(words, (word) => {
      let id = ids.get(word);
      if (id === undefined) {
        id = ids.size;
        ids.set(word, id);
      }
      return id;
    });
  const x = toIds(a);
  const y = toIds(b);
  let previous = new Int32Array(y.length + 1);
  let current = new Int32Array(y.length + 1);
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      current[j] = x[i - 1] === y[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous[y.length];
}

// The words of text beyond their count in the reference.
function addedWords(text: string[], reference: string[]): string[] {
  const left = new Map<string, number>();
  for (const word of reference) left.set(word, (left.get(word) ?? 0) + 1);
  return text.filter((word) => {
    const count = left.get(word) ?? 0;
    if (count > 0) {
      left.set(word, count - 1);
      return false;
    }
    return true;
  });
}

function matchesTemplate(words: string[], reference: Template): boolean {
  // Cheap bounds first: a text that is too long adds too many words, one too short cannot
  // cover the template.
  if (words.length - reference.words.length > MAX_EXTRA_WORDS) return false;
  if (words.length < reference.words.length * MIN_COVERAGE) return false;
  const common = commonWords(words, reference.words);
  return words.length - common <= MAX_EXTRA_WORDS && common >= reference.words.length * MIN_COVERAGE;
}

// unknown: no known license phrase, the only result that may defer to GitHub's detection.
// restricted: a permissive license's phrase without a faithful copy of its text, or with
// restricting words added. multiple: phrases of several licenses.
export function identifyLicenseText(text: string): TextIdentification {
  const prepared = prepare(text);
  const joined = ` ${wordsOf(prepared).join(" ")} `;
  const families = FAMILIES.filter((family) => joined.includes(` ${family.phrase} `));
  if (families.length === 0) return { kind: "unknown" };
  if (families.length > 1) return { kind: "multiple" };
  const family = families[0];
  if (family.spdx) return { kind: "spdx", spdx: family.spdx };
  const words = bodyWords(prepared);
  for (const reference of family.templates) {
    if (!matchesTemplate(words, reference)) continue;
    const restricted = addedWords(words, reference.words).some((word) => RESTRICTION_WORDS.has(word));
    return restricted ? { kind: "restricted" } : { kind: "spdx", spdx: reference.spdx };
  }
  return { kind: "restricted" };
}

// The git blob id of a file's bytes: sha1 of "blob <length>\0" followed by the bytes.
export function gitBlobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------------------
// Front matter values

export type FrontmatterLicense =
  | { kind: "spdx"; spdx: string }
  // spdx: an id stated before the reference ("MIT (see LICENSE)"), checked against the files.
  | { kind: "file"; names: string[]; spdx?: string }
  | { kind: "custom" };

// Common spellings that name one license without doubt, lower case.
const SPDX_ALIASES = new Map<string, string>([
  ["mit license", "MIT"],
  ["the mit license", "MIT"],
  ["apache 2.0", "Apache-2.0"],
  ["apache-2", "Apache-2.0"],
  ["apache license 2.0", "Apache-2.0"],
  ["apache license 2", "Apache-2.0"],
  ["apache license, version 2.0", "Apache-2.0"],
  ["apache license version 2.0", "Apache-2.0"],
  ["bsd 3-clause", "BSD-3-Clause"],
  ["bsd-3", "BSD-3-Clause"],
  ["new bsd", "BSD-3-Clause"],
  ["bsd 2-clause", "BSD-2-Clause"],
  ["simplified bsd", "BSD-2-Clause"],
  ["isc license", "ISC"],
]);

// SPDX expression operators are upper case. Dual licensing is not decided yet, so an
// expression is custom, even when it also names a file.
const SPDX_OPERATOR = /(?:^|[\s(])(?:OR|AND|WITH)(?=[\s)]|$)/;

// A known id (case-insensitive) or an alias, ignoring surrounding quotes and trailing
// punctuation. GNU ids also come as -only or -or-later; GitHub reports both under the base id.
function knownSpdx(value: string): string | null {
  const lower = value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.,;:!]+$/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/^((?:a|l)?gpl-\d\.\d)-(?:only|or-later)$/, "$1");
  return KNOWN_BY_LOWER.get(lower) ?? SPDX_ALIASES.get(lower) ?? null;
}

// A word names a file when it is a license file name with an extension or suffix, an
// upper-case LICENSE, LICENCE, COPYING or UNLICENSE, or any name with a text extension.
// "MIT License" therefore names no file.
function fileReference(word: string): string | null {
  const name = word.replace(/^[("'<]+/, "").replace(/[)"'>.,;:!?]+$/, "").replace(/^(?:\.\/)+/, "");
  if (!name) return null;
  const base = baseName(name);
  const bare = /^(?:LICEN[CS]E|COPYING|UNLICENSE)$/.test(base);
  const suffixed = isLicenseFileName(base) && /^(?:licen[cs]e|copying|unlicense)[.\-_]/i.test(base);
  if (bare || suffixed || (TEXT_EXTENSION.test(base) && /^[\w.+-]+$/.test(base))) return name;
  return null;
}

// Where an id stated before a reference may end: "MIT (see", "MIT. See", "MIT, see", "MIT - see".
const STATED_ID_END = /\s*(?:[(,;]|\.\s|\s-\s|\ssee\s)/gi;

function statedId(value: string): string | null {
  for (const match of value.matchAll(STATED_ID_END)) {
    const spdx = knownSpdx(value.slice(0, match.index));
    if (spdx) return spdx;
  }
  return null;
}

export function identifyFrontmatterLicense(value: string): FrontmatterLicense {
  const spdx = knownSpdx(value);
  if (spdx) return { kind: "spdx", spdx };
  if (SPDX_OPERATOR.test(value)) return { kind: "custom" };
  const names: string[] = [];
  let namedIds = 0;
  for (const word of value.split(/[\s,;]+/)) {
    const name = fileReference(word);
    if (name) {
      if (!names.includes(name)) names.push(name);
    } else if (knownSpdx(word.replace(/^[("'<]+|[)"'>]+$/g, ""))) {
      namedIds += 1;
    }
  }
  if (names.length === 0) return { kind: "custom" };
  const stated = statedId(value);
  // A second license named next to the reference is a choice: not decided yet.
  if (namedIds > (stated ? 1 : 0)) return { kind: "custom" };
  return stated ? { kind: "file", names, spdx: stated } : { kind: "file", names };
}

// ---------------------------------------------------------------------------------------
// The tree

export interface LicenseFileRef {
  path: string;
  blob: string;
  mode?: string;
}

export interface LicenseIndex {
  // License-named files directly in each folder ("" is the root), sorted by path.
  byDir: Map<string, LicenseFileRef[]>;
  // Every file of the tree, to resolve a front matter reference or a link.
  files: Map<string, LicenseFileRef>;
  // Lower-case path -> paths, for a reference written in another letter case.
  lowerPaths: Map<string, string[]>;
}

const dirOf = (filePath: string): string => {
  const slash = filePath.lastIndexOf("/");
  return slash < 0 ? "" : filePath.slice(0, slash);
};

export function indexLicenseFiles(entries: TreeEntry[]): LicenseIndex {
  const byDir = new Map<string, LicenseFileRef[]>();
  const files = new Map<string, LicenseFileRef>();
  const lowerPaths = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    const ref: LicenseFileRef = entry.mode
      ? { path: entry.path, blob: entry.sha, mode: entry.mode }
      : { path: entry.path, blob: entry.sha };
    files.set(entry.path, ref);
    const lower = entry.path.toLowerCase();
    lowerPaths.set(lower, [...(lowerPaths.get(lower) ?? []), entry.path]);
    if (!isLicenseFileName(baseName(entry.path))) continue;
    const dir = dirOf(entry.path);
    byDir.set(dir, [...(byDir.get(dir) ?? []), ref]);
  }
  for (const list of byDir.values()) list.sort((a, b) => compareText(a.path, b.path));
  return { byDir, files, lowerPaths };
}

// A path relative to a folder, resolved inside the repository; null when it leaves it.
function resolveRelativePath(dir: string, relative: string): string | null {
  if (relative.startsWith("/")) return null;
  const parts = dir ? dir.split("/") : [];
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

// The exact path, or the only path that matches it in another letter case.
function lookup(index: LicenseIndex, filePath: string): LicenseFileRef | undefined {
  const exact = index.files.get(filePath);
  if (exact) return exact;
  const matches = index.lowerPaths.get(filePath.toLowerCase()) ?? [];
  return matches.length === 1 ? index.files.get(matches[0]) : undefined;
}

// Folders between the skill folder and the root, nearest first.
function ancestorDirs(skillPath: string): string[] {
  if (!skillPath) return [];
  const parts = skillPath.split("/");
  const dirs: string[] = [];
  for (let depth = parts.length - 1; depth >= 1; depth -= 1) dirs.push(parts.slice(0, depth).join("/"));
  return dirs;
}

// A referenced name: a path with ../ is resolved from the skill folder; any other is looked up
// in the skill folder, then its ancestors, then the root, nearest first.
function findReference(index: LicenseIndex, skillPath: string, name: string): LicenseFileRef | undefined {
  if (name.split("/").includes("..")) {
    const resolved = resolveRelativePath(skillPath, name);
    return resolved === null ? undefined : lookup(index, resolved);
  }
  const dirs = [skillPath, ...ancestorDirs(skillPath), ...(skillPath ? [""] : [])];
  for (const dir of dirs) {
    const resolved = resolveRelativePath(dir, name);
    const found = resolved === null ? undefined : lookup(index, resolved);
    if (found) return found;
  }
  return undefined;
}

// The target of a symbolic link: one hop, inside the repository, to a regular file.
export function resolveLinkTarget(
  index: LicenseIndex,
  link: LicenseFileRef,
  linkText: string,
): LicenseFileRef | undefined {
  const target = resolveRelativePath(dirOf(link.path), linkText.trim());
  if (target === null) return undefined;
  const ref = index.files.get(target);
  return ref && ref.mode !== SYMLINK_MODE ? ref : undefined;
}

export interface LicenseQuery {
  skillPath: string;
  frontmatterLicense?: string;
  // RepoMeta.license: the id GitHub detected, NOASSERTION or null.
  githubLicense: string | null;
  // The tree listing was cut by GitHub: files may be missing from it.
  truncated: boolean;
  // Id of the tree the files were listed from, recorded in the resolution.
  revision?: string;
}

type EvidenceLevel = "skill" | "ancestor" | "repository";

interface LevelFiles {
  deciding: LicenseFileRef[];
  auxiliary: LicenseFileRef[];
}

interface Gathered {
  skill: LevelFiles;
  referenced: LicenseFileRef[];
  frontmatter: FrontmatterLicense | null;
  missingReference: boolean;
  // Nearest first; folders without license files are left out.
  ancestors: LevelFiles[];
  root: LevelFiles;
}

function split(files: LicenseFileRef[], exclude: Set<string>): LevelFiles {
  const kept = files.filter((file) => !exclude.has(file.path));
  return {
    deciding: kept.filter((file) => isDecidingLicenseName(baseName(file.path))),
    auxiliary: kept.filter((file) => !isDecidingLicenseName(baseName(file.path))),
  };
}

function gather(index: LicenseIndex, query: LicenseQuery): Gathered {
  const frontmatter =
    query.frontmatterLicense === undefined ? null : identifyFrontmatterLicense(query.frontmatterLicense);
  const own = index.byDir.get(query.skillPath) ?? [];
  const referenced: LicenseFileRef[] = [];
  let missingReference = false;
  if (frontmatter?.kind === "file") {
    for (const name of frontmatter.names) {
      const found = findReference(index, query.skillPath, name);
      if (!found) missingReference = true;
      else if (!referenced.some((file) => file.path === found.path)) referenced.push(found);
    }
  }
  // A referenced file counts once, at the skill level, and always decides.
  const taken = new Set(referenced.map((file) => file.path));
  const skill = split(own, taken);
  const ancestors = ancestorDirs(query.skillPath)
    .map((dir) => split(index.byDir.get(dir) ?? [], taken))
    .filter((level) => level.deciding.length + level.auxiliary.length > 0);
  // For a skill at the root, root files are its own: they count at the skill level.
  const root = query.skillPath ? split(index.byDir.get("") ?? [], taken) : { deciding: [], auxiliary: [] };
  return { skill, referenced, frontmatter, missingReference, ancestors, root };
}

// The files whose text must be read to resolve this skill, nearest first. Auxiliary files
// are recorded without being read.
export function licenseFilesFor(index: LicenseIndex, query: LicenseQuery): LicenseFileRef[] {
  const { skill, referenced, ancestors, root } = gather(index, query);
  return [...skill.deciding, ...referenced, ...ancestors.flatMap((level) => level.deciding), ...root.deciding];
}

const isDetected = (github: string | null): github is string => github !== null && github !== "NOASSERTION";

type PieceStatus = "identified" | "restricted" | "multiple" | "unknown" | "unread" | "custom";

// One piece of evidence that takes part in a decision.
interface Piece {
  status: PieceStatus;
  spdx: string | null;
}

type Decision =
  | { outcome: "identified"; spdx: string }
  | { outcome: "custom"; allUnknown: boolean }
  | { outcome: "ambiguous"; unread?: "license-file" };

// A piece not read: ambiguous (not re-read). A text holding several licenses: ambiguous.
// Every piece agrees on one id: identified. No piece identified: custom. Otherwise ambiguous.
function decide(pieces: Piece[]): Decision {
  if (pieces.some((piece) => piece.status === "unread")) return { outcome: "ambiguous", unread: "license-file" };
  if (pieces.some((piece) => piece.status === "multiple")) return { outcome: "ambiguous" };
  const ids = new Set(pieces.flatMap((piece) => (piece.spdx === null ? [] : [piece.spdx])));
  const others = pieces.filter((piece) => piece.spdx === null).length;
  if (ids.size === 0) {
    return { outcome: "custom", allUnknown: pieces.every((piece) => piece.status === "unknown") };
  }
  if (ids.size === 1 && others === 0) return { outcome: "identified", spdx: [...ids][0] };
  return { outcome: "ambiguous" };
}

// Root files next to GitHub's detection. null and NOASSERTION are no detection, not a
// disagreement: identified root files decide unless GitHub detected another id, and root
// files that are all unknown defer to GitHub's id. Restricted, multiple or unread texts never
// defer. byGithub tells whether GitHub's id decided.
function decideWithGithub(pieces: Piece[], github: string | null): { decision: Decision; byGithub: boolean } {
  const decision = decide(pieces);
  if (decision.outcome === "custom" && decision.allUnknown && isDetected(github)) {
    return { decision: { outcome: "identified", spdx: github }, byGithub: true };
  }
  if (decision.outcome === "identified" && isDetected(github) && decision.spdx !== github) {
    return { decision: { outcome: "ambiguous" }, byGithub: false };
  }
  return { decision, byGithub: false };
}

export function resolveLicense(
  index: LicenseIndex,
  query: LicenseQuery,
  read: (file: LicenseFileRef) => TextIdentification | undefined,
): LicenseResolution {
  const gathered = gather(index, query);
  const fileEvidence = (file: LicenseFileRef, level: EvidenceLevel, deciding: boolean): LicenseEvidence => {
    const base = { kind: "file" as const, level, path: file.path, blob: file.blob };
    if (!deciding) return { ...base, status: "auxiliary", spdx: null };
    const identification = read(file);
    if (identification === undefined) return { ...base, status: "unread", spdx: null };
    if (identification.kind === "spdx") return { ...base, status: "identified", spdx: identification.spdx };
    return { ...base, status: identification.kind, spdx: null };
  };
  const levelEvidence = (files: LevelFiles, level: EvidenceLevel): LicenseEvidence[] => [
    ...files.deciding.map((file) => fileEvidence(file, level, true)),
    ...files.auxiliary.map((file) => fileEvidence(file, level, false)),
  ];

  const skillFiles = [
    ...gathered.skill.deciding.map((file) => fileEvidence(file, "skill", true)),
    ...gathered.referenced.map((file) => fileEvidence(file, "skill", true)),
  ];
  const frontmatter = gathered.frontmatter;
  const frontmatterSpdx =
    frontmatter?.kind === "spdx" || frontmatter?.kind === "file" ? (frontmatter.spdx ?? null) : null;
  const frontmatterEvidence: LicenseEvidence[] =
    query.frontmatterLicense === undefined
      ? []
      : [
          {
            kind: "frontmatter",
            level: "skill",
            path: skillFilePath(query.skillPath),
            value: query.frontmatterLicense,
            spdx: frontmatterSpdx,
          },
        ];
  const ancestorEvidence = gathered.ancestors.map((files) => levelEvidence(files, "ancestor"));
  const rootFiles = gathered.root.deciding.map((file) => fileEvidence(file, "repository", true));
  const githubEvidence: LicenseEvidence[] =
    query.githubLicense === null
      ? []
      : [
          {
            kind: "github",
            level: "repository",
            value: query.githubLicense,
            spdx: isDetected(query.githubLicense) ? query.githubLicense : null,
          },
        ];
  const evidence = [
    ...skillFiles,
    ...gathered.skill.auxiliary.map((file) => fileEvidence(file, "skill", false)),
    ...frontmatterEvidence,
    ...ancestorEvidence.flat(),
    ...rootFiles,
    ...gathered.root.auxiliary.map((file) => fileEvidence(file, "repository", false)),
    ...githubEvidence,
  ];
  const revision = query.revision === undefined ? {} : { revision: query.revision };
  const result = (decision: Decision, level: EvidenceLevel): LicenseResolution => {
    if (decision.outcome === "identified") {
      return { outcome: "identified", spdx: decision.spdx, level, evidence, ...revision };
    }
    if (decision.outcome === "custom") return { outcome: "custom", level, evidence, ...revision };
    return decision.unread
      ? { outcome: "ambiguous", level, unread: decision.unread, evidence, ...revision }
      : { outcome: "ambiguous", level, evidence, ...revision };
  };
  const piecesOf = (entries: LicenseEvidence[]): Piece[] =>
    entries.flatMap((entry) =>
      entry.kind === "file" && entry.status !== "auxiliary" ? [{ status: entry.status, spdx: entry.spdx }] : [],
    );

  if (skillFiles.length > 0 || frontmatterEvidence.length > 0) {
    if (gathered.missingReference) return result({ outcome: "ambiguous" }, "skill");
    const pieces = piecesOf(skillFiles);
    // A reference without a stated id defers to its files: it is not a piece of its own.
    if (frontmatter?.kind === "custom") pieces.push({ status: "custom", spdx: null });
    else if (frontmatterSpdx !== null) pieces.push({ status: "identified", spdx: frontmatterSpdx });
    const isRootSkill = query.skillPath === "";
    // A root skill's own license files are the repository's too: GitHub's detection applies
    // to them as for any other skill, unless the front matter states something.
    if (isRootSkill && frontmatter === null) {
      const { decision, byGithub } = decideWithGithub(pieces, query.githubLicense);
      return result(decision, byGithub ? "repository" : "skill");
    }
    const decision = decide(pieces);
    const rootDisagrees =
      isRootSkill &&
      skillFiles.length > 0 &&
      decision.outcome === "identified" &&
      isDetected(query.githubLicense) &&
      decision.spdx !== query.githubLicense;
    return result(rootDisagrees ? { outcome: "ambiguous" } : decision, "skill");
  }
  // Files past the cut are unknown: a license in the skill folder may be among them.
  if (query.truncated) return { outcome: "ambiguous", level: "none", evidence, ...revision };
  // The nearest ancestor folder with a deciding license governs its subtree.
  const nearest = ancestorEvidence.find((entries) => piecesOf(entries).length > 0);
  if (nearest) return result(decide(piecesOf(nearest)), "ancestor");
  if (rootFiles.length === 0) {
    return isDetected(query.githubLicense)
      ? result({ outcome: "identified", spdx: query.githubLicense }, "repository")
      : { outcome: "missing", level: "none", evidence, ...revision };
  }
  return result(decideWithGithub(piecesOf(rootFiles), query.githubLicense).decision, "repository");
}

// The license of a changed skill whose SKILL.md could not be read this run: not decided,
// and reported as not re-read rather than as a license problem.
export function notReReadLicense(revision?: string): LicenseResolution {
  return revision === undefined
    ? { outcome: "ambiguous", level: "none", unread: "skill-file", evidence: [] }
    : { outcome: "ambiguous", level: "none", unread: "skill-file", evidence: [], revision };
}

// The evidence shown for an identified license: the first piece of the deciding level that
// names the resolved id (a file before the front matter, a root file before GitHub).
export function decidingEvidence(license: LicenseResolution): LicenseEvidence | undefined {
  if (license.outcome !== "identified") return undefined;
  return license.evidence.find(
    (entry) =>
      entry.level === license.level &&
      entry.spdx === license.spdx &&
      (entry.kind !== "file" || entry.status === "identified"),
  );
}

// A license file or the SKILL.md was not read this run: wait for the next run.
export function isNotReRead(license: LicenseResolution | undefined): boolean {
  return license?.outcome === "ambiguous" && license.unread !== undefined;
}

// Why a skill cannot be published, or null when its license allows it.
export function licenseIneligibility(
  license: LicenseResolution | undefined,
  allowed: readonly string[],
): string | null {
  if (!license) return "license unresolved";
  if (isNotReRead(license)) return "license not re-read";
  if (license.outcome !== "identified") return `license ${license.outcome}`;
  return allowed.includes(license.spdx) ? null : `license ${license.spdx} not allowed`;
}

export function isLicenseEligible(license: LicenseResolution | undefined, allowed: readonly string[]): boolean {
  return licenseIneligibility(license, allowed) === null;
}

// ---------------------------------------------------------------------------------------
// Publication policy (docs/LICENSE-RESOLUTION.md, "Publication policy")

// Whether the automated safety scan found nothing blocking in a skill.
export type SafetyCleared = (skill: SkillRecord) => boolean;

// The safety scan is not integrated yet: no skill is cleared.
export const NO_SAFETY_SCAN: SafetyCleared = () => false;

export const NO_LICENSE_LABEL = "No license";
export const UNCLEAR_LICENSE_LABEL = "Unclear license";
export const WAITING_FOR_SAFETY_SCAN = "waiting for the safety scan";

// publishable: may enter the catalog. waiting: not yet (pending when approved), with the
// reason shown to the curator.
export type Publication = { status: "publishable" } | { status: "waiting"; reason: string };

// An identified allowed license publishes. Any other identified license, a missing license,
// or an unclear one (custom, or ambiguous after every file was read) publishes once the
// safety scan clears the skill. A license not re-read this run, or a record not resolved
// yet, waits for the next run. The scan is consulted only when it decides.
export function publication(
  skill: SkillRecord,
  allowed: readonly string[],
  isSafetyCleared: SafetyCleared,
): Publication {
  const license = skill.license;
  if (!license) return { status: "waiting", reason: "license unresolved" };
  if (isNotReRead(license)) return { status: "waiting", reason: "license not re-read" };
  if (license.outcome === "identified" && allowed.includes(license.spdx)) return { status: "publishable" };
  return isSafetyCleared(skill) ? { status: "publishable" } : { status: "waiting", reason: WAITING_FOR_SAFETY_SCAN };
}

export function isPublishable(
  skill: SkillRecord,
  allowed: readonly string[],
  isSafetyCleared: SafetyCleared,
): boolean {
  return publication(skill, allowed, isSafetyCleared).status === "publishable";
}

export type LicenseCategory = "permissive" | "copyleft" | "other" | "none" | "unclear";

// Copyleft families: their obligations differ from a permissive license's.
const COPYLEFT_ID = /^(?:a|l)?gpl-|^mpl-|^cc-by-sa-/i;

// So the catalog can explain obligations: permissive (allowed), copyleft, other identified
// ids (CC0, CC-BY...), none (missing) or unclear (custom, ambiguous).
export function licenseCategory(license: LicenseResolution, allowed: readonly string[]): LicenseCategory {
  if (license.outcome === "missing") return "none";
  if (license.outcome !== "identified") return "unclear";
  if (allowed.includes(license.spdx)) return "permissive";
  return COPYLEFT_ID.test(license.spdx) ? "copyleft" : "other";
}

// What the catalog shows: the SPDX id when identified, otherwise an honest label, never a
// permissive id without evidence.
export function licenseLabel(license: LicenseResolution): string {
  if (license.outcome === "identified") return license.spdx;
  return license.outcome === "missing" ? NO_LICENSE_LABEL : UNCLEAR_LICENSE_LABEL;
}

// ---------------------------------------------------------------------------------------
// The cache file

export const LicenseCacheFileSchema = z.object({
  rulesVersion: z.number().int(),
  entries: LicenseCacheSchema,
});
export type LicenseCacheFile = z.infer<typeof LicenseCacheFileSchema>;

// The cached entries when they were identified by the current rules. Another version, the
// shape written before rules versions, or no file: an empty cache. A file of the current
// version with an invalid entry is an error, like any corrupted cache.
export function readLicenseCache(data: unknown): LicenseCache {
  const versioned = z.object({ rulesVersion: z.number().int() }).safeParse(data);
  if (!versioned.success || versioned.data.rulesVersion !== LICENSE_RULES_VERSION) return {};
  return LicenseCacheFileSchema.parse(data).entries;
}

// Sorted by blob id so the versioned cache changes only where a file changed.
export function licenseCacheFile(cache: LicenseCache): LicenseCacheFile {
  return {
    rulesVersion: LICENSE_RULES_VERSION,
    entries: Object.fromEntries(Object.entries(cache).sort(([a], [b]) => compareText(a, b))),
  };
}
