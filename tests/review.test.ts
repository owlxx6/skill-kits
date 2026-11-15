import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FatalLlmError } from "../pipeline/lib/errors";
import type { ReviewRecord } from "../pipeline/lib/schemas";
import {
  emptyReviewStats,
  normalizeReview,
  reviewSkill,
  runReviews,
  runTriage,
  selectForReview,
  type ReviewDeps,
} from "../pipeline/review";
import { FakeGitHub, FakeLlm, REFUSAL } from "./fakes";
import { NOW, fp, makeRepo, makeReview, makeSkill, skillMd, testConfig, testKits } from "./fixtures";

const settings = testConfig.review;
const noTriage = (): unknown => ({ results: [] });
const noReview = (): unknown => null;
const noSave = async (): Promise<void> => {};

let warn: MockInstance;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

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
    const triage = await runTriage(llm, skills, { [fp("a")]: ["web-app"] }, testKits, 1, stats, noSave);
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
    const triage = await runTriage(llm, skills, {}, testKits, 50, stats, noSave);
    expect(triage).toEqual({});
    expect(stats.triageMissing).toBe(3);
  });

  it("stops the run on a fatal error", async () => {
    const llm = new FakeLlm(() => {
      throw new FatalLlmError("bad key");
    }, noReview);
    await expect(
      runTriage(llm, skills, {}, testKits, 50, emptyReviewStats(), noSave),
    ).rejects.toThrow(FatalLlmError);
  });
});

