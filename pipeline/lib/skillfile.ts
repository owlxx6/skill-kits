import { parse as parseYaml } from "yaml";

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

const SKILL_FILE = "SKILL.md";
const MAX_LISTED_FILES = 50;
const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

// SKILL.md files are untrusted. The front matter is cut out by hand and parsed with a
// data-only YAML parser: front matter libraries that support "---js" blocks evaluate code.
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = FRONTMATTER.exec(content);
  if (!match) return null;
  let data: unknown;
  try {
    data = parseYaml(match[1]);
  } catch {
    return null; // invalid YAML means "not a valid skill", which the caller counts
  }
  if (typeof data !== "object" || data === null) return null;
  const { name, description } = data as Record<string, unknown>;
  if (typeof name !== "string" || typeof description !== "string") return null;
  const cleanName = name.trim();
  const cleanDescription = description.trim();
  if (!cleanName || !cleanDescription) return null;
  return { name: cleanName, description: cleanDescription };
}

export function skillId(repo: string, dir: string): string {
  return `${repo}:${dir || "."}`;
}

export function skillFilePath(dir: string): string {
  return dir ? `${dir}/${SKILL_FILE}` : SKILL_FILE;
}

// The fingerprint is the git id of the skill folder: it changes when any file inside changes.
// A skill at the repository root uses the id of SKILL.md itself.
export function findSkillLocations(entries: TreeEntry[]): SkillLocation[] {
  const treeIds = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "tree") treeIds.set(entry.path, entry.sha);
  }
  const blobs = entries.filter((entry) => entry.type === "blob");
  const locations: SkillLocation[] = [];
  for (const blob of blobs) {
    const isRoot = blob.path === SKILL_FILE;
    if (!isRoot && !blob.path.endsWith(`/${SKILL_FILE}`)) continue;
    if (blob.path.split("/").includes("node_modules")) continue;
    const dir = isRoot ? "" : blob.path.slice(0, -(SKILL_FILE.length + 1));
    const prefix = isRoot ? "" : `${dir}/`;
    const files = blobs
      .filter((other) => other.path !== blob.path && other.path.startsWith(prefix))
      .map((other) => other.path.slice(prefix.length))
      .sort()
      .slice(0, MAX_LISTED_FILES);
    locations.push({
      dir,
      fingerprint: isRoot ? blob.sha : (treeIds.get(dir) ?? blob.sha),
      files,
    });
  }
  return locations.sort((a, b) => a.dir.localeCompare(b.dir));
}
