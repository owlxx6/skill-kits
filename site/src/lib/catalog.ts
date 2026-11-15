import { z } from "zod";
import {
  type Catalog,
  type CatalogCollection,
  type CatalogKit,
  type CatalogSkill,
  CatalogSchema,
} from "../../../pipeline/lib/schemas";
import { compareText } from "../../../pipeline/lib/text";
import rawCatalog from "../../../catalog.json";

export type { Catalog, CatalogCollection, CatalogKit, CatalogSkill };

export function parseCatalog(data: unknown): Catalog {
  const result = CatalogSchema.safeParse(data);
  if (!result.success) throw new Error(`catalog.json is invalid: ${z.prettifyError(result.error)}`);
  return result.data;
}

let cached: Catalog | null = null;

// Parsed once per build; every page reads the same validated catalog.
export function loadCatalog(): Catalog {
  cached ??= parseCatalog(rawCatalog);
  return cached;
}

const ROOT_SEGMENT = "_root";

export function skillSlug(id: string): string {
  const separator = id.indexOf(":");
  const repo = id.slice(0, separator);
  const dir = id.slice(separator + 1);
  return `${repo}/${dir === "." ? ROOT_SEGMENT : dir}`;
}

export function collectionSlug(id: string): { owner: string; repo: string } {
  const [owner, repo] = id.split("/");
  return { owner, repo };
}

export function skillHref(id: string): string {
  return `/skills/${skillSlug(id)}/`;
}

export function collectionHref(id: string): string {
  return `/collections/${id}/`;
}

// Format of the open "skills" CLI: `npx skills add <owner/repo> [--skill <name>]`.
export function skillInstallCommand(skill: CatalogSkill): string {
  return `npx skills add ${skill.repo} --skill ${skill.name}`;
}

export function collectionInstallCommand(id: string): string {
  return `npx skills add ${id}`;
}

export interface KitView {
  kit: CatalogKit;
  collections: CatalogCollection[];
  skills: CatalogSkill[];
  isEmpty: boolean;
}

export function kitView(catalog: Catalog, kitId: string): KitView | null {
  const kit = catalog.kits.find((entry) => entry.id === kitId);
  if (!kit) return null;
  const skillById = new Map(catalog.skills.map((entry) => [entry.id, entry]));
  const collectionById = new Map(catalog.collections.map((entry) => [entry.id, entry]));
  const collections = kit.collections.flatMap((id) => collectionById.get(id) ?? []);
  const skills = kit.skills.flatMap((id) => skillById.get(id) ?? []);
  return { kit, collections, skills, isEmpty: collections.length === 0 && skills.length === 0 };
}

export type SkillSort = "curated" | "review" | "forks";

export function sortSkills(skills: CatalogSkill[], sort: SkillSort): CatalogSkill[] {
  if (sort === "curated") return [...skills];
  const key = sort === "review" ? (entry: CatalogSkill) => entry.reviewScore : (entry: CatalogSkill) => entry.forks;
  return [...skills].sort((a, b) => key(b) - key(a) || compareText(a.id, b.id));
}

export function licenseOptions(skills: CatalogSkill[]): string[] {
  return [...new Set(skills.map((entry) => entry.license))].sort(compareText);
}

export function kitsOfSkill(catalog: Catalog, skillId: string): CatalogKit[] {
  return catalog.kits.filter((kit) => kit.skills.includes(skillId));
}

export function kitsOfCollection(catalog: Catalog, collectionId: string): CatalogKit[] {
  return catalog.kits.filter((kit) => kit.collections.includes(collectionId));
}

export function formatCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}
