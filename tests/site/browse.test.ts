import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applyBrowse,
  type BrowseItem,
  browseStateToParams,
  DEFAULT_STATE,
  facetCounts,
  parseBrowseState,
} from "../../site/src/lib/browse";
import {
  collectionsByStars,
  highestSecurityLevel,
  isPartialCollection,
  kitInstallCommand,
  listedSecurityLevel,
  plural,
  sameNameSkills,
  securityLabel,
  securityLevel,
  topSkillPerRepo,
  unlistedCount,
} from "../../site/src/lib/catalog";
import { buildSearchIndex, SEARCH_OPTIONS } from "../../site/src/lib/search";
import type { Catalog } from "../../pipeline/lib/schemas";
import { makeReview } from "../fixtures";

const skill = (id: string, score: number, level: "none" | "notice" | "severe" = "none", license = "MIT", pushedAt = "2026-11-01T00:00:00Z") => {
  const [repo, path] = id.split(":");
  return {
    id, repo, path, name: path.split("/").at(-1) ?? path, description: "A skill.", url: `https://github.com/${repo}`,
    license, stars: 100, forks: 10, pushedAt,
    review: { ...makeReview(), security: { level, notes: ["PRIVATE_NOTE"] } },
    reviewScore: score, repoSignal: 5, score, humanReviewed: true,
  };
};

const collection = (id: string, stars: number, listed: string[], skillCount: number) => ({
  id, url: `https://github.com/${id}`, description: "Skills", license: "MIT", stars, forks: 1,
  pushedAt: "2026-11-02T00:00:00Z", repoSignal: 5, skillCount, catalogSkillIds: listed, kitScores: {}, humanReviewed: true,
});

const catalog: Catalog = {
  generatedAt: "2026-11-15T00:00:00.000Z",
  kits: [{
    id: "resume-career", title: "Resume & career agent", description: "Tailor a resume.",
    collections: ["acme/skills"], skills: ["other/tools:resume"], removed: [], pending: [], proposals: { collections: [], skills: [] },
  }],
  skills: [
    skill("acme/skills:skills/a", 9, "notice"),
    skill("acme/skills:skills/b", 7, "none", "Apache-2.0", "2026-11-10T00:00:00Z"),
    skill("other/tools:resume", 8, "severe"),
    skill("third/pack:skills/a", 8.5),
  ],
  collections: [collection("acme/skills", 500, ["acme/skills:skills/a", "acme/skills:skills/b"], 40), collection("other/tools", 900, ["other/tools:resume"], 1)],
};

describe("security level helpers", () => {
  it("reads the level only and ranks levels", () => {
    expect(securityLevel(catalog.skills[0])).toBe("notice");
    expect(highestSecurityLevel(["none", "severe", "notice"])).toBe("severe");
    expect(highestSecurityLevel([])).toBe("none");
    expect(listedSecurityLevel(catalog, "acme/skills")).toBe("notice");
    expect(securityLabel("severe")).toBe("Severe security flag");
    expect(securityLabel("none", true)).toBe("No flags");
  });
});

describe("scope and ranking helpers", () => {
  it("flags partial collections and counts the unlisted skills", () => {
    expect(isPartialCollection(catalog.collections[0])).toBe(true);
    expect(unlistedCount(catalog.collections[0])).toBe(38);
    expect(isPartialCollection(catalog.collections[1])).toBe(false);
  });

  it("joins a kit's commands in order and ranks by stars and review score", () => {
    expect(kitInstallCommand(["a/b", "c/d"])).toBe("npx skills add a/b && npx skills add c/d");
    expect(collectionsByStars(catalog, 1).map((entry) => entry.id)).toEqual(["other/tools"]);
    // One skill per repository: acme's 9.0 wins, its 7.0 is skipped.
    expect(topSkillPerRepo(catalog, 3).map((entry) => entry.id)).toEqual(["acme/skills:skills/a", "third/pack:skills/a", "other/tools:resume"]);
  });

  it("finds same-name skills from another repository and pluralizes counts", () => {
    expect(sameNameSkills(catalog, catalog.skills[0]).map((entry) => entry.id)).toEqual(["third/pack:skills/a"]);
    expect(plural(1, "skill")).toBe("1 skill");
    expect(plural(3426, "skill")).toBe("3,426 skills");
  });
});

