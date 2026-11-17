import { describe, expect, it } from "vitest";
import type { Curation, LicenseResolution, Review, SkillRecord } from "../pipeline/lib/schemas";
import { buildCatalog, validateCuration } from "../pipeline/rank";
import { NOW, fp, githubLicense, makeRepo, makeReview, makeSkill, testConfig, testKits } from "./fixtures";

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

  // Folders of one repository whose SKILL.md is the same file: one skill, installed three times.
  const copiesOf = (letter: string, count: number): SkillRecord[] =>
    Array.from({ length: count }, (_, index) =>
      makeSkill({
        id: `acme/skills:copy${index}/${letter}`,
        path: `copy${index}/${letter}`,
        name: letter,
        fingerprint: fp(letter),
      }),
    );

  it("does not make a collection out of copies of one skill", () => {
    const catalog = buildCatalog({
      repos: [repo],
      skills: copiesOf("a", 3),
      reviews: new Map([[fp("a"), uniform(9)]]),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    // The three copies stay listed as skills, but they are one idea, not three.
    expect(catalog.skills).toHaveLength(3);
    expect(catalog.collections).toEqual([]);
    expect(catalog.kits[0].proposals.collections).toEqual([]);
    expect(catalog.kits[0].proposals.skills).toHaveLength(1);
  });

  it("counts a skill once toward a kit's collection score when it has copies", () => {
    const catalog = buildCatalog({
      repos: [repo],
      skills: [...copiesOf("a", 3), skill("b"), skill("c")],
      reviews: new Map([
        [fp("a"), uniform(9)],
        [fp("b"), uniform(7)],
        [fp("c"), uniform(5)],
      ]),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    const [collection] = catalog.collections;
    // Three distinct skills: 9 and 7 reach the catalog, 5 does not. Two distinct kit skills are
    // below the threshold of three, although four catalog entries carry the kit.
    expect(collection.skillCount).toBe(5);
    expect(collection.catalogSkillIds).toHaveLength(4);
    expect(collection.kitScores).toEqual({});
  });

  it("scores a collection from distinct skills, not from the number of copies", () => {
    const withCopies = buildCatalog({
      repos: [repo],
      skills: [...copiesOf("a", 3), skill("b"), skill("c")],
      reviews: new Map([
        [fp("a"), uniform(9)],
        [fp("b"), uniform(8)],
        [fp("c"), uniform(7)],
      ]),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    const withoutCopies = buildCatalog({
      repos: [repo],
      skills: [skill("a"), skill("b"), skill("c")],
      reviews: new Map([
        [fp("a"), uniform(9)],
        [fp("b"), uniform(8)],
        [fp("c"), uniform(7)],
      ]),
      kits: testKits,
      curation: emptyCuration,
      config: testConfig,
      now: NOW,
    });
    expect(withCopies.collections[0].kitScores).toEqual(withoutCopies.collections[0].kitScores);
    expect(withCopies.collections[0].skillCount).toBe(5);
    expect(withoutCopies.collections[0].skillCount).toBe(3);
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

describe("buildCatalog licenses", () => {
  const custom: LicenseResolution = {
    outcome: "custom",
    level: "skill",
    evidence: [{ kind: "file", level: "skill", path: "skills/f/LICENSE", blob: fp("9"), status: "unknown", spdx: null }],
  };
  const skillFile = (dir: string, spdx: string): LicenseResolution => ({
    outcome: "identified",
    spdx,
    level: "skill",
    evidence: [
      { kind: "file", level: "skill", path: `${dir}/LICENSE`, blob: fp("1"), status: "identified", spdx },
      { kind: "github", level: "repository", value: "NOASSERTION", spdx: null },
    ],
  });
  const withLicense = (letter: string, license: LicenseResolution | undefined): SkillRecord => {
    const { license: _default, ...record } = skill(letter);
    return license === undefined ? record : { ...record, license };
  };
  const buildWith = (
    list: SkillRecord[],
    curation: Curation = emptyCuration,
    truncatedRepos: string[] = [],
    isSafetyCleared?: (skill: SkillRecord) => boolean,
  ) =>
    buildCatalog({
      repos: [repo],
      skills: list,
      reviews,
      kits: testKits,
      curation,
      config: testConfig,
      now: NOW,
      truncatedRepos,
      isSafetyCleared,
    });
  const cleared = (): boolean => true;
  const missing: LicenseResolution = { outcome: "missing", level: "none", evidence: [] };
  const approve = (id: string): Curation => ({
    "resume-career": { approved: [id], rejected: [] },
    "web-app": { approved: [], rejected: [] },
  });

  it("keeps out skills whose license is not identified and allowed", () => {
    const list = [
      withLicense("a", custom),
      withLicense("b", { outcome: "ambiguous", level: "skill", evidence: [] }),
      withLicense("c", githubLicense("GPL-3.0")),
      ...["d", "e", "f"].map(skill),
    ];
    expect(buildWith(list).skills).toEqual([]);
    const missing = buildWith([withLicense("a", { outcome: "missing", level: "none", evidence: [] }), skill("b")]);
    expect(missing.skills.map((entry) => entry.name)).toEqual(["b"]);
  });

  it("keeps out a record written before license resolution", () => {
    const catalog = buildWith([withLicense("a", undefined), skill("b")]);
    expect(catalog.skills.map((entry) => entry.name)).toEqual(["b"]);
  });

  it("shows the license resolved for the skill and where it comes from", () => {
    const catalog = buildWith([withLicense("a", skillFile("skills/a", "Apache-2.0")), skill("b")]);
    const [a, b] = catalog.skills;
    expect(a).toMatchObject({
      license: "Apache-2.0",
      licenseEvidence: {
        level: "skill",
        path: "skills/a/LICENSE",
        url: "https://github.com/acme/skills/blob/main/skills/a/LICENSE",
      },
    });
    expect(b).toMatchObject({
      license: "MIT",
      licenseEvidence: { level: "repository", path: null, url: "https://github.com/acme/skills" },
    });
  });

  it("links front matter evidence to the SKILL.md file", () => {
    const license: LicenseResolution = {
      outcome: "identified",
      spdx: "MIT",
      level: "skill",
      evidence: [{ kind: "frontmatter", level: "skill", path: "skills/a/SKILL.md", value: "mit", spdx: "MIT" }],
    };
    const [a] = buildWith([withLicense("a", license)]).skills;
    expect(a.licenseEvidence).toEqual({
      level: "skill",
      path: "skills/a/SKILL.md",
      url: "https://github.com/acme/skills/blob/main/skills/a/SKILL.md",
    });
  });

  it("percent-encodes each path segment of the evidence url", () => {
    const [a] = buildWith([withLicense("a", skillFile("skills/a b#1", "MIT"))]).skills;
    expect(a.licenseEvidence).toEqual({
      level: "skill",
      path: "skills/a b#1/LICENSE",
      url: "https://github.com/acme/skills/blob/main/skills/a%20b%231/LICENSE",
    });
  });

  it("lists no collection for a repository whose tree listing was truncated", () => {
    const catalog = buildWith(skills, approve("acme/skills"), ["ACME/skills"]);
    expect(catalog.collections).toEqual([]);
    expect(catalog.skills.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(catalog.kits[0].removed).toEqual([
      { id: "acme/skills", reason: "repository listing truncated: skills past the cut are unknown" },
    ]);
  });

  it("compares the repository of an approved collection without letter case", () => {
    const list = [...["a", "b", "c", "d", "e"].map(skill), withLicense("f", custom)];
    const catalog = buildWith(list, approve("ACME/Skills"));
    expect(catalog.kits[0].pending).toEqual(["ACME/Skills"]);
    expect(catalog.kits[0].pendingReasons).toEqual({
      "ACME/Skills": "1 of 6 skills of the repository not publishable yet",
    });
  });

  it.each([
    ["a license file not read", { outcome: "ambiguous", level: "skill", unread: "license-file", evidence: [] } satisfies LicenseResolution],
    ["a changed SKILL.md not read", { outcome: "ambiguous", level: "none", unread: "skill-file", evidence: [] } satisfies LicenseResolution],
  ])("keeps an approved skill pending, not removed, with %s", (_label, license) => {
    const catalog = buildWith([withLicense("a", license), ...["b", "c"].map(skill)], approve("acme/skills:skills/a"));
    expect(catalog.kits[0].pending).toEqual(["acme/skills:skills/a"]);
    expect(catalog.kits[0].removed).toEqual([]);
    expect(catalog.kits[0].skills).toEqual([]);
    expect(catalog.skills.map((entry) => entry.name)).toEqual(["b", "c"]);
  });

  it("does not list a collection with an unpublishable skill, but keeps its publishable skills", () => {
    // f has no review, so it is not in the catalog either way; its license still blocks the collection.
    const list = [...["a", "b", "c", "d", "e"].map(skill), withLicense("f", custom)];
    const catalog = buildWith(list, approve("acme/skills"));
    expect(catalog.collections).toEqual([]);
    expect(catalog.skills.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(catalog.kits[0].pending).toEqual(["acme/skills"]);
    expect(catalog.kits[0].removed).toEqual([]);
    expect(catalog.kits[0].proposals.collections).toEqual([]);
  });

  it("gives a collection the single license of its skills, or Mixed", () => {
    const same = buildWith(skills).collections[0];
    expect(same).toMatchObject({ license: "MIT", licenses: ["MIT"] });
    const mixed = buildWith([withLicense("a", skillFile("skills/a", "Apache-2.0")), ...["b", "c", "d"].map(skill)]);
    expect(mixed.collections[0]).toMatchObject({ license: "Mixed", licenses: ["Apache-2.0", "MIT"] });
  });

  it("shows a permissive license with its outcome and category", () => {
    expect(buildWith(skills).skills[0]).toMatchObject({
      license: "MIT",
      licenseOutcome: "identified",
      licenseCategory: "permissive",
    });
  });

  it("publishes an unlicensed skill once the safety scan clears it, labelled honestly", () => {
    const catalog = buildWith([withLicense("a", missing), ...["b", "c"].map(skill)], emptyCuration, [], cleared);
    const a = catalog.skills.find((entry) => entry.name === "a");
    expect(a).toMatchObject({ license: "No license", licenseOutcome: "missing", licenseCategory: "none" });
    expect(a?.licenseEvidence).toBeUndefined();
  });

  it("publishes an unclear license once cleared, with the evidence that made it unclear", () => {
    const catalog = buildWith([withLicense("a", custom)], emptyCuration, [], cleared);
    expect(catalog.skills[0]).toMatchObject({
      license: "Unclear license",
      licenseOutcome: "custom",
      licenseCategory: "unclear",
      licenseEvidence: {
        level: "skill",
        path: "skills/f/LICENSE",
        url: "https://github.com/acme/skills/blob/main/skills/f/LICENSE",
      },
    });
  });

  it("publishes a GPL skill only when cleared, labelled GPL-3.0 in the copyleft category", () => {
    const list = [withLicense("a", githubLicense("GPL-3.0")), ...["b", "c"].map(skill)];
    expect(buildWith(list).skills.map((entry) => entry.name)).toEqual(["b", "c"]);
    const a = buildWith(list, emptyCuration, [], cleared).skills.find((entry) => entry.name === "a");
    expect(a).toMatchObject({
      license: "GPL-3.0",
      licenseOutcome: "identified",
      licenseCategory: "copyleft",
      licenseEvidence: { level: "repository", path: null, url: "https://github.com/acme/skills" },
    });
  });

  it("never publishes a skill not re-read, even when cleared", () => {
    const notRead: LicenseResolution = { outcome: "ambiguous", level: "skill", unread: "license-file", evidence: [] };
    const catalog = buildWith([withLicense("a", notRead), withLicense("b", undefined), skill("c")], emptyCuration, [], cleared);
    expect(catalog.skills.map((entry) => entry.name)).toEqual(["c"]);
  });

  it("lists a collection whose unlicensed skill is cleared, with its labels", () => {
    const list = [withLicense("a", missing), ...["b", "c", "d"].map(skill)];
    expect(buildWith(list).collections).toEqual([]);
    const [collection] = buildWith(list, emptyCuration, [], cleared).collections;
    expect(collection).toMatchObject({ id: "acme/skills", license: "Mixed", licenses: ["MIT", "No license"] });
  });

  it.each([
    ["a custom license", custom],
    ["a missing license", missing],
    ["a GPL license", githubLicense("GPL-3.0")],
  ])("keeps an approved skill with %s pending, waiting for the safety scan", (_label, license) => {
    const catalog = buildWith([withLicense("a", license), ...["b", "c"].map(skill)], approve("acme/skills:skills/a"));
    expect(catalog.kits[0].pending).toEqual(["acme/skills:skills/a"]);
    expect(catalog.kits[0].pendingReasons).toEqual({ "acme/skills:skills/a": "waiting for the safety scan" });
    expect(catalog.kits[0].removed).toEqual([]);
  });

  it.each([
    ["license unresolved", undefined],
    ["license not re-read", { outcome: "ambiguous", level: "skill", unread: "license-file", evidence: [] } satisfies LicenseResolution],
  ])("keeps an approved skill pending with the reason %s", (reason, license) => {
    const catalog = buildWith([withLicense("a", license), ...["b", "c"].map(skill)], approve("acme/skills:skills/a"));
    expect(catalog.kits[0].pending).toEqual(["acme/skills:skills/a"]);
    expect(catalog.kits[0].pendingReasons).toEqual({ "acme/skills:skills/a": reason });
  });

  it("names the review as the reason of an approved skill waiting for one", () => {
    const catalog = buildWith(skills, approve("acme/skills:skills/f"));
    expect(catalog.kits[0].pendingReasons).toEqual({ "acme/skills:skills/f": "awaiting re-review" });
  });

  it("reports an approved cleared skill under the usual review rules", () => {
    // d is cleared but its review is below the threshold: removed for its score, not its license.
    const catalog = buildWith([withLicense("d", missing), ...["a", "b"].map(skill)], approve("acme/skills:skills/d"), [], cleared);
    expect(catalog.kits[0].removed).toEqual([{ id: "acme/skills:skills/d", reason: "review score 5 below 6" }]);
  });

  it("writes no pending reasons when nothing is pending", () => {
    expect(buildWith(skills).kits[0]).not.toHaveProperty("pendingReasons");
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
