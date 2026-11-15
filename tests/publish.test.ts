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
    stoppedByTimeBudget: false,
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
    expect(summary).toContain(
      "- [`acme/skills:skills/a`](https://github.com/acme/skills/tree/main/skills/a) - score 7.8 - Ask",
    );
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

  it("says when the time budget stopped the review step", () => {
    const line = "- Stopped by the time budget (review.maxMinutes): the rest is deferred to the next run";
    expect(summary).not.toContain(line);
    const stopped = buildSummary(catalog, {
      review: { ...(runInfo.review as NonNullable<RunInfo["review"]>), stoppedByTimeBudget: true },
    });
    expect(stopped).toContain(line);
  });

  it("lists renamed repositories right after the Run section", () => {
    const text = buildSummary(catalog, {
      ...runInfo,
      renamed: [{ from: "old/name", to: "new/name" }],
    });
    expect(text).toContain(
      "## Renamed repositories\n\n- `old/name` -> `new/name`\n\nUpdate data/sources.yaml and the ids in data/curation.yaml.\n",
    );
    expect(text.indexOf("## Run")).toBeLessThan(text.indexOf("## Renamed repositories"));
    expect(text.indexOf("## Renamed repositories")).toBeLessThan(text.indexOf("## Resume & career agent"));
    expect(summary).not.toContain("## Renamed repositories");
    expect(buildSummary(catalog, { renamed: [] })).not.toContain("## Renamed repositories");
  });

  it("works when no run information is available", () => {
    expect(buildSummary(catalog, {})).toContain("# Pipeline run 2026-11-11");
  });

  it("marks a security notice and omits the dash when the why is empty", () => {
    const base = catalog.skills[0];
    const custom: Catalog = {
      ...catalog,
      skills: [
        { ...base, review: makeReview({ why: "", security: { level: "notice", notes: ["n"] } }) },
      ],
    };
    const text = buildSummary(custom, {});
    expect(text).toContain("- score 7.8 - security notice");
    expect(text).not.toMatch(/score 7\.8 - \n/);
    expect(text).not.toMatch(/score 7\.8 - $/m);
  });

  it("neutralizes HTML and issue references from the model", () => {
    const custom: Catalog = {
      ...catalog,
      skills: [{ ...catalog.skills[0], review: makeReview({ why: "<!-- hidden --> see foo/bar#1" }) }],
    };
    const text = buildSummary(custom, {});
    expect(text).toContain("&lt;!-- hidden --&gt;");
    expect(text).toContain("foo/bar# 1");
    expect(text).not.toContain("<!--");
  });

  it("cuts a long error reason to 300 characters", () => {
    const long: RunInfo = {
      extract: {
        repos: 1,
        skills: 0,
        invalid: 0,
        failedDownloads: 0,
        truncatedRepos: [],
        failedRepos: [{ repo: "flaky/repo", error: "x".repeat(1000) }],
      },
    };
    const text = buildSummary(catalog, long);
    expect(text).toContain(`- \`flaky/repo\`: ${"x".repeat(300)}\n`);
    expect(text).not.toContain("x".repeat(301));
  });

  it("neutralizes the reason of a filtered repository", () => {
    const text = buildSummary(catalog, { filtered: [{ fullName: "a/b", reason: "ping @octocat <b>" }] });
    expect(text).toContain("- `a/b`: ping (at)octocat &lt;b&gt;");
  });

  it("stays under the pull request body limit and says it was cut", () => {
    // Lists are capped at 30 entries, so long kit titles are what make the text overflow.
    const kits = Array.from({ length: 8 }, (_, index) => ({
      id: `kit-${index}`,
      title: `${"t".repeat(9000)}`,
      description: "d",
      collections: [],
      skills: [],
      removed: Array.from({ length: 40 }, (_, n) => `o/r:${"p".repeat(140)}${index}${String(n).padStart(2, "0")}`),
      pending: [],
      proposals: { collections: [], skills: [] },
    }));
    const text = buildSummary({ ...catalog, kits, skills: [] }, {});
    expect(text.length).toBeLessThan(65536);
    expect(text.endsWith("\n\n_Summary truncated at 60000 characters. The full text is in the workflow run log._\n")).toBe(true);
  });

  it("stays under the limit when no line break precedes it", () => {
    const kit = { ...catalog.kits[0], title: "t".repeat(70_000) };
    const text = buildSummary({ ...catalog, kits: [kit], skills: [] }, {});
    expect(text.length).toBeLessThan(65536);
    expect(text.endsWith("_Summary truncated at 60000 characters. The full text is in the workflow run log._\n")).toBe(true);
  });

  it("escapes parentheses, hash and question mark in link targets", () => {
    const skill = { ...catalog.skills[0], url: "https://github.com/acme/skills/tree/main/skills/a(b)#c?d" };
    const text = buildSummary({ ...catalog, skills: [skill] }, {});
    const line = text.split("\n").find((entry) => entry.includes("](https://")) ?? "";
    const target = line.slice(line.indexOf("](") + 2, line.indexOf(") - score"));
    expect(target).toContain("%28");
    expect(target).toContain("%29");
    expect(target).toContain("%23");
    expect(target).toContain("%3F");
    expect(target).not.toMatch(/[()]/);
  });

  it("gives only the title and the catalog line for an empty catalog", () => {
    const text = buildSummary({ generatedAt: "2026-11-11T00:00:00.000Z", kits: [], skills: [], collections: [] }, {});
    expect(text).toContain("# Pipeline run 2026-11-11");
    expect(text).toContain("Catalog: 0 skills, 0 collections.");
    expect(text).not.toContain("## ");
  });

  it("prints no empty sections and no Run block without information", () => {
    const empty: RunInfo = {
      filtered: [],
      extract: { repos: 0, skills: 0, invalid: 0, failedDownloads: 0, truncatedRepos: [], failedRepos: [] },
      review: { ...(runInfo.review as NonNullable<RunInfo["review"]>), failed: [] },
    };
    const text = buildSummary(catalog, empty);
    expect(text).not.toContain("## Failed reviews");
    expect(text).not.toContain("## Repos that could not be read");
    expect(text).not.toContain("## Repos excluded by the filter");
    expect(buildSummary(catalog, {})).not.toContain("## Run");
  });

  it("caps long lists at 30 lines", () => {
    const kit = { ...catalog.kits[0], removed: Array.from({ length: 31 }, (_, n) => `o/r:s${n}`) };
    const text = buildSummary({ ...catalog, kits: [kit] }, {});
    const lines = text.split("\n").filter((line) => line.startsWith("- `o/r:s"));
    expect(lines).toHaveLength(30);
    expect(text).toContain("- ... and 1 more");
  });
});