describe("browse URL state", () => {
  it("round-trips non-default values and ignores unknown ones", () => {
    const params = new URLSearchParams("q=resume&type=skill&kit=resume-career&security=notice&security=bogus&license=MIT&sort=updated");
    const state = parseBrowseState(params);
    expect(state).toEqual({ q: "resume", type: "skill", kits: ["resume-career"], security: ["notice"], licenses: ["MIT"], sort: "updated" });
    expect(parseBrowseState(browseStateToParams(state))).toEqual(state);
    expect(browseStateToParams(DEFAULT_STATE).toString()).toBe("");
    expect(parseBrowseState(new URLSearchParams("type=nope&sort=nope"))).toEqual(DEFAULT_STATE);
    expect(activeFilterCount(state)).toBe(4);
  });
});

const items: BrowseItem[] = [
  { id: "s1", kind: "skill", title: "delta", license: "MIT", kits: ["k1"], security: "notice", updated: "2026-11-01", rating: 7, stars: 10 },
  { id: "s2", kind: "skill", title: "bravo", license: "Apache-2.0", kits: [], security: "none", updated: "2026-11-09", rating: 9, stars: 5 },
  { id: "c1", kind: "collection", title: "charlie/skills", license: "MIT", kits: ["k1"], security: "notice", updated: "2026-11-05", rating: 0, stars: 500 },
  { id: "c2", kind: "collection", title: "echo/pack", license: "MIT", kits: [], security: "none", updated: "2026-10-01", rating: 0, stars: 900 },
];

describe("applyBrowse", () => {
  it("lists collections by stars, then skills by review score, when there is no query", () => {
    expect(applyBrowse(items, DEFAULT_STATE).map((item) => item.id)).toEqual(["c2", "c1", "s2", "s1"]);
  });

  it("keeps relevance order for a query and sorts on request", () => {
    expect(applyBrowse(items, { ...DEFAULT_STATE, q: "x" }).map((item) => item.id)).toEqual(["s1", "s2", "c1", "c2"]);
    expect(applyBrowse(items, { ...DEFAULT_STATE, sort: "updated" }).map((item) => item.id)).toEqual(["s2", "c1", "s1", "c2"]);
    expect(applyBrowse(items, { ...DEFAULT_STATE, sort: "name" }).map((item) => item.id)).toEqual(["s2", "c1", "s1", "c2"]);
    expect(applyBrowse(items, { ...DEFAULT_STATE, sort: "rating" }).map((item) => item.id)).toEqual(["s2", "s1", "c2", "c1"]);
  });

  it("combines filters: any value within a facet, every facet at once", () => {
    const state = { ...DEFAULT_STATE, kits: ["k1"], licenses: ["MIT"] };
    expect(applyBrowse(items, state).map((item) => item.id)).toEqual(["c1", "s1"]);
    expect(applyBrowse(items, { ...state, type: "skill" }).map((item) => item.id)).toEqual(["s1"]);
    expect(applyBrowse(items, { ...DEFAULT_STATE, security: ["none", "notice"] })).toHaveLength(4);
  });

  it("counts each facet as if only the other filters applied", () => {
    const counts = facetCounts(items, { ...DEFAULT_STATE, type: "skill", security: ["notice"] });
    expect(counts.type).toEqual({ all: 2, skill: 1, collection: 1 });
    expect(counts.security).toEqual({ none: 1, notice: 1, severe: 0 });
    expect(counts.licenses).toEqual({ MIT: 1 });
  });
});

describe("browse fields in the search index", () => {
  it("stores kits, level, date and partial scope, never the scan notes", () => {
    const serialized = JSON.stringify(buildSearchIndex(catalog));
    expect(serialized).not.toContain("PRIVATE_NOTE");
    const index = MiniSearch.loadJSON(serialized, SEARCH_OPTIONS);
    const hits = index.search(MiniSearch.wildcard);
    const acme = hits.find((hit) => hit.id === "collection:acme/skills");
    expect(acme).toMatchObject({ partial: true, security: "notice", kits: ["resume-career"], updated: "2026-11-02" });
    const severe = hits.find((hit) => hit.id === "skill:other/tools:resume");
    expect(severe).toMatchObject({ security: "severe", kits: ["resume-career"], rating: 8 });
  });
});
