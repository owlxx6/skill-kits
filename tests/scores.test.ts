import { describe, expect, it } from "vitest";
import {
  collectionKitScore,
  daysBetween,
  freshnessScore,
  logScale,
  median,
  repoSignal,
  reviewScore,
  skillScore,
} from "../pipeline/lib/scores";
import { NOW, makeRepo, testConfig } from "./fixtures";

const scoring = testConfig.scoring;

describe("logScale", () => {
  it("returns 0 at or below the minimum and 10 at or above the maximum", () => {
    expect(logScale(50, 50, 50000)).toBe(0);
    expect(logScale(10, 50, 50000)).toBe(0);
    expect(logScale(50000, 50, 50000)).toBe(10);
    expect(logScale(90000, 50, 50000)).toBe(10);
  });

  it("returns 5 at the geometric middle", () => {
    expect(logScale(1581.14, 50, 50000)).toBeCloseTo(5, 2);
  });
});

describe("freshnessScore", () => {
  it("is 10 within the full window, 0 past the limit, linear in between", () => {
    expect(freshnessScore(10, 30, 180)).toBe(10);
    expect(freshnessScore(180, 30, 180)).toBe(0);
    expect(freshnessScore(400, 30, 180)).toBe(0);
    expect(freshnessScore(105, 30, 180)).toBe(5);
  });
});

describe("daysBetween", () => {
  it("counts days from an ISO date to now", () => {
    expect(daysBetween("2026-11-01T00:00:00Z", NOW)).toBe(10);
    expect(daysBetween("2026-11-10T12:00:00Z", NOW)).toBe(0.5);
  });

  it("throws on an unparseable date", () => {
    expect(() => daysBetween("not-a-date", NOW)).toThrow("invalid date: not-a-date");
  });
});

describe("repoSignal", () => {
  it("combines stars, forks and freshness with the configured weights", () => {
    expect(repoSignal(makeRepo(), NOW, scoring)).toBe(5);
  });

  it("reaches 10 for a very popular repo pushed this week", () => {
    const repo = makeRepo({ stars: 60000, forks: 6000, pushedAt: "2026-11-08T00:00:00Z" });
    expect(repoSignal(repo, NOW, scoring)).toBe(10);
  });

  it("treats a push dated in the future as fully fresh", () => {
    const repo = makeRepo({ pushedAt: "2027-01-01T00:00:00Z", stars: 0, forks: 0 });
    expect(repoSignal(repo, NOW, scoring)).toBe(2);
  });
});

describe("reviewScore", () => {
  it("is the mean of the three criteria, rounded to one decimal", () => {
    expect(reviewScore({ clarity: 8, completeness: 7, usefulness: 9 })).toBe(8);
    expect(reviewScore({ clarity: 7, completeness: 7, usefulness: 8 })).toBe(7.3);
  });
});

describe("skillScore", () => {
  it("weights the review at 70% and the repo signal at 30%", () => {
    expect(skillScore(8, 5, scoring)).toBe(7.1);
  });
});

describe("median", () => {
  it("handles empty, odd and even lists", () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("collectionKitScore", () => {
  it("combines repo signal, median review and coverage", () => {
    expect(collectionKitScore(6, [7, 8, 9], scoring)).toBe(6.2);
  });

  it("caps coverage at the configured number of skills", () => {
    expect(collectionKitScore(10, Array(12).fill(8), scoring)).toBe(9.2);
  });

  it("rescales coverage for a cap other than 10", () => {
    const capFive = { ...scoring, collection: { ...scoring.collection, coverageCap: 5 } };
    expect(collectionKitScore(0, [0, 0, 0], capFive)).toBe(1.2);
  });
});