describe("runTriage, isolation and progress", () => {
  const mk = (name: string) => makeSkill({ id: `acme/skills:${name}`, name, fingerprint: fp(name) });
  const answerAll = (items: { index: number }[]): unknown => ({
    results: items.map((item) => ({ index: item.index, kits: ["web-app"] })),
  });

  it("isolates a poison item by splitting the batch", async () => {
    const skills = [mk("a"), mk("poison"), mk("c"), mk("d")];
    const llm = new FakeLlm(
      (items) => (items.some((item) => item.name === "poison") ? null : answerAll(items)),
      noReview,
    );
    const stats = emptyReviewStats();
    const triage = await runTriage(llm, skills, {}, testKits, 50, stats, noSave);
    expect(Object.keys(triage).sort()).toEqual([fp("a"), fp("c"), fp("d")].sort());
    expect(triage[fp("poison")]).toBeUndefined();
    expect(stats.triageMissing).toBe(1);
    expect(stats.triaged).toBe(3);
    expect(stats.triageUsage.inputTokens).toBe(llm.triageCalls.length * 100);
  });

  it("saves after each top-level batch and keeps progress on a fatal error", async () => {
    const skills = [mk("a"), mk("b")];
    let calls = 0;
    const llm = new FakeLlm((items) => {
      calls += 1;
      if (calls === 2) throw new FatalLlmError("bad key");
      return answerAll(items);
    }, noReview);
    const saved: Record<string, string[]>[] = [];
    await expect(
      runTriage(llm, skills, {}, testKits, 1, emptyReviewStats(), async (cache) => {
        saved.push({ ...cache });
      }),
    ).rejects.toThrow(FatalLlmError);
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0])).toEqual([fp("a")]);
  });

  it("handles a duplicate index, an out-of-range index and a missing item", async () => {
    const skills = [mk("a"), mk("b"), mk("c")];
    const llm = new FakeLlm(
      () => ({
        results: [
          { index: 0, kits: ["web-app"] },
          { index: 0, kits: ["resume-career"] },
          { index: 7, kits: ["web-app"] },
          { index: 1, kits: [] },
        ],
      }),
      noReview,
    );
    const stats = emptyReviewStats();
    const triage = await runTriage(llm, skills, {}, testKits, 50, stats, noSave);
    expect(triage).toEqual({ [fp("a")]: ["web-app"], [fp("b")]: [] });
    expect(stats.triaged).toBe(2);
    expect(stats.triageMissing).toBe(1);
    expect(llm.triageCalls).toHaveLength(1);
  });

  it("cuts pending skills into batches", async () => {
    const skills = ["a", "b", "c", "d", "e"].map(mk);
    const llm = new FakeLlm(answerAll, noReview);
    const saved: number[] = [];
    await runTriage(llm, skills, {}, testKits, 2, emptyReviewStats(), async (cache) => {
      saved.push(Object.keys(cache).length);
    });
    expect(llm.triageCalls.map((call) => call.length)).toEqual([2, 2, 1]);
    expect(saved).toEqual([2, 4, 5]);
  });

  it("starts no new batch once the time budget is spent", async () => {
    const skills = ["a", "b", "c", "d", "e"].map(mk);
    const llm = new FakeLlm(answerAll, noReview);
    const stats = emptyReviewStats();
    const saved: number[] = [];
    const triage = await runTriage(
      llm,
      skills,
      {},
      testKits,
      2,
      stats,
      async (cache) => {
        saved.push(Object.keys(cache).length);
      },
      () => llm.triageCalls.length >= 1,
    );
    expect(llm.triageCalls.map((call) => call.length)).toEqual([2]);
    expect(Object.keys(triage)).toEqual([fp("a"), fp("b")]);
    expect(saved).toEqual([2]);
    expect(stats.triaged).toBe(2);
    expect(stats.triageMissing).toBe(3);
    expect(stats.stoppedByTimeBudget).toBe(true);
  });

  it("counts a single item whose call throws a plain error as missing", async () => {
    const llm = new FakeLlm(() => {
      throw new Error("network down");
    }, noReview);
    const stats = emptyReviewStats();
    const triage = await runTriage(llm, [mk("a")], {}, testKits, 1, stats, noSave);
    expect(triage).toEqual({});
    expect(stats.triageMissing).toBe(1);
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

describe("selectForReview, priority ids", () => {
  const repos = [
    makeRepo({ fullName: "tiny/repo", stars: 10 }),
    makeRepo({ fullName: "big/repo", stars: 9000 }),
  ];
  const skills = [
    makeSkill({ id: "tiny/repo:p", repo: "tiny/repo", fingerprint: fp("p") }),
    makeSkill({ id: "big/repo:q", repo: "big/repo", fingerprint: fp("q") }),
  ];

  it("selects a priority id before a more starred skill", () => {
    const triage = { [fp("p")]: ["web-app"], [fp("q")]: ["web-app"] };
    const result = selectForReview(skills, triage, new Set(), repos, 1, new Set(["tiny/repo:p"]));
    expect(result.selected.map((skill) => skill.id)).toEqual(["tiny/repo:p"]);
    expect(result.deferred).toBe(1);
  });

  it("selects a priority id even when triage gave it no kit", () => {
    const triage = { [fp("p")]: [] };
    const result = selectForReview(skills, triage, new Set(), repos, 5, new Set(["tiny/repo:p"]));
    expect(result.selected.map((skill) => skill.id)).toEqual(["tiny/repo:p"]);
  });
});

describe("selectForReview, copies and unlisted repositories", () => {
  it("keeps the copy of the most starred repository", () => {
    const repos = [
      makeRepo({ fullName: "aaa/fork", stars: 60 }),
      makeRepo({ fullName: "zzz/main", stars: 9000 }),
      makeRepo({ fullName: "mid/repo", stars: 500 }),
    ];
    const skills = [
      makeSkill({ id: "aaa/fork:x", repo: "aaa/fork", fingerprint: fp("x") }),
      makeSkill({ id: "zzz/main:x", repo: "zzz/main", fingerprint: fp("x") }),
      makeSkill({ id: "mid/repo:y", repo: "mid/repo", fingerprint: fp("y") }),
    ];
    const triage = { [fp("x")]: ["web-app"], [fp("y")]: ["web-app"] };
    const result = selectForReview(skills, triage, new Set(), repos, 1);
    expect(result.selected.map((skill) => skill.id)).toEqual(["zzz/main:x"]);
    expect(result.deferred).toBe(1);
  });

  it("ignores a skill whose repository is not listed", () => {
    const skills = [makeSkill({ id: "gone/repo:z", repo: "gone/repo", fingerprint: fp("z") })];
    const result = selectForReview(skills, { [fp("z")]: ["web-app"] }, new Set(), [], 5);
    expect(result).toEqual({ selected: [], deferred: 0 });
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

  it("keeps the usage of earlier calls when a later attempt throws", async () => {
    const llm = new FakeLlm(noTriage, (_input, attempt) => {
      if (attempt === 2) throw new Error("socket hang up");
      return { nonsense: true };
    });
    const outcome = await reviewSkill(llm, skill, "content", testKits, settings);
    expect(outcome.review).toBeNull();
    expect(outcome.reason).toContain("socket hang up");
    expect(outcome.usage).toEqual({ inputTokens: 1000, outputTokens: 100 });
  });

  it("rethrows a fatal error", async () => {
    const llm = new FakeLlm(noTriage, () => {
      throw new FatalLlmError("bad key");
    });
    await expect(reviewSkill(llm, skill, "content", testKits, settings)).rejects.toThrow(
      FatalLlmError,
    );
  });

  it("warns about the unknown kit ids it drops", async () => {
    const llm = new FakeLlm(noTriage, () => makeReview({ kits: ["resume-career", "ghost-kit"] }));
    await reviewSkill(llm, skill, "content", testKits, settings);
    expect(warn).toHaveBeenCalledWith(`Unknown kit ids dropped for ${skill.id}: ghost-kit`);
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
        skills: selected,
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
          skills: selected,
          settings,
          now: NOW,
          saveReview: async () => {},
        },
        selected,
        emptyReviewStats(),
      ),
    ).rejects.toThrow(FatalLlmError);
  });

  const deps = (llm: FakeLlm, gh: FakeGitHub, extra: Partial<ReviewDeps> = {}): ReviewDeps => ({
    llm,
    gh,
    kits: testKits,
    repos: [repo],
    skills: selected,
    settings,
    now: NOW,
    saveReview: async () => {},
    ...extra,
  });

  it("reports every copy of a reviewed fingerprint", async () => {
    const copy = makeSkill({ id: "fork/skills:skills/a", repo: "fork/skills", path: "skills/a", name: "a", fingerprint: fp("a") });
    const gh = new FakeGitHub([{ meta: repo, files }]);
    const llm = new FakeLlm(noTriage, () => makeReview());
    const stats = emptyReviewStats();
    await runReviews(
      deps(llm, gh, { repos: [repo, makeRepo({ fullName: "fork/skills" })], skills: [selected[0], copy] }),
      [selected[0]],
      stats,
    );
    expect(stats.reviewed).toBe(1);
    expect(stats.reviewedIds).toEqual(["acme/skills:skills/a", "fork/skills:skills/a"]);
  });

  it("does not report a copy whose repository is no longer listed", async () => {
    const stale = makeSkill({ id: "gone/skills:skills/a", repo: "gone/skills", path: "skills/a", name: "a", fingerprint: fp("a") });
    const gh = new FakeGitHub([{ meta: repo, files }]);
    const llm = new FakeLlm(noTriage, () => makeReview());
    const stats = emptyReviewStats();
    await runReviews(deps(llm, gh, { skills: [selected[0], stale] }), [selected[0]], stats);
    expect(stats.reviewedIds).toEqual(["acme/skills:skills/a"]);
  });

  it("records a skill whose repository is no longer listed", async () => {
    const gh = new FakeGitHub([{ meta: repo, files }]);
    const llm = new FakeLlm(noTriage, () => makeReview());
    const stats = emptyReviewStats();
    await runReviews(deps(llm, gh, { repos: [] }), [selected[0]], stats);
    expect(stats.failed).toEqual([
      { skillId: "acme/skills:skills/a", reason: "repository no longer listed" },
    ]);
  });

  it("records a failed download and still reviews the others", async () => {
    const gh = new FakeGitHub([{ meta: repo, files }]);
    gh.failFileFor.add("acme/skills/skills/a/SKILL.md");
    const llm = new FakeLlm(noTriage, () => makeReview());
    const stats = emptyReviewStats();
    await runReviews(deps(llm, gh), selected, stats);
    expect(stats.failed.map((failure) => failure.skillId)).toEqual(["acme/skills:skills/a"]);
    expect(stats.failed[0].reason).toContain("network error");
    expect(stats.reviewedIds).toEqual(["acme/skills:skills/b"]);
  });

  it("records a refusal and counts the tokens of its call", async () => {
    const gh = new FakeGitHub([{ meta: repo, files }]);
    const llm = new FakeLlm(noTriage, () => REFUSAL);
    const stats = emptyReviewStats();
    await runReviews(deps(llm, gh), [selected[0]], stats);
    expect(stats.failed).toEqual([{ skillId: "acme/skills:skills/a", reason: "model refused" }]);
    expect(stats.reviewUsage).toEqual({ inputTokens: 1000, outputTokens: 100 });
  });

  it("starts no new review once the time budget is spent and defers the rest", async () => {
    const third = makeSkill({ id: "acme/skills:skills/c", path: "skills/c", name: "c", fingerprint: fp("c") });
    const gh = new FakeGitHub([{ meta: repo, files: { ...files, "skills/c/SKILL.md": skillMd("c", "Skill c") } }]);
    const llm = new FakeLlm(noTriage, () => makeReview());
    const stats = emptyReviewStats();
    stats.deferred = 4;
    await runReviews(
      deps(llm, gh, { skills: [...selected, third] }),
      [...selected, third],
      stats,
      () => llm.reviewCalls.length >= 1,
    );
    expect(llm.reviewCalls).toHaveLength(1);
    expect(stats.reviewed).toBe(1);
    expect(stats.deferred).toBe(6);
    expect(stats.stoppedByTimeBudget).toBe(true);
    expect(stats.failed).toEqual([]);
  });

  it("does not flag the time budget when every review ran", async () => {
    const gh = new FakeGitHub([{ meta: repo, files }]);
    const llm = new FakeLlm(noTriage, () => makeReview());
    const stats = emptyReviewStats();
    await runReviews(deps(llm, gh), selected, stats, () => false);
    expect(stats.reviewed).toBe(2);
    expect(stats.stoppedByTimeBudget).toBe(false);
  });

  it("counts an oversized file as truncated", async () => {
    const big = { "skills/a/SKILL.md": `${skillMd("a", "Skill a")}\n${"x".repeat(30000)}` };
    const gh = new FakeGitHub([{ meta: repo, files: big }]);
    const llm = new FakeLlm(noTriage, () => makeReview());
    const stats = emptyReviewStats();
    await runReviews(deps(llm, gh), [selected[0]], stats);
    expect(stats.truncated).toBe(1);
    expect(stats.reviewed).toBe(1);
  });
});
