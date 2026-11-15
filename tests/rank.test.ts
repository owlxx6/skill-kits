import { describe, expect, it } from "vitest";
import type { Curation, Review, SkillRecord } from "../pipeline/lib/schemas";
import { buildCatalog, validateCuration } from "../pipeline/rank";
import { NOW, fp, makeRepo, makeReview, makeSkill, testConfig, testKits } from "./fixtures";

const repo = makeRepo(); // repo signal = 5

const skill = (letter: string): SkillRecord =>
  makeSkill({
    id: `acme/skills:skills/${letter}`,
    path: `skills/${letter}`,
    name: letter,
    fingerprint: fp(letter),
  });

const uniform = (value: number, overrides: Partial<Review> = {}): Review =>
  makeReview({
    scores: { clarity: value, completeness: value, usefulness: value },
    ...overrides,
  });

const skills = ["a", "b", "c", "d", "e", "f"].map(skill);

const reviews = new Map<string, Review>([
  [fp("a"), uniform(9)],
  [fp("b"), uniform(8)],
  [fp("c"), uniform(7)],
  [fp("d"), uniform(5)], // below the catalog threshold
  [fp("e"), uniform(9, { security: { level: "severe", notes: ["Sends files away"] } })],
  // f has no review
]);

const emptyCuration: Curation = {
  "resume-career": { approved: [], rejected: [] },
  "web-app": { approved: [], rejected: [] },
};

const build = (curation: Curation) =>
  buildCatalog({
    repos: [repo],
    skills,
    reviews,
    kits: testKits,
    curation,
    config: testConfig,
    now: NOW,
  });

