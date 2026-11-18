import MiniSearch from "minisearch";
import type { Catalog } from "../../../pipeline/lib/schemas";
import {
  collectionHref,
  collectionCoverageLabel,
  collectionInstallScope,
  collectionLicenseLabel,
  displayDate,
  isPartialCollection,
  listedSecurityLevel,
  reviewLabel,
  securityLevel,
  skillHref,
} from "./catalog";

export { SEARCH_OPTIONS, type SearchDocument } from "./search-options";
import { SEARCH_OPTIONS, type SearchDocument } from "./search-options";

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
    repo: skill.repo,
    kits: catalog.kits.filter((kit) => kit.skills.includes(skill.id)).map((kit) => kit.id),
    security: securityLevel(skill),
    updated: displayDate(skill.pushedAt),
    rating: skill.reviewScore,
    stars: skill.stars,
    partial: false,
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
    repo: collection.id,
    kits: catalog.kits.filter((kit) => kit.collections.includes(collection.id)).map((kit) => kit.id),
    security: listedSecurityLevel(catalog, collection.id),
    updated: displayDate(collection.pushedAt),
    rating: 0,
    stars: collection.stars,
    partial: isPartialCollection(collection),
  }));
  return [...skills, ...collections];
}

export function buildSearchIndex(catalog: Catalog): ReturnType<MiniSearch<SearchDocument>["toJSON"]> {
  const index = new MiniSearch<SearchDocument>(SEARCH_OPTIONS);
  index.addAll(searchDocuments(catalog));
  return index.toJSON();
}
