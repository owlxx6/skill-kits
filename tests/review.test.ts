import { describe, expect, it } from "vitest";
import { FatalLlmError } from "../pipeline/lib/errors";
import type { ReviewRecord } from "../pipeline/lib/schemas";
import {
  emptyReviewStats,
  normalizeReview,
  reviewSkill,
  runReviews,
  runTriage,
  selectForReview,
} from "../pipeline/review";
import { FakeGitHub, FakeLlm, REFUSAL } from "./fakes";
import { NOW, fp, makeRepo, makeReview, makeSkill, skillMd, testConfig, testKits } from "./fixtures";

const settings = testConfig.review;
const noTriage = (): unknown => ({ results: [] });
const noReview = (): unknown => null;

describe("runTriage", () => {
  const skills = [
    makeSkill({ id: "acme/skills:a", name: "a", fingerprint: fp("a") }),
    makeSkill({ id: "acme/skills:b", name: "b", fingerprint: fp("b") }),
    makeSkill({ id: "fork/skills:b", repo: "fork/skills", name: "b", fingerprint: fp("b") }),
    makeSkill({ id: "acme/skills:c", name: "c", fingerprint: fp("c") }),
  ];

  it("sends only unknown fingerprints, once each, and keeps valid kit ids", async () => {
    const llm = new FakeLlm(
      (items) => ({
        results: items.map((item) => ({
          index: item.index,
          kits: item.name === "b" ? ["resume-career", "not-a-kit"] : [],
        })),
      }),
      noReview,
    );
    const stats = emptyReviewStats();
    const triage = await runTriage(llm, skills, { [fp("a")]: ["web-app"] }, testKits, 1, stats);
    expect(llm.triageCalls.map((call) => call[0].name)).toEqual(["b", "c"]);
    expect(triage).toEqual({
      [fp("a")]: ["web-app"],
      [fp("b")]: ["resume-career"],
      [fp("c")]: [],
    });
    expect(stats.triaged).toBe(2);
    expect(stats.triageUsage).toEqual({ inputTokens: 200, outputTokens: 20 });
  });

  it("leaves a batch untriaged when the answer is unusable", async () => {
    const llm = new FakeLlm(() => null, noReview);
    const stats = emptyReviewStats();
    const triage = await runTriage(llm, skills, {}, testKits, 50, stats);
    expect(triage).toEqual({});
    expect(stats.triageMissing).toBe(3);
  });

  it("stops the run on a fatal error", async () => {
    const llm = new FakeLlm(() => {
      throw new FatalLlmError("bad key");
    }, noReview);
    await expect(
      runTriage(llm, skills, {}, testKits, 50, emptyReviewStats()),
    ).rejects.toThrow(FatalLlmError);
  });
});

describe("selectForReview", () => {
  const repos = [
    makeRepo({ fullName: "small/repo", stars: 100 }),
    makeRepo({ fullName: "big/repo", stars: 9000 }),
  ];
  const skills = [
    makeSkill({ id: "small/repo:a", repo: "small/repo", fingerprint: fp("a") }),
    makeSkill({ id: "big/repo:b", repo: "big/repo", fingerprint: fp("b") }),
    makeSkill({ id: "big/repo:c", repo: "big/repo", fingerprint: fp("c") }),
    makeSkill({ id: "big/repo:d", repo: "big/repo", fingerprint: fp("d") }),
    makeSkill({ id: "big/repo:e", repo: "big/repo", fingerprint: fp("e") }),
  ];
  const triage = {
    [fp("a")]: ["resume-career"],
    [fp("b")]: ["resume-career"],
    [fp("c")]: [],
    [fp("d")]: ["web-app"],
    [fp("e")]: ["web-app"],
  };

  it("keeps triaged, unreviewed skills, most starred repo first, within the cap", () => {
    const result = selectForReview(skills, triage, new Set([fp("e")]), repos, 2);
    expect(result.selected.map((skill) => skill.id)).toEqual(["big/repo:b", "big/repo:d"]);
    expect(result.deferred).toBe(1);
  });
});

