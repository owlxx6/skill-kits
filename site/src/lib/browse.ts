// Filtering, sorting and URL state for the Browse page. Pure functions, shared by the page
// script and the tests, so a filtered list can be shared as a link and rebuilt identically.
import type { SecurityLevel } from "./labels";

export interface BrowseItem {
  id: string;
  kind: "skill" | "collection";
  title: string;
  license: string;
  kits: string[];
  security: SecurityLevel;
  updated: string;
  rating: number;
  stars: number;
}

export type BrowseType = "all" | "skill" | "collection";
export type BrowseSort = "best" | "rating" | "updated" | "name";

export interface BrowseState {
  q: string;
  type: BrowseType;
  kits: string[];
  security: SecurityLevel[];
  licenses: string[];
  sort: BrowseSort;
}

const TYPES: BrowseType[] = ["all", "skill", "collection"];
const SORTS: BrowseSort[] = ["best", "rating", "updated", "name"];
const LEVELS: SecurityLevel[] = ["none", "notice", "severe"];

export const DEFAULT_STATE: BrowseState = { q: "", type: "all", kits: [], security: [], licenses: [], sort: "best" };

const list = (params: URLSearchParams, key: string): string[] =>
  [...new Set(params.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];

export function parseBrowseState(params: URLSearchParams): BrowseState {
  const type = params.get("type") as BrowseType | null;
  const sort = params.get("sort") as BrowseSort | null;
  return {
    q: (params.get("q") ?? "").trim(),
    type: type && TYPES.includes(type) ? type : "all",
    kits: list(params, "kit"),
    security: list(params, "security").filter((value): value is SecurityLevel => LEVELS.includes(value as SecurityLevel)),
    licenses: list(params, "license"),
    sort: sort && SORTS.includes(sort) ? sort : "best",
  };
}

/** Only non-default values are written, so a plain search stays a short link. */
export function browseStateToParams(state: BrowseState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.type !== "all") params.set("type", state.type);
  for (const kit of state.kits) params.append("kit", kit);
  for (const level of state.security) params.append("security", level);
  for (const license of state.licenses) params.append("license", license);
  if (state.sort !== "best") params.set("sort", state.sort);
  return params;
}

export function activeFilterCount(state: BrowseState): number {
  return state.kits.length + state.security.length + state.licenses.length + (state.type === "all" ? 0 : 1);
}

type Facet = "type" | "kits" | "security" | "licenses";

function matches(item: BrowseItem, state: BrowseState, skip?: Facet): boolean {
  if (skip !== "type" && state.type !== "all" && item.kind !== state.type) return false;
  if (skip !== "kits" && state.kits.length && !item.kits.some((kit) => state.kits.includes(kit))) return false;
  if (skip !== "security" && state.security.length && !state.security.includes(item.security)) return false;
  if (skip !== "licenses" && state.licenses.length && !state.licenses.includes(item.license)) return false;
  return true;
}

const byName = (a: BrowseItem, b: BrowseItem) => a.title.localeCompare(b.title, "en") || a.id.localeCompare(b.id, "en");

/**
 * `items` arrive in relevance order when there is a query. Without one, "best" lists collections
 * first (most starred), then skills by review score: the same order the home page recommends.
 */
export function applyBrowse<T extends BrowseItem>(items: T[], state: BrowseState): T[] {
  const kept = items.filter((item) => matches(item, state));
  const sorted = [...kept];
  switch (state.sort) {
    case "best":
      if (!state.q) {
        sorted.sort((a, b) =>
          a.kind !== b.kind ? (a.kind === "collection" ? -1 : 1)
          : a.kind === "collection" ? b.stars - a.stars || byName(a, b)
          : b.rating - a.rating || byName(a, b));
      }
      break;
    case "rating":
      // Collections have no review score of their own; they follow the skills, most starred first.
      sorted.sort((a, b) =>
        a.kind !== b.kind ? (a.kind === "skill" ? -1 : 1)
        : a.kind === "skill" ? b.rating - a.rating || byName(a, b)
        : b.stars - a.stars || byName(a, b));
      break;
    case "updated":
      sorted.sort((a, b) => b.updated.localeCompare(a.updated) || byName(a, b));
      break;
    case "name":
      sorted.sort(byName);
      break;
  }
  return sorted;
}

export interface FacetCounts {
  type: Record<BrowseType, number>;
  kits: Record<string, number>;
  security: Record<SecurityLevel, number>;
  licenses: Record<string, number>;
}

/** Each facet counts what choosing that value would show, given the other active filters. */
export function facetCounts(items: BrowseItem[], state: BrowseState): FacetCounts {
  const counts: FacetCounts = {
    type: { all: 0, skill: 0, collection: 0 },
    kits: {},
    security: { none: 0, notice: 0, severe: 0 },
    licenses: {},
  };
  for (const item of items) {
    if (matches(item, state, "type")) {
      counts.type.all += 1;
      counts.type[item.kind] += 1;
    }
    if (matches(item, state, "kits")) for (const kit of item.kits) counts.kits[kit] = (counts.kits[kit] ?? 0) + 1;
    if (matches(item, state, "security")) counts.security[item.security] += 1;
    if (matches(item, state, "licenses")) counts.licenses[item.license] = (counts.licenses[item.license] ?? 0) + 1;
  }
  return counts;
}
