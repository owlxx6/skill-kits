import { z } from "zod";
import {
  type Catalog as RawCatalog,
  type CatalogCollection,
  type CatalogKit,
  type CatalogSkill as ReviewedSkill,
  type DirectorySkill,
  CatalogSchema,
} from "../../../pipeline/lib/schemas";
import { compareText } from "../../../pipeline/lib/text";
import rawCatalog from "../../../catalog.json";
import { securityLabel, type SecurityLevel } from "./labels";

export type CatalogSkill = DirectorySkill;
export type Catalog = Omit<RawCatalog, "skills"> & { skills: DirectorySkill[] };
export type { CatalogCollection, CatalogKit, SecurityLevel };
export { securityLabel };

export function parseCatalog(data: unknown): Catalog {
  const result = CatalogSchema.safeParse(data);
  if (!result.success) throw new Error(`catalog.json is invalid: ${z.prettifyError(result.error)}`);
  const reviewedIds = new Set(result.data.skills.map(skill => skill.id));
  return {...result.data, skills: [...result.data.skills, ...(result.data.sourceSkills ?? []).filter(skill => !reviewedIds.has(skill.id))]};
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
  const revision=skill.url.match(/\/tree\/([a-f0-9]{40})(?:\/|$)/)?.[1];
  return `npx skills add ${skill.repo}${revision ? '@'+revision : ''} --skill ${skill.name}`;
}

export function collectionInstallCommand(id: string, revision?:string): string {
  return `npx skills add ${id}${revision && /^[a-f0-9]{40}$/.test(revision) ? '@'+revision : ''}`;
}

export function collectionCoverageLabel(collection: Pick<CatalogCollection, "catalogSkillIds" | "skillCount">): string {
  return `${collection.catalogSkillIds.length} of ${collection.skillCount} skills listed`;
}

export function collectionInstallScope(collection: Pick<CatalogCollection, "catalogSkillIds" | "skillCount" | "installScope" | "revision">): string {
  if(collection.installScope!=="repository" || !collection.revision || !/^[a-f0-9]{40}$/.test(collection.revision) || collection.catalogSkillIds.length!==collection.skillCount) return "Choose individual installs from the listed skills. Whole-repository installation is unavailable.";
  return collection.catalogSkillIds.length < collection.skillCount
    ? "Installs every skill in this repository, not only the skills listed here."
    : "Installs every skill in this repository.";
}

export function reviewLabel(): string {
  return "Session reviewed";
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
  const key = sort === "review" ? (entry: CatalogSkill) => entry.reviewScore ?? -1 : (entry: CatalogSkill) => entry.forks;
  return [...skills].sort((a, b) => key(b) - key(a) || compareText(a.id, b.id));
}

export function licenseOptions(skills: CatalogSkill[]): string[] {
  return [...new Set(skills.map((entry) => entry.license))].sort(compareText);
}

export function kitsOfSkill(catalog: Catalog, skillId: string): CatalogKit[] {
  const repo = catalog.skills.find(skill => skill.id === skillId)?.repo;
  return catalog.kits.filter((kit) => kit.skills.includes(skillId) || (repo !== undefined && kit.collections.includes(repo)));
}

export function kitsOfCollection(catalog: Catalog, collectionId: string): CatalogKit[] {
  return catalog.kits.filter((kit) => kit.collections.includes(collectionId));
}

export function formatCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

/** Mixed collections describe every included license when the optional list is available. */
export function collectionLicenseLabel(collection: Pick<CatalogCollection, "license" | "licenses">): string {
  if (collection.license !== "Mixed" || !collection.licenses?.length) return collection.license;
  return "Mixed (" + collection.licenses.join(", ") + ")";
}

// ---------------------------------------------------------------- trust, scope and ranking helpers

const SECURITY_RANK: Record<SecurityLevel, number> = { none: 0, notice: 1, severe: 2 };

/** The scan level only. Scan notes stay private and are never read here. */
export function securityLevel(skill: Pick<CatalogSkill, "review">): SecurityLevel {
  return skill.review?.security?.level ?? "none";
}

export function highestSecurityLevel(levels: Iterable<SecurityLevel>): SecurityLevel {
  let highest: SecurityLevel = "none";
  for (const level of levels) if (SECURITY_RANK[level] > SECURITY_RANK[highest]) highest = level;
  return highest;
}

/** Highest level among the skills of this repository that the catalog lists. */
export function listedSecurityLevel(catalog: Catalog, repoId: string): SecurityLevel {
  return highestSecurityLevel(catalog.skills.filter((skill) => skill.repo === repoId).map(securityLevel));
}

export function isPartialCollection(collection: Pick<CatalogCollection, "catalogSkillIds" | "skillCount">): boolean {
  return collection.catalogSkillIds.length < collection.skillCount;
}

export function unlistedCount(collection: Pick<CatalogCollection, "catalogSkillIds" | "skillCount">): number {
  return Math.max(0, collection.skillCount - collection.catalogSkillIds.length);
}

/** One line that installs every part of a kit, in the curator's order. */
export function kitInstallCommand(collectionIds: string[]): string {
  return collectionIds.map(id=>collectionInstallCommand(id)).join(" && ");
}

export function collectionsByStars(catalog: Catalog, limit: number): CatalogCollection[] {
  return [...catalog.collections].sort((a, b) => b.stars - a.stars || compareText(a.id, b.id)).slice(0, limit);
}

/** Highest review score first, at most one skill per repository so one publisher cannot fill the row. */
export function topSkillPerRepo(catalog: Catalog, limit: number): ReviewedSkill[] {
  const seen = new Set<string>();
  const picks: ReviewedSkill[] = [];
  const sorted = catalog.skills.filter((skill): skill is ReviewedSkill => skill.review !== undefined && skill.reviewScore >= 6)
    .sort((a, b) => b.reviewScore - a.reviewScore || compareText(a.name, b.name));
  for (const skill of sorted) {
    if (seen.has(skill.repo)) continue;
    seen.add(skill.repo);
    picks.push(skill);
    if (picks.length === limit) break;
  }
  return picks;
}

/** Other listed skills with the same name from another repository, so look-alike names can be told apart. */
export function sameNameSkills(catalog: Catalog, skill: Pick<CatalogSkill, "id" | "name">): CatalogSkill[] {
  return catalog.skills.filter((entry) => entry.name === skill.name && entry.id !== skill.id);
}

export function displayDate(iso: string): string {
  return iso.slice(0, 10);
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;
}
