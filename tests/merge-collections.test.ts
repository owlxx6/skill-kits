import { describe, expect, it } from "vitest";
import { mergeApprovedCollections } from "../pipeline/lib/merge-collections";
import { buildCatalog } from "../pipeline/rank";
import type { Catalog, Curation, Review } from "../pipeline/lib/schemas";
import { NOW, fp, makeRepo, makeReview, makeSkill, testConfig, testKits } from "./fixtures";

const noCuration: Curation = {
  "resume-career": { approved: [], rejected: [] },
  "web-app": { approved: [], rejected: [] },
};

const uniform = (value: number, overrides: Partial<Review> = {}): Review =>
  makeReview({ scores: { clarity: value, completeness: value, usefulness: value }, ...overrides });

const skillOf = (repo: string, letter: string) =>
  makeSkill({
    id: `${repo}:skills/${letter}`,
    repo,
    path: `skills/${letter}`,
    name: letter,
    fingerprint: fp(letter),
  });

// "keep/skills" is already public; "new/skills" is the repository the owner approves.
const keepRepo = makeRepo({ fullName: "keep/skills", url: "https://github.com/keep/skills" });
const newRepo = makeRepo({ fullName: "new/skills", url: "https://github.com/new/skills", stars: 3000 });
const keepSkills = ["a", "b", "c"].map((letter) => skillOf("keep/skills", letter));
const newSkills = ["d", "e", "f", "g"].map((letter) => skillOf("new/skills", letter));
const reviews = new Map<string, Review>([
  [fp("a"), uniform(9)],
  [fp("b"), uniform(8)],
  [fp("c"), uniform(7)],
  [fp("d"), uniform(9, { security: { level: "notice", notes: ["Runs a script"] } })],
  [fp("e"), uniform(8)],
  [fp("f"), uniform(7)],
  [fp("g"), uniform(5)], // below the catalog threshold: not listed
]);

const build = (repos: ReturnType<typeof makeRepo>[], skills: ReturnType<typeof makeSkill>[]): Catalog =>
  buildCatalog({ repos, skills, reviews, kits: testKits, curation: noCuration, config: testConfig, now: NOW });

const existing = build([keepRepo], keepSkills);
const computed = build([keepRepo, newRepo], [...keepSkills, ...newSkills]);

describe("mergeApprovedCollections", () => {
  const merged = mergeApprovedCollections(existing, computed, [{ kitId: "resume-career", repo: "new/skills" }]);

  it("keeps the existing skills as they are and adds the reviewed ones of the repository", () => {
    expect(merged.skills.slice(0, existing.skills.length)).toEqual(existing.skills);
    expect(merged.skills.slice(existing.skills.length).map((skill) => skill.id)).toEqual([
      "new/skills:skills/d",
      "new/skills:skills/e",
      "new/skills:skills/f",
    ]);
  });

  it("does not mark the new records as read by a person and keeps the notes private", () => {
    const added = merged.skills.filter((skill) => skill.repo === "new/skills");
    expect(added.every((skill) => skill.humanReviewed === false)).toBe(true);
    expect(added.find((skill) => skill.name === "d")?.review.security).toEqual({ level: "notice", notes: [] });
    expect(merged.collections.find((collection) => collection.id === "new/skills")?.humanReviewed).toBe(false);
  });

  it("adds the collection, keeps the others and lists only skills that exist", () => {
    expect(merged.collections.map((collection) => collection.id).sort()).toEqual(["keep/skills", "new/skills"]);
    const collection = merged.collections.find((entry) => entry.id === "new/skills")!;
    expect(collection.skillCount).toBe(4);
    expect(collection.catalogSkillIds).toHaveLength(3);
    const ids = new Set(merged.skills.map((skill) => skill.id));
    expect(collection.catalogSkillIds.every((id) => ids.has(id))).toBe(true);
  });

  it("shows the collection under the approving kit and no longer proposes it", () => {
    const [resume, webApp] = merged.kits;
    expect(resume.collections).toEqual(["new/skills"]);
    expect(resume.proposals.collections.map((proposal) => proposal.id)).not.toContain("new/skills");
    expect(webApp).toEqual(existing.kits[1]);
  });

  it("is idempotent", () => {
    const again = mergeApprovedCollections(merged, computed, [{ kitId: "resume-career", repo: "new/skills" }]);
    expect(again.skills).toEqual(merged.skills);
    expect(again.kits.map((kit) => kit.collections)).toEqual(merged.kits.map((kit) => kit.collections));
  });

  it("refuses a repository that is not an eligible collection or an unknown kit", () => {
    expect(() => mergeApprovedCollections(existing, computed, [{ kitId: "resume-career", repo: "nope/skills" }])).toThrow(
      /Not an eligible collection/,
    );
    expect(() => mergeApprovedCollections(existing, computed, [{ kitId: "no-kit", repo: "new/skills" }])).toThrow(
      /Unknown kit/,
    );
  });
});
