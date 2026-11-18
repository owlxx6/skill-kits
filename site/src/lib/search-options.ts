// Client-safe: the Browse page imports this module, so it must not pull in catalog.json.
import type { Options } from "minisearch";
import type { SecurityLevel } from "./labels";

export interface SearchDocument {
  id: string;
  kind: "skill" | "collection";
  title: string;
  text: string;
  keywords: string;
  license: string;
  href: string;
  why: string;
  coverage?: string;
  installScope?: string;
  reviewStatus: string;
  // Browse filters and sorting ("rating", not "score": MiniSearch puts its own relevance score on each hit). Only public values: the scan level, never its notes.
  repo: string;
  kits: string[];
  security: SecurityLevel;
  updated: string;
  rating: number | null;
  stars: number;
  partial: boolean;
}

// Shared by the build and the browser: the index must be loaded with the options it was built with.
export const SEARCH_OPTIONS: Options<SearchDocument> = {
  fields: ["title", "keywords", "text"],
  storeFields: [
    "kind", "title", "license", "href", "why", "coverage", "installScope", "reviewStatus",
    "repo", "kits", "security", "updated", "rating", "stars", "partial",
  ],
  searchOptions: { boost: { title: 3, keywords: 2 }, prefix: true, fuzzy: 0.2 },
};

