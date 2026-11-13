import { parse as parseYaml } from "yaml";
import { compareText } from "./text";

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
}

export interface SkillLocation {
  dir: string;
  fingerprint: string;
  files: string[];
}

// Only the exact file name SKILL.md counts: agent loaders look for that exact name, so case variants are ignored.
const SKILL_FILE = "SKILL.md";
const MAX_LISTED_FILES = 50;
// Limits of the Agent Skills specification.
const MAX_NAME_CHARS = 64;
const MAX_DESCRIPTION_CHARS = 1024;
const MAX_FRONTMATTER_SCAN_CHARS = 64 * 1024;
const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// Control, zero-width and bidirectional-override characters (no g flag: used with test()).
const FORBIDDEN_IN_NAME = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;
// Same set minus tab (0009) and line feed (000A), which a description may keep.
const FORBIDDEN_IN_DESCRIPTION =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

// SKILL.md files are untrusted. The front matter is cut out by hand and parsed with a
// data-only YAML parser: front matter libraries that support "---js" blocks evaluate code.
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = FRONTMATTER.exec(content.slice(0, MAX_FRONTMATTER_SCAN_CHARS));
  if (!match) return null;
  let data: unknown;
  try {
    data = parseYaml(match[1], { logLevel: "error", maxAliasCount: 100 });
  } catch {
    return null; // invalid YAML means "not a valid skill", which the caller counts
  }
  if (typeof data !== "object" || data === null) return null;
  const { name, description } = data as Record<string, unknown>;
  if (typeof name !== "string" || typeof description !== "string") return null;
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > MAX_NAME_CHARS || FORBIDDEN_IN_NAME.test(cleanName)) {
    return null;
  }
  const cleanDescription = description
    .replace(FORBIDDEN_IN_DESCRIPTION, "")
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
  if (!cleanDescription) return null;
  return { name: cleanName, description: cleanDescription };
}

// Owner and repository names cannot contain a colon, so split an id on the first colon only.
export function skillId(repo: string, dir: string): string {
  return `${repo}:${dir || "."}`;
}

export function skillFilePath(dir: string): string {
  return dir ? `${dir}/${SKILL_FILE}` : SKILL_FILE;
}

// The fingerprint is the git id of the skill folder: it changes when any file in the folder
// changes, and a parent's fingerprint also covers nested skills. A skill at the repository
// root uses the id of SKILL.md itself, so it only tracks that file.
// When GitHub truncates a large listing and the folder's tree entry is missing, the
// fingerprint falls back to the id of SKILL.md.
export function findSkillLocations(entries: TreeEntry[]): SkillLocation[] {
  const treeIds = new Map<string, string>();
  const skillFileIds = new Map<string, string>(); // skill folder -> git id of its SKILL.md
  const otherFiles: string[] = [];
  for (const entry of entries) {
    if (entry.type === "tree") {
      treeIds.set(entry.path, entry.sha);
      continue;
    }
    const segments = entry.path.split("/");
    if (segments.includes("node_modules")) continue;
    if (segments[segments.length - 1] === SKILL_FILE) {
      skillFileIds.set(segments.slice(0, -1).join("/"), entry.sha);
    } else {
      otherFiles.push(entry.path);
    }
  }
  const filesByDir = new Map<string, string[]>();
  for (const dir of skillFileIds.keys()) filesByDir.set(dir, []);
  for (const filePath of otherFiles) {
    const owner = owningSkillDir(filePath, skillFileIds);
    if (owner === null) continue;
    filesByDir.get(owner)?.push(owner ? filePath.slice(owner.length + 1) : filePath);
  }
  return [...skillFileIds.entries()]
    .map(([dir, skillFileId]) => ({
      dir,
      fingerprint: dir === "" ? skillFileId : (treeIds.get(dir) ?? skillFileId),
      files: (filesByDir.get(dir) ?? []).sort(compareText).slice(0, MAX_LISTED_FILES),
    }))
    .sort((a, b) => compareText(a.dir, b.dir));
}

// The deepest skill folder above a file owns it, so a nested skill's files
// never appear in its parent's list.
function owningSkillDir(filePath: string, skillDirs: Map<string, string>): string | null {
  const segments = filePath.split("/");
  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const dir = segments.slice(0, depth).join("/");
    if (skillDirs.has(dir)) return dir;
  }
  return skillDirs.has("") ? "" : null;
}
