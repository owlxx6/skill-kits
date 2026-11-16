import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";
import { buildSearchIndex, searchDocuments, SEARCH_OPTIONS } from "../../site/src/lib/search";
import { makeReview } from "../fixtures";
import type { Catalog } from "../../pipeline/lib/schemas";

const catalog: Catalog = {
  generatedAt: "2026-11-15T00:00:00.000Z",
  kits: [],
  skills: [
    {
      id: "acme/skills:skills/resume-tailor",
      repo: "acme/skills",
      path: "skills/resume-tailor",
      name: "resume-tailor",
      description: "Tailors a resume to a job offer.",
      url: "https://github.com/acme/skills",
      license: "MIT",
      stars: 100,
      forks: 10,
      pushedAt: "2026-11-01T00:00:00Z",
      review: makeReview({ keywords: ["resume", "cv", "job offer", "ats", "tailor"] }),
      reviewScore: 8,
      repoSignal: 5,
      score: 7,
      humanReviewed: true,
    },
  ],
  collections: [
    {
      id: "acme/skills",
      url: "https://github.com/acme/skills",
      description: "Career skills",
      license: "MIT",
      stars: 100,
      forks: 10,
      pushedAt: "2026-11-01T00:00:00Z",
      repoSignal: 5,
      skillCount: 3,
      catalogSkillIds: ["acme/skills:skills/resume-tailor"],
      kitScores: {},
      humanReviewed: false,
    },
  ],
};

describe("search index", () => {
  it("finds a skill by a review keyword and a collection by its description", () => {
    const index = MiniSearch.loadJSON(JSON.stringify(buildSearchIndex(catalog)), SEARCH_OPTIONS);
    expect(index.search("cv")[0]?.id).toBe("skill:acme/skills:skills/resume-tailor");
    expect(index.search("career").map((result) => result.id)).toContain("collection:acme/skills");
  });

  it("tolerates a typo and a prefix", () => {
    const index = MiniSearch.loadJSON(JSON.stringify(buildSearchIndex(catalog)), SEARCH_OPTIONS);
    expect(index.search("resme", { fuzzy: 0.2 }).length).toBeGreaterThan(0);
    expect(index.search("tail", { prefix: true }).length).toBeGreaterThan(0);
  });

  it("exposes one document per skill and collection", () => {
    expect(searchDocuments(catalog).map((doc) => doc.kind)).toEqual(["skill", "collection"]);
  });
});

describe("public search metadata", () => {
  it("includes mixed license labels without exporting internal review or pending data", () => {
    const fixture = structuredClone(catalog);
    fixture.skills[0].review.security = { level: "notice", notes: ["PRIVATE_FINDING_MARKER"] };
    fixture.kits = [{
      id: "resume-career", title: "Career", description: "Career skills", collections: [], skills: [],
      pending: ["acme/skills:skills/pending"],
      pendingReasons: { "acme/skills:skills/pending": "PRIVATE_PENDING_MARKER" },
      removed: [], proposals: { collections: [], skills: [] },
    }];
    fixture.collections[0].license = "Mixed";
    fixture.collections[0].licenses = ["GPL-3.0", "No license"];
    const docs = searchDocuments(fixture);
    expect(docs.find((doc) => doc.kind === "collection")?.license).toBe("Mixed (GPL-3.0, No license)");
    const serialized = JSON.stringify(buildSearchIndex(fixture));
    expect(serialized).not.toContain("PRIVATE_FINDING_MARKER");
    expect(serialized).not.toContain("PRIVATE_PENDING_MARKER");
  });
});
