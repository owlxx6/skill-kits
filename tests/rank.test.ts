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
    expect(resume.removed).toEqual(["gone/repo:skills/x"]);
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
});

describe("validateCuration", () => {
  it("accepts kit ids that exist", () => {
    expect(() => validateCuration(emptyCuration, testKits)).not.toThrow();
  });

  it("rejects a kit id that is not in kits.yaml", () => {
    const curation = { ...emptyCuration, "typo-kit": { approved: [], rejected: [] } };
    expect(() => validateCuration(curation, testKits)).toThrow(/typo-kit/);
  });
});
