import { describe, expect, it } from "vitest";
import type { Catalog } from "../../pipeline/lib/schemas";
import {
  collectionInstallCommand,
  collectionSlug,
  kitView,
  licenseOptions,
  parseCatalog,
  skillInstallCommand,
  skillSlug,
  sortSkills,
} from "../../site/src/lib/catalog";
import { makeReview } from "../fixtures";

const skill = (id: string, score: number, license = "MIT") => {
  const [repo, path] = id.split(":");
  return {
    id,
    repo,
    path: path === "." ? "" : path,
    name: path === "." ? repo.split("/")[1] : path.split("/").at(-1) ?? path,
    description: "A skill.",
    url: `https://github.com/${repo}`,
    license,
    stars: 100,
    forks: 10,
    pushedAt: "2026-11-01T00:00:00Z",
    review: makeReview(),
    reviewScore: score,
    repoSignal: 5,
    score,
    humanReviewed: true,
  };
};

const catalog: Catalog = {
  generatedAt: "2026-11-15T00:00:00.000Z",
  kits: [
    {
      id: "resume-career",
      title: "Resume & career agent",
      description: "Tailor a resume.",
      collections: ["acme/skills"],
      skills: ["acme/skills:skills/b", "other/tools:."],
      removed: [],
      pending: [],
      proposals: { collections: [], skills: [] },
    },
    {
      id: "web-app",
      title: "Web app builder",
      description: "Build a web app.",
      collections: [],
      skills: [],
      removed: [],
      pending: [],
      proposals: { collections: [], skills: [] },
    },
  ],
  skills: [
    skill("acme/skills:skills/a", 9),
    skill("acme/skills:skills/b", 7, "Apache-2.0"),
    skill("other/tools:.", 8),
  ],
  collections: [
    {
      id: "acme/skills",
      url: "https://github.com/acme/skills",
      description: "Skills by Acme",
      license: "MIT",
      stars: 100,
      forks: 10,
      pushedAt: "2026-11-01T00:00:00Z",
      repoSignal: 5,
      skillCount: 3,
      catalogSkillIds: ["acme/skills:skills/a", "acme/skills:skills/b"],
      kitScores: { "resume-career": 7 },
      humanReviewed: true,
    },
  ],
};

describe("parseCatalog", () => {
  it("accepts a valid catalog and rejects an invalid one with a clear message", () => {
    expect(parseCatalog(catalog).skills).toHaveLength(3);
    expect(() => parseCatalog({ kits: "nope" })).toThrow(/catalog\.json is invalid/);
  });
});

describe("slugs", () => {
  it("builds skill and collection slugs, with _root for a root skill", () => {
    expect(skillSlug("acme/skills:skills/a")).toBe("acme/skills/skills/a");
    expect(skillSlug("other/tools:.")).toBe("other/tools/_root");
    expect(collectionSlug("acme/skills")).toEqual({ owner: "acme", repo: "skills" });
  });
});

describe("install commands", () => {
  it("installs one skill by name, or a whole collection", () => {
    expect(skillInstallCommand(catalog.skills[0])).toBe("npx skills add acme/skills --skill a");
    expect(collectionInstallCommand("acme/skills")).toBe("npx skills add acme/skills");
  });
});

describe("kitView", () => {
  it("returns approved collections and skills in the curator's order, and flags an empty kit", () => {
    const view = kitView(parseCatalog(catalog), "resume-career");
    expect(view?.collections.map((entry) => entry.id)).toEqual(["acme/skills"]);
    expect(view?.skills.map((entry) => entry.id)).toEqual(["acme/skills:skills/b", "other/tools:."]);
    expect(view?.isEmpty).toBe(false);
    expect(kitView(parseCatalog(catalog), "web-app")?.isEmpty).toBe(true);
    expect(kitView(parseCatalog(catalog), "nope")).toBeNull();
  });
});

describe("sortSkills and licenseOptions", () => {
  it("sorts by review score and lists licenses once, in plain order", () => {
    const sorted = sortSkills(catalog.skills, "review");
    expect(sorted.map((entry) => entry.reviewScore)).toEqual([9, 8, 7]);
    expect(sortSkills(catalog.skills, "curated")).toEqual(catalog.skills);
    expect(licenseOptions(catalog.skills)).toEqual(["Apache-2.0", "MIT"]);
  });
});