describe("reviewSkill", () => {
  const skill = makeSkill();

  it("returns a valid review and drops unknown kit ids", async () => {
    const llm = new FakeLlm(noTriage, () => makeReview({ kits: ["resume-career", "ghost-kit"] }));
    const outcome = await reviewSkill(llm, skill, "content", testKits, settings);
    expect(outcome.review?.kits).toEqual(["resume-career"]);
    expect(llm.reviewCalls).toHaveLength(1);
  });

  it("retries once after an invalid answer", async () => {
    const llm = new FakeLlm(noTriage, (_input, attempt) =>
      attempt === 1 ? { nonsense: true } : makeReview(),
    );
    const outcome = await reviewSkill(llm, skill, "content", testKits, settings);
    expect(outcome.review).not.toBeNull();
    expect(llm.reviewCalls).toHaveLength(2);
    expect(outcome.usage).toEqual({ inputTokens: 2000, outputTokens: 200 });
  });

  it("gives up after two invalid answers and says why", async () => {
    const llm = new FakeLlm(noTriage, () => makeReview({ why: "x".repeat(200) }));
    const outcome = await reviewSkill(llm, skill, "content", testKits, settings);
    expect(outcome.review).toBeNull();
    expect(outcome.reason).toContain("why");
    expect(llm.reviewCalls).toHaveLength(2);
  });

  it("accepts a slightly over-long answer without a retry", async () => {
    const llm = new FakeLlm(noTriage, () =>
      makeReview({
        keywords: Array.from({ length: 13 }, (_, index) => `keyword-${index}`),
        strengths: ["a", "b", "c", "d"],
      }),
    );
    const outcome = await reviewSkill(llm, skill, "content", testKits, settings);
    expect(outcome.review).not.toBeNull();
    expect(outcome.review?.keywords).toHaveLength(12);
    expect(outcome.review?.strengths).toHaveLength(3);
    expect(llm.reviewCalls).toHaveLength(1);
  });

  it("does not retry a refusal", async () => {
    const llm = new FakeLlm(noTriage, () => REFUSAL);
    const outcome = await reviewSkill(llm, skill, "content", testKits, settings);
    expect(outcome).toMatchObject({ review: null, reason: "model refused" });
    expect(llm.reviewCalls).toHaveLength(1);
  });

  it("cuts oversized content and flags it", async () => {
    const llm = new FakeLlm(noTriage, () => makeReview());
    const outcome = await reviewSkill(llm, skill, "x".repeat(30000), testKits, settings);
    expect(outcome.truncated).toBe(true);
    expect(llm.reviewCalls[0].content).toHaveLength(24000);
    expect(llm.reviewCalls[0].truncated).toBe(true);
  });
});

describe("normalizeReview", () => {
  const kitIds = new Set(["resume-career", "web-app", "data-science"]);

  it("drops unknown kit ids and keeps at most two", () => {
    const result = normalizeReview({ kits: ["ghost", "resume-career", "web-app", "data-science"] }, kitIds);
    expect(result).toEqual({ kits: ["resume-career", "web-app"] });
    expect(normalizeReview({ kits: [1, "web-app"] }, kitIds)).toEqual({ kits: ["web-app"] });
  });

  it("cuts strengths, cautions and keywords", () => {
    const four = ["a", "b", "c", "d"];
    const thirteen = Array.from({ length: 13 }, (_, index) => `k${index}`);
    const result = normalizeReview({ strengths: four, cautions: four, keywords: thirteen }, kitIds);
    expect(result).toEqual({
      strengths: ["a", "b", "c"],
      cautions: ["a", "b", "c"],
      keywords: thirteen.slice(0, 12),
    });
  });

  it("returns anything that is not an object unchanged", () => {
    expect(normalizeReview(null, kitIds)).toBeNull();
    expect(normalizeReview("text", kitIds)).toBe("text");
    expect(normalizeReview([1, 2], kitIds)).toEqual([1, 2]);
  });

  it("leaves other fields alone, such as an over-long why", () => {
    const why = "x".repeat(200);
    expect(normalizeReview({ why }, kitIds)).toEqual({ why });
  });
});

describe("runReviews", () => {
  const repo = makeRepo();
  const files = {
    "skills/a/SKILL.md": skillMd("a", "Skill a"),
    "skills/b/SKILL.md": skillMd("b", "Skill b"),
  };
  const selected = [
    makeSkill({ id: "acme/skills:skills/a", path: "skills/a", name: "a", fingerprint: fp("a") }),
    makeSkill({ id: "acme/skills:skills/b", path: "skills/b", name: "b", fingerprint: fp("b") }),
  ];

  it("saves valid reviews and lists the failures", async () => {
    const gh = new FakeGitHub([{ meta: repo, files }]);
    const llm = new FakeLlm(noTriage, (input) => (input.name === "a" ? makeReview() : null));
    const saved: ReviewRecord[] = [];
    const stats = emptyReviewStats();
    await runReviews(
      {
        llm,
        gh,
        kits: testKits,
        repos: [repo],
        settings,
        now: NOW,
        saveReview: async (record) => {
          saved.push(record);
        },
      },
      selected,
      stats,
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      fingerprint: fp("a"),
      model: "claude-haiku-5-5",
      reviewedAt: "2026-11-11T00:00:00.000Z",
    });
    expect(stats.reviewed).toBe(1);
    expect(stats.reviewedIds).toEqual(["acme/skills:skills/a"]);
    expect(stats.failed.map((failure) => failure.skillId)).toEqual(["acme/skills:skills/b"]);
    expect(stats.reviewUsage).toEqual({ inputTokens: 3000, outputTokens: 300 });
  });

  it("stops the run on a fatal error", async () => {
    const gh = new FakeGitHub([{ meta: repo, files }]);
    const llm = new FakeLlm(noTriage, () => {
      throw new FatalLlmError("bad key");
    });
    await expect(
      runReviews(
        {
          llm,
          gh,
          kits: testKits,
          repos: [repo],
          settings,
          now: NOW,
          saveReview: async () => {},
        },
        selected,
        emptyReviewStats(),
      ),
    ).rejects.toThrow(FatalLlmError);
  });
});
