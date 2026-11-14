import { describe, expect, it } from "vitest";
import type { Catalog, RunInfo } from "../pipeline/lib/schemas";
import { buildSummary } from "../pipeline/publish";
import { makeReview } from "./fixtures";

const catalog: Catalog = {
  generatedAt: "2026-11-11T00:00:00.000Z",
  kits: [
    {
      id: "resume-career",
      title: "Resume & career agent",
      description: "Tailor a resume.",
      collections: ["acme/skills"],
      skills: ["acme/skills:skills/b"],
      removed: ["gone/repo:skills/x"],
      pending: ["acme/skills:skills/c"],
      proposals: {
        collections: [{ id: "other/skills", score: 6.2 }],
        skills: [{ id: "acme/skills:skills/a", score: 7.8 }],
      },
    },
  ],
  skills: [
    {
      id: "acme/skills:skills/a",
      repo: "acme/skills",
      path: "skills/a",
      name: "a",
      description: "Skill a",
      url: "https://github.com/acme/skills/tree/main/skills/a",
      license: "MIT",
      stars: 1581,
      forks: 158,
      pushedAt: "2026-07-29T00:00:00Z",
      review: makeReview({ why: "Ask @octocat about `this`\nnow." }),
      reviewScore: 9,
      repoSignal: 5,
      score: 7.8,
      humanReviewed: false,
    },
  ],
  collections: [],
};

const runInfo: RunInfo = {
  filtered: [{ fullName: "nolicense/skills", reason: "license none not allowed" }],
  extract: {
    repos: 3,
    skills: 40,
    invalid: 2,
    failedDownloads: 3,
    truncatedRepos: [],
    failedRepos: [{ repo: "flaky/repo", error: "network error" }],
  },
  review: {
    triaged: 40,
    triageMissing: 0,
    reviewed: 4,
    reviewedIds: ["acme/skills:skills/b"],
    deferred: 6,
    truncated: 1,
    failed: [{ skillId: "solo/broken:skills/flaky", reason: "invalid review: why too long" }],
    triageUsage: { inputTokens: 5000, outputTokens: 500 },
    reviewUsage: { inputTokens: 20000, outputTokens: 4000 },
  },
};

describe("buildSummary", () => {
  const summary = buildSummary(catalog, runInfo);

  it("starts with the date and the catalog size", () => {
    expect(summary).toContain("# Pipeline run 2026-11-11");
    expect(summary).toContain("Catalog: 1 skills, 0 collections.");
  });

  it("lists candidates, removals and counts per kit", () => {
    expect(summary).toContain("## Resume & career agent (`resume-career`)");
    expect(summary).toContain("Approved: 1 collections, 1 skills.");
    expect(summary).toContain("**Approved skills re-reviewed this run (content changed):**");
    expect(summary).toContain("- `acme/skills:skills/b`");
    expect(summary).toContain("**Approved entries that are no longer eligible (below threshold, severe, or gone):**");
    expect(summary).toContain("- `gone/repo:skills/x`");
    expect(summary).toContain("- `other/skills` - score 6.2");
    expect(summary).toContain("- `acme/skills:skills/a` - score 7.8 -");
  });

  it("lists approved entries awaiting re-review", () => {
    expect(summary).toContain("**Approved entries awaiting re-review (hidden until reviewed):**");
    expect(summary).toContain("- `acme/skills:skills/c`");
  });

  it("neutralizes mentions, backticks and line breaks coming from the model", () => {
    expect(summary).toContain("Ask (at)octocat about this now.");
    expect(summary).not.toContain("@octocat");
  });

  it("reports extraction counts", () => {
    expect(summary).toContain("2 invalid SKILL.md files, 3 failed downloads");
  });

  it("reports token use per reviewed skill, failures and filtered repos", () => {
    expect(summary).toContain("Review tokens: 20000 in, 4000 out (5000 in, 1000 out per reviewed skill)");
    expect(summary).toContain("Triage tokens: 5000 in, 500 out");
    expect(summary).toContain("- `solo/broken:skills/flaky`: invalid review: why too long");
    expect(summary).toContain("- `nolicense/skills`: license none not allowed");
    expect(summary).toContain("- `flaky/repo`: network error");
  });

  it("works when no run information is available", () => {
    expect(buildSummary(catalog, {})).toContain("# Pipeline run 2026-11-11");
  });
});
