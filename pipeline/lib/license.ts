import type { LicenseEvidence, LicenseLevel, LicenseResolution } from "./schemas";
import { type TreeEntry, skillFilePath } from "./skillfile";
import { compareText } from "./text";

// Pure license resolution, see docs/LICENSE-RESOLUTION.md. No network: file texts are
// identified by the caller and passed in through spdxOfBlob.

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

// LICENSE, LICENCE or COPYING, alone or followed by an extension or suffix.
const LICENSE_NAME = /^(?:licen[cs]e|copying)(?:[.\-_][a-z0-9.+_-]*)?$/i;
// A source file named license.py is code, not a license text.
const CODE_EXTENSION =
  /\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx|py|sh|bash|zsh|rb|go|rs|java|kt|json|ya?ml|toml|html?|css|xml|php|c|h|cc|cpp|cs|swift|pl|lua|ps1|bat)$/i;
const TEXT_EXTENSION = /\.(?:txt|md|markdown|rst|text)$/i;

export function isLicenseFileName(name: string): boolean {
  return LICENSE_NAME.test(name) && !CODE_EXTENSION.test(name);
}

// Lowercase, straight quotes, no Markdown emphasis or heading marks, single spaces:
// a reflowed or Markdown-formatted copy of a license reads the same.
function normalizeText(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[*#>`_]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// Terms that restrict a permissive text: never read as the plain license.
const RESTRICTIONS = /commons clause|non-?commercial/;

interface TextRule {
  spdx: string;
  test: (text: string) => boolean;
}

const BSD_BASE = [
  "redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met",
  "redistributions of source code must retain the above copyright notice",
  "redistributions in binary form must reproduce the above copyright notice",
];
const isBsd = (text: string): boolean =>
  BSD_BASE.every((phrase) => text.includes(phrase)) && !text.includes("advertising materials");
const BSD_ENDORSEMENT = "may be used to endorse or promote products derived from this software";

// Distinctive phrases of each license, with the version where a family has several.
const TEXT_RULES: TextRule[] = [
  {
    spdx: "MIT",
    test: (text) =>
      text.includes("permission is hereby granted, free of charge, to any person obtaining a copy") &&
      text.includes(
        "the above copyright notice and this permission notice shall be included in all copies or substantial portions of the software",
      ),
  },
  {
    spdx: "ISC",
    test: (text) =>
      /permission to use, copy, modify, and(?:\/or)? distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies/.test(
        text,
      ),
  },
  { spdx: "BSD-3-Clause", test: (text) => isBsd(text) && text.includes(BSD_ENDORSEMENT) },
  { spdx: "BSD-2-Clause", test: (text) => isBsd(text) && !text.includes(BSD_ENDORSEMENT) },
  {
    spdx: "Apache-2.0",
    test: (text) =>
      /apache license,? version 2\.0,? january 2004/.test(text) ||
      text.includes("licensed under the apache license, version 2.0"),
  },
  { spdx: "GPL-2.0", test: (text) => text.includes("gnu general public license version 2, june 1991") },
  { spdx: "GPL-3.0", test: (text) => text.includes("gnu general public license version 3, 29 june 2007") },
  {
    spdx: "LGPL-2.1",
    test: (text) => text.includes("gnu lesser general public license version 2.1, february 1999"),
  },
  {
    spdx: "LGPL-3.0",
    test: (text) => text.includes("gnu lesser general public license version 3, 29 june 2007"),
  },
  {
    spdx: "AGPL-3.0",
    test: (text) => text.includes("gnu affero general public license version 3, 19 november 2007"),
  },
];

// Conservative: exactly one license must match, with no restricting terms. Anything else is
// null, which means custom: a text is never guessed.
export function identifyLicenseText(text: string): string | null {
  const normalized = normalizeText(text);
  if (RESTRICTIONS.test(normalized)) return null;
  const matches = TEXT_RULES.filter((rule) => rule.test(normalized));
  return matches.length === 1 ? matches[0].spdx : null;
}

export type FrontmatterLicense =
  | { kind: "spdx"; spdx: string }
  | { kind: "file"; names: string[] }
  | { kind: "custom" };

// GNU ids also come as -only or -or-later; GitHub reports both under the base id.
function knownSpdx(value: string): string | null {
  const lower = value.trim().toLowerCase().replace(/^((?:a|l)?gpl-\d\.\d)-(?:only|or-later)$/, "$1");
  return KNOWN_BY_LOWER.get(lower) ?? null;
}

// A word names a file when it is a license file name with an extension or suffix, an
// upper-case LICENSE, LICENCE or COPYING, or any name with a text extension. "MIT License"
// therefore names no file.
function fileReference(word: string): string | null {
  const name = word.replace(/^[("'<]+/, "").replace(/[)"'>.,;:!?]+$/, "").replace(/^\.\//, "");
  if (!name) return null;
  const base = name.slice(name.lastIndexOf("/") + 1);
  const bare = /^(?:LICEN[CS]E|COPYING)$/.test(base);
  const suffixed = isLicenseFileName(base) && /^(?:licen[cs]e|copying)[.\-_]/i.test(base);
  if (bare || suffixed || (TEXT_EXTENSION.test(base) && /^[\w.+-]+$/.test(base))) return name;
  return null;
}

export function identifyFrontmatterLicense(value: string): FrontmatterLicense {
  const spdx = knownSpdx(value);
  if (spdx) return { kind: "spdx", spdx };
  const names: string[] = [];
  for (const word of value.split(/[\s,;]+/)) {
    const name = fileReference(word);
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length > 0 ? { kind: "file", names } : { kind: "custom" };
}

export interface LicenseFileRef {
  path: string;
  blob: string;
}

export interface LicenseIndex {
  // License files directly in each folder ("" is the root), sorted by path.
  byDir: Map<string, LicenseFileRef[]>;
  // Every file of the tree, to resolve a front matter reference.
  blobs: Map<string, string>;
}

const dirOf = (filePath: string): string => {
  const slash = filePath.lastIndexOf("/");
  return slash < 0 ? "" : filePath.slice(0, slash);
};

export function indexLicenseFiles(entries: TreeEntry[]): LicenseIndex {
  const byDir = new Map<string, LicenseFileRef[]>();
  const blobs = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    blobs.set(entry.path, entry.sha);
    if (!isLicenseFileName(entry.path.slice(entry.path.lastIndexOf("/") + 1))) continue;
    const dir = dirOf(entry.path);
    const list = byDir.get(dir) ?? [];
    list.push({ path: entry.path, blob: entry.sha });
    byDir.set(dir, list);
  }
  for (const list of byDir.values()) list.sort((a, b) => compareText(a.path, b.path));
  return { byDir, blobs };
}

export interface LicenseQuery {
  skillPath: string;
  frontmatterLicense?: string;
  // RepoMeta.license: the id GitHub detected, NOASSERTION or null.
  githubLicense: string | null;
  // The tree listing was cut by GitHub: files may be missing from it.
  truncated: boolean;
}

const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

// Folders between the skill folder and the root, nearest first.
function ancestorDirs(skillPath: string): string[] {
  if (!skillPath) return [];
  const parts = skillPath.split("/");
  const dirs: string[] = [];
  for (let depth = parts.length - 1; depth >= 1; depth -= 1) dirs.push(parts.slice(0, depth).join("/"));
  return dirs;
}

interface Gathered {
  skillFiles: LicenseFileRef[];
  frontmatter: FrontmatterLicense | null;
  missingReference: boolean;
  ancestorFiles: LicenseFileRef[];
  rootFiles: LicenseFileRef[];
}

function gather(index: LicenseIndex, query: LicenseQuery): Gathered {
  const skillFiles = [...(index.byDir.get(query.skillPath) ?? [])];
  const frontmatter =
    query.frontmatterLicense === undefined ? null : identifyFrontmatterLicense(query.frontmatterLicense);
  let missingReference = false;
  if (frontmatter?.kind === "file") {
    for (const name of frontmatter.names) {
      const filePath = joinPath(query.skillPath, name);
      const blob = index.blobs.get(filePath);
      if (blob === undefined) missingReference = true;
      else if (!skillFiles.some((file) => file.path === filePath)) skillFiles.push({ path: filePath, blob });
    }
  }
  const ancestorFiles = ancestorDirs(query.skillPath).flatMap((dir) => index.byDir.get(dir) ?? []);
  // For a skill at the root, root files are its own: they count at the skill level.
  const rootFiles = query.skillPath ? (index.byDir.get("") ?? []) : [];
  return { skillFiles, frontmatter, missingReference, ancestorFiles, rootFiles };
}

// The files whose text must be identified to resolve this skill, nearest first.
export function licenseFilesFor(index: LicenseIndex, query: LicenseQuery): LicenseFileRef[] {
  const { skillFiles, ancestorFiles, rootFiles } = gather(index, query);
  return [...skillFiles, ...ancestorFiles, ...rootFiles];
}

const isDetected = (github: string | null): github is string =>
  github !== null && github !== "NOASSERTION";

type Decision = Pick<LicenseResolution, "outcome" | "spdx">;

// Every piece agrees on one id: identified. No piece identified: custom. Otherwise ambiguous.
function decide(pieces: (string | null)[]): Decision {
  const ids = new Set(pieces.filter((piece): piece is string => piece !== null));
  if (ids.size === 0) return { outcome: "custom" };
  if (ids.size === 1 && !pieces.includes(null)) return { outcome: "identified", spdx: [...ids][0] };
  return { outcome: "ambiguous" };
}

// At the repository level, an identified root file must agree with GitHub's detection;
// an unidentified root file defers to GitHub's detected id.
function decideRepository(rootIds: (string | null)[], github: string | null): Decision {
  if (rootIds.length === 0) {
    return isDetected(github) ? { outcome: "identified", spdx: github } : { outcome: "missing" };
  }
  const files = decide(rootIds);
  if (files.outcome === "custom") {
    return isDetected(github) ? { outcome: "identified", spdx: github } : { outcome: "custom" };
  }
  if (files.outcome === "identified" && files.spdx === github) return files;
  return { outcome: "ambiguous" };
}

export function resolveLicense(
  index: LicenseIndex,
  query: LicenseQuery,
  spdxOfBlob: (blob: string) => string | null,
): LicenseResolution {
  const gathered = gather(index, query);
  const fileEvidence = (files: LicenseFileRef[]): LicenseEvidence[] =>
    files.map((file) => ({ kind: "file", path: file.path, blob: file.blob, spdx: spdxOfBlob(file.blob) }));
  const skillFileEvidence = fileEvidence(gathered.skillFiles);
  const frontmatterEvidence: LicenseEvidence[] =
    query.frontmatterLicense === undefined
      ? []
      : [
          {
            kind: "frontmatter",
            path: skillFilePath(query.skillPath),
            value: query.frontmatterLicense,
            spdx: gathered.frontmatter?.kind === "spdx" ? gathered.frontmatter.spdx : null,
          },
        ];
  const ancestorEvidence = fileEvidence(gathered.ancestorFiles);
  const rootEvidence = fileEvidence(gathered.rootFiles);
  const githubEvidence: LicenseEvidence[] =
    query.githubLicense === null
      ? []
      : [
          {
            kind: "github",
            value: query.githubLicense,
            spdx: isDetected(query.githubLicense) ? query.githubLicense : null,
          },
        ];
  const evidence = [
    ...skillFileEvidence,
    ...frontmatterEvidence,
    ...ancestorEvidence,
    ...rootEvidence,
    ...githubEvidence,
  ];
  const spdxOf = (entries: LicenseEvidence[]): (string | null)[] => entries.map((entry) => entry.spdx);
  const result = (decision: Decision, level: LicenseLevel): LicenseResolution =>
    decision.outcome === "identified"
      ? { outcome: "identified", spdx: decision.spdx, level, evidence }
      : { outcome: decision.outcome, level, evidence };

  if (skillFileEvidence.length > 0 || frontmatterEvidence.length > 0) {
    if (gathered.missingReference) return result({ outcome: "ambiguous" }, "skill");
    // A front matter reference defers to the file: it is not a piece of its own.
    const pieces = [
      ...spdxOf(skillFileEvidence),
      ...(gathered.frontmatter?.kind === "file" ? [] : spdxOf(frontmatterEvidence)),
    ];
    return result(decide(pieces), "skill");
  }
  // Files past the cut are unknown: a license in the skill folder may be among them.
  if (query.truncated) return result({ outcome: "ambiguous" }, "none");
  if (ancestorEvidence.length > 0) return result(decide(spdxOf(ancestorEvidence)), "ancestor");
  const repository = decideRepository(spdxOf(rootEvidence), query.githubLicense);
  return result(repository, repository.outcome === "missing" ? "none" : "repository");
}

// Level of one piece of evidence for the skill at skillPath.
function evidenceLevel(entry: LicenseEvidence, skillPath: string): LicenseLevel {
  if (entry.kind === "github") return "repository";
  if (entry.kind === "frontmatter") return "skill";
  const dir = dirOf(entry.path);
  if (dir === skillPath) return "skill";
  return dir === "" ? "repository" : "ancestor";
}

// The evidence shown for an identified license: the first piece of the deciding level that
// names the resolved id (a file before the front matter, a root file before GitHub).
export function decidingEvidence(
  license: LicenseResolution,
  skillPath: string,
): LicenseEvidence | undefined {
  if (license.outcome !== "identified") return undefined;
  return license.evidence.find(
    (entry) => entry.spdx === license.spdx && evidenceLevel(entry, skillPath) === license.level,
  );
}

// Why a skill cannot be published, or null when its license allows it.
export function licenseIneligibility(
  license: LicenseResolution | undefined,
  allowed: readonly string[],
): string | null {
  if (!license) return "license unresolved";
  if (license.outcome !== "identified" || license.spdx === undefined) return `license ${license.outcome}`;
  return allowed.includes(license.spdx) ? null : `license ${license.spdx} not allowed`;
}

export function isLicenseEligible(
  license: LicenseResolution | undefined,
  allowed: readonly string[],
): boolean {
  return licenseIneligibility(license, allowed) === null;
}
