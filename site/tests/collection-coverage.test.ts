import { describe, expect, it } from "vitest";
import MiniSearch from "minisearch";
import { collectionCoverageLabel, collectionInstallScope, loadCatalog, reviewLabel } from "../src/lib/catalog";
import { buildSearchIndex, SEARCH_OPTIONS } from "../src/lib/search";

describe("collection coverage and installation scope", () => {
  it("distinguishes the listed subset from everything installed", () => {
    const collection = { catalogSkillIds: ["example/skills:first", "example/skills:second"], skillCount: 1146 };
    expect(collectionCoverageLabel(collection)).toBe("2 of 1146 skills listed");
    expect(collectionInstallScope(collection)).toContain("Whole-repository installation is unavailable");
  });

  it("does not imply that a fully listed repository has unlisted skills", () => {
    const collection = { catalogSkillIds: ["example/skills:first", "example/skills:second"], skillCount: 2, installScope: "repository" as const, revision: "1".repeat(40) };
    expect(collectionCoverageLabel(collection)).toBe("2 of 2 skills listed");
    expect(collectionInstallScope(collection)).toBe("Installs every skill in this repository.");
  });

  it("reports an empty listed subset without claiming zero installed skills", () => {
    expect(collectionCoverageLabel({ catalogSkillIds: [], skillCount: 12 })).toBe("0 of 12 skills listed");
  });

  it("uses neutral attribution for a review not performed by a person", () => {
    expect(reviewLabel()).toBe("Session reviewed");
  });

  it("preserves public coverage in a serialized index without exporting private notes", () => {
    const catalog = structuredClone(loadCatalog());
    catalog.skills.find(skill=>skill.review)!.review!.security.notes = ["PRIVATE_REVIEW_SENTINEL"];
    catalog.kits[0].pendingReasons = { "example/skills:pending": "PRIVATE_PENDING_SENTINEL" };
    // Any collection that lists only part of its repository: the test must not depend on one repository staying in the catalog.
    const collection = catalog.collections.find(entry => entry.catalogSkillIds.length < entry.skillCount)!;
    expect(collection).toBeDefined();
    const serialized = JSON.stringify(buildSearchIndex(catalog));
    const index = MiniSearch.loadJSON(serialized, SEARCH_OPTIONS);
    const hit = index.search(collection.id).find(entry => entry.id === `collection:${collection.id}`);
    expect(hit?.coverage).toBe(`${collection.catalogSkillIds.length} of ${collection.skillCount} skills listed`);
    expect(hit?.installScope).toContain(collection.installScope === "repository" ? "Installs every skill" : "Whole-repository installation is unavailable");
    expect(hit?.reviewStatus).toBeDefined();
    expect(serialized).not.toContain("PRIVATE_REVIEW_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_PENDING_SENTINEL");
  });
});
