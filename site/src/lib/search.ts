import MiniSearch, { type Options } from "minisearch";
import type { Catalog } from "../../../pipeline/lib/schemas";
import { collectionHref, collectionCoverageLabel, collectionInstallScope, collectionLicenseLabel, reviewLabel, skillHref } from "./catalog";

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
}

// Shared by the build and the browser: the index must be loaded with the options it was built with.
export const SEARCH_OPTIONS: Options<SearchDocument> = {
  fields: ["title", "keywords", "text"],
  storeFields: ["kind", "title", "license", "href", "why", "coverage", "installScope", "reviewStatus"],
  searchOptions: { boost: { title: 3, keywords: 2 }, prefix: true, fuzzy: 0.2 },
};

export function searchDocuments(catalog: Catalog): SearchDocument[] {
  const skills: SearchDocument[] = catalog.skills.map((skill) => ({
    id: `skill:${skill.id}`,
    kind: "skill",
    title: skill.name,
    text: `${skill.description} ${skill.review.summary} ${skill.repo}`,
    keywords: skill.review.keywords.join(" "),
    license: skill.license,
    href: skillHref(skill.id),
    why: skill.review.why,
    reviewStatus: reviewLabel(),
  }));
  const collections: SearchDocument[] = catalog.collections.map((collection) => ({
    id: `collection:${collection.id}`,
    kind: "collection",
    title: collection.id,
    text: collection.description ?? "",
    keywords: "",
    license: collectionLicenseLabel(collection),
    href: collectionHref(collection.id),
    why: collection.description ?? "",
    coverage: collectionCoverageLabel(collection),
    installScope: collectionInstallScope(collection),
    reviewStatus: reviewLabel(),
  }));
  return [...skills, ...collections];
}

export function buildSearchIndex(catalog: Catalog): ReturnType<MiniSearch<SearchDocument>["toJSON"]> {
  const index = new MiniSearch<SearchDocument>(SEARCH_OPTIONS);
  index.addAll(searchDocuments(catalog));
  return index.toJSON();
}