describe("buildCatalog", () => {
  it("lists reviewed skills above the threshold, best first, without severe ones", () => {
    const catalog = build(emptyCuration);
    expect(catalog.generatedAt).toBe("2026-11-11T00:00:00.000Z");
    expect(catalog.skills.map((entry) => [entry.name, entry.reviewScore, entry.score])).toEqual([
      ["a", 9, 7.8],
      ["b", 8, 7.1],
      ["c", 7, 6.4],
    ]);
    expect(catalog.skills[0]).toMatchObject({
      url: "https://github.com/acme/skills/tree/main/skills/a",
      license: "MIT",
      repoSignal: 5,
      humanReviewed: false,
    });
  });

  it("turns a repo with enough skills into a collection scored per kit", () => {
    const [collection] = build(emptyCuration).collections;
    expect(collection).toMatchObject({
      id: "acme/skills",
      skillCount: 6,
      catalogSkillIds: [
        "acme/skills:skills/a",
        "acme/skills:skills/b",
        "acme/skills:skills/c",
      ],
      kitScores: { "resume-career": 5.8 },
    });
  });

  it("proposes the best undecided entries for each kit", () => {
    const [resume, webApp] = build(emptyCuration).kits;
    expect(resume.skills).toEqual([]);
    expect(resume.proposals.skills).toEqual([
      { id: "acme/skills:skills/a", score: 7.8 },
      { id: "acme/skills:skills/b", score: 7.1 },
      { id: "acme/skills:skills/c", score: 6.4 },
    ]);
    expect(resume.proposals.collections).toEqual([{ id: "acme/skills", score: 5.8 }]);
    expect(webApp.proposals).toEqual({ collections: [], skills: [] });
  });

  it("applies curation: approved order, rejections, removals and the human badge", () => {
    const catalog = build({
      "resume-career": {
        approved: ["acme/skills:skills/b", "acme/skills", "gone/repo:skills/x"],
        rejected: ["acme/skills:skills/c"],
      },
      "web-app": { approved: [], rejected: [] },
    });
    const [resume] = catalog.kits;
    expect(resume.skills).toEqual(["acme/skills:skills/b"]);
    expect(resume.collections).toEqual(["acme/skills"]);
    expect(resume.removed).toEqual([{ id: "gone/repo:skills/x", reason: "repository no longer listed" }]);
    expect(resume.proposals.skills).toEqual([{ id: "acme/skills:skills/a", score: 7.8 }]);
    expect(resume.proposals.collections).toEqual([]);
    const byName = new Map(catalog.skills.map((entry) => [entry.name, entry.humanReviewed]));
    expect(byName.get("b")).toBe(true);
    expect(byName.get("a")).toBe(false);
    expect(catalog.collections[0].humanReviewed).toBe(true);
  });

  it("does not make a collection out of a repo with fewer than three skills", () => {
    const catalog = buildCatalog({
      repos: [repo],
      skills: skills.slice(0, 2),
      reviews,
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    expect(catalog.collections).toEqual([]);
    expect(catalog.skills).toHaveLength(2);
  });

  it("breaks ties by plain code-unit order, not by locale", () => {
    const tied = [
      makeSkill({ id: "acme/skills:skills/a", path: "skills/a", name: "a", fingerprint: fp("x") }),
      makeSkill({ id: "acme/skills:skills/B", path: "skills/B", name: "B", fingerprint: fp("y") }),
    ];
    const catalog = buildCatalog({
      repos: [repo],
      skills: tied,
      reviews: new Map([
        [fp("x"), uniform(9)],
        [fp("y"), uniform(9)],
      ]),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    expect(catalog.skills.map((entry) => entry.id)).toEqual([
      "acme/skills:skills/B",
      "acme/skills:skills/a",
    ]);
  });

  const curated = (approved: string[]): Curation => ({
    "resume-career": { approved, rejected: [] },
    "web-app": { approved: [], rejected: [] },
  });

  it("keeps an approved skill pending while its new version has no review", () => {
    const [resume] = build(curated(["acme/skills:skills/f"])).kits;
    expect(resume.pending).toEqual(["acme/skills:skills/f"]);
    expect(resume.removed).toEqual([]);
    expect(resume.skills).toEqual([]);
  });

  it("removes an approved skill whose review fell below the threshold", () => {
    const catalog = build(curated(["acme/skills:skills/d"]));
    expect(catalog.kits[0].removed).toEqual([
      { id: "acme/skills:skills/d", reason: "review score 5 below 6" },
    ]);
    expect(catalog.kits[0].pending).toEqual([]);
    expect(catalog.kits[0].skills).toEqual([]);
  });

  it("removes an approved skill whose review is severe", () => {
    const catalog = build(curated(["acme/skills:skills/e"]));
    expect(catalog.kits[0].removed).toEqual([{ id: "acme/skills:skills/e", reason: "security severe" }]);
    expect(catalog.kits[0].pending).toEqual([]);
  });

  it("removes an approved skill id that matches no extracted skill of a listed repository", () => {
    const catalog = build(curated(["acme/skills:skills/zzz"]));
    expect(catalog.kits[0].removed).toEqual([
      { id: "acme/skills:skills/zzz", reason: "skill no longer found in the repository" },
    ]);
  });

  it("compares repository names without letter case when explaining a removal", () => {
    const catalog = build(curated(["ACME/Skills:skills/zzz"]));
    expect(catalog.kits[0].removed).toEqual([
      { id: "ACME/Skills:skills/zzz", reason: "skill no longer found in the repository" },
    ]);
  });

  it("removes an approved collection that no longer qualifies", () => {
    const catalog = buildCatalog({
      repos: [repo],
      skills: skills.slice(0, 2),
      reviews,
      kits: testKits,
      curation: curated(["acme/skills"]),
      config: testConfig,
      now: NOW,
    });
    expect(catalog.kits[0].removed).toEqual([
      { id: "acme/skills", reason: "collection below 3 skills or with no skill in the catalog" },
    ]);
  });

  it("removes an approved collection whose repository is no longer listed", () => {
    const catalog = build(curated(["gone/repo"]));
    expect(catalog.kits[0].removed).toEqual([{ id: "gone/repo", reason: "repository no longer listed" }]);
  });

  it("does not mark a pending skill as human reviewed", () => {
    const catalog = build(curated(["acme/skills:skills/f"]));
    expect(catalog.skills.some((entry) => entry.humanReviewed)).toBe(false);
  });

  it("keeps the curator's order for approved skills", () => {
    const catalog = build(curated(["acme/skills:skills/c", "acme/skills:skills/a"]));
    expect(catalog.kits[0].skills).toEqual(["acme/skills:skills/c", "acme/skills:skills/a"]);
  });

  it("lists a notice skill with its security notes", () => {
    const notice = uniform(9, { security: { level: "notice", notes: ["Runs a shell command"] } });
    const catalog = buildCatalog({
      repos: [repo],
      skills: [skill("n")],
      reviews: new Map([[fp("n"), notice]]),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0].review.security).toEqual({
      level: "notice",
      notes: ["Runs a shell command"],
    });
  });

  it("excludes a skill whose repository is not listed and does not count it", () => {
    const stray = makeSkill({
      id: "gone/repo:skills/z",
      repo: "gone/repo",
      path: "skills/z",
      name: "z",
      fingerprint: fp("z"),
    });
    const catalog = buildCatalog({
      repos: [repo],
      skills: [...skills.slice(0, 3), stray],
      reviews: new Map([...reviews, [fp("z"), uniform(9)]]),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    expect(catalog.skills.map((entry) => entry.id)).not.toContain("gone/repo:skills/z");
    expect(catalog.collections[0].skillCount).toBe(3);
  });

  it("lists a collection without kit scores when too few skills are tagged for a kit", () => {
    const tagged = uniform(9);
    const untagged = uniform(9, { kits: [] });
    const catalog = buildCatalog({
      repos: [repo],
      skills: skills.slice(0, 3),
      reviews: new Map([
        [fp("a"), tagged],
        [fp("b"), tagged],
        [fp("c"), untagged],
      ]),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    expect(catalog.collections).toHaveLength(1);
    expect(catalog.collections[0].kitScores).toEqual({});
    expect(catalog.kits[0].proposals.collections).toEqual([]);
  });

  it("proposes one copy of a fingerprint present in several repositories", () => {
    const fork = makeRepo({ fullName: "fork/skills", stars: 100, forks: 10 });
    const copy = makeSkill({
      id: "fork/skills:skills/a",
      repo: "fork/skills",
      path: "skills/a",
      name: "a",
      fingerprint: fp("a"),
    });
    const catalog = buildCatalog({
      repos: [repo, fork],
      skills: [skill("a"), copy],
      reviews: new Map([[fp("a"), uniform(9)]]),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    expect(catalog.skills).toHaveLength(2);
    expect(catalog.kits[0].proposals.skills.map((entry) => entry.id)).toEqual([
      "acme/skills:skills/a",
    ]);
  });

  it("does not propose a copy of content the curator already decided on", () => {
    const fork = makeRepo({ fullName: "fork/skills", stars: 100, forks: 10 });
    const copy = makeSkill({
      id: "fork/skills:skills/a",
      repo: "fork/skills",
      path: "skills/a",
      name: "a",
      fingerprint: fp("a"),
    });
    const catalog = buildCatalog({
      repos: [repo, fork],
      skills: [skill("a"), copy],
      reviews: new Map([[fp("a"), uniform(9)]]),
      kits: testKits,
      curation: {
        "resume-career": { approved: [], rejected: ["acme/skills:skills/a"] },
        "web-app": { approved: [], rejected: [] },
      },
      config: testConfig,
      now: NOW,
    });
    expect(catalog.skills).toHaveLength(2);
    expect(catalog.kits[0].proposals.skills).toEqual([]);
  });

  it("does not propose a copy of content the curator already approved", () => {
    const fork = makeRepo({ fullName: "fork/skills", stars: 100, forks: 10 });
    const copy = makeSkill({
      id: "fork/skills:skills/a",
      repo: "fork/skills",
      path: "skills/a",
      name: "a",
      fingerprint: fp("a"),
    });
    const catalog = buildCatalog({
      repos: [repo, fork],
      skills: [skill("a"), copy],
      reviews: new Map([[fp("a"), uniform(9)]]),
      kits: testKits,
      curation: {
        "resume-career": { approved: ["acme/skills:skills/a"], rejected: [] },
        "web-app": { approved: [], rejected: [] },
      },
      config: testConfig,
      now: NOW,
    });
    expect(catalog.kits[0].skills).toEqual(["acme/skills:skills/a"]);
    expect(catalog.kits[0].proposals.skills).toEqual([]);
  });

  it("removes an approved skill whose repository is no longer listed", () => {
    const stray = makeSkill({
      id: "gone/repo:skills/z",
      repo: "gone/repo",
      path: "skills/z",
      name: "z",
      fingerprint: fp("z"),
    });
    const catalog = buildCatalog({
      repos: [repo],
      skills: [stray],
      reviews: new Map([[fp("z"), uniform(9)]]),
      kits: testKits,
      curation: {
        "resume-career": { approved: ["gone/repo:skills/z"], rejected: [] },
        "web-app": { approved: [], rejected: [] },
      },
      config: testConfig,
      now: NOW,
    });
    expect(catalog.kits[0].removed).toEqual([
      { id: "gone/repo:skills/z", reason: "repository no longer listed" },
    ]);
    expect(catalog.kits[0].pending).toEqual([]);
  });

  it("caps the skill proposals", () => {
    const many = "abcdefghij".split("").map(skill);
    const catalog = buildCatalog({
      repos: [repo],
      skills: many,
      reviews: new Map(many.map((entry) => [entry.fingerprint, uniform(9)])),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    expect(catalog.skills).toHaveLength(10);
    expect(catalog.kits[0].proposals.skills).toHaveLength(testConfig.proposals.skills);
  });

  it("gives the same output for the same input", () => {
    expect(JSON.stringify(build(emptyCuration))).toBe(JSON.stringify(build(emptyCuration)));
  });
});

describe("validateCuration", () => {
  it("accepts kit ids that exist", () => {
    expect(() => validateCuration(emptyCuration, testKits)).not.toThrow();
  });

  it("rejects a kit id that is not in kits.yaml", () => {
    const curation = { ...emptyCuration, "typo-kit": { approved: [], rejected: [] } };
    expect(() => validateCuration(curation, testKits)).toThrow(/typo-kit/);
  });

  it("rejects an id listed twice in the same list of a kit", () => {
    const curation = {
      ...emptyCuration,
      "web-app": { approved: ["x/y:a", "x/y:a"], rejected: [] },
    };
    expect(() => validateCuration(curation, testKits)).toThrow(/web-app.*x\/y:a/);
  });

  it("rejects an id both approved and rejected in the same kit", () => {
    const curation = {
      ...emptyCuration,
      "web-app": { approved: ["x/y:a"], rejected: ["x/y:a"] },
    };
    expect(() => validateCuration(curation, testKits)).toThrow(/web-app.*x\/y:a/);
  });
});
