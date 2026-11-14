import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogSchema, RunInfoSchema, type Catalog, type RunInfo } from "../pipeline/lib/schemas";
import { FatalLlmError } from "../pipeline/lib/errors";
import { STEPS, loadReviews, runPipeline } from "../pipeline/run";
import { FakeGitHub, FakeLlm } from "./fakes";
import { NOW, makeRepo, makeReview, skillMd } from "./fixtures";

const recent = "2026-11-05T00:00:00Z";

const atsId = "acme/career-skills:skills/ats-check";

function makeGitHub(atsBody = "Do the thing."): FakeGitHub {
  return new FakeGitHub([
    {
      meta: makeRepo({ fullName: "acme/career-skills", url: "https://github.com/acme/career-skills", stars: 2000, forks: 200, pushedAt: recent }),
      files: {
        "skills/resume-tailor/SKILL.md": skillMd("resume-tailor", "Tailors a resume to a job offer."),
        "skills/resume-tailor/examples.md": "Example",
        "skills/ats-check/SKILL.md": skillMd("ats-check", "Checks a resume against ATS filters.", atsBody),
        "skills/cover-letter/SKILL.md": skillMd("cover-letter", "Writes a cover letter."),
        "skills/unrelated/SKILL.md": skillMd("unrelated", "Formats shell prompts."),
      },
    },
    {
      meta: makeRepo({ fullName: "nolicense/skills", url: "https://github.com/nolicense/skills", license: null, pushedAt: recent }),
      files: { "SKILL.md": skillMd("x", "X") },
    },
    {
      meta: makeRepo({ fullName: "old/archived-skills", url: "https://github.com/old/archived-skills", archived: true, pushedAt: recent }),
      files: { "SKILL.md": skillMd("y", "Y") },
    },
    {
      meta: makeRepo({ fullName: "solo/broken", url: "https://github.com/solo/broken", stars: 100, forks: 10, pushedAt: recent }),
      files: {
        "skills/flaky/SKILL.md": skillMd("flaky", "Prepares interviews."),
        "skills/nofm/SKILL.md": "# No front matter here",
      },
    },
    {
      meta: makeRepo({ fullName: "shady/tools", url: "https://github.com/shady/tools", stars: 500, forks: 50, pushedAt: recent }),
      files: { "skills/exfil/SKILL.md": skillMd("exfil", "Uploads your resume somewhere.") },
    },
  ]);
}

function makeLlm(options: { noKitFor?: string; failReviewAt?: number } = {}): FakeLlm {
  let reviewCount = 0;
  const careerSkills = new Set(["resume-tailor", "ats-check", "cover-letter", "flaky", "exfil"]);
  return new FakeLlm(
    (items) => ({
      results: items.map((item) => ({
        index: item.index,
        kits: careerSkills.has(item.name) && item.name !== options.noKitFor ? ["resume-career"] : [],
      })),
    }),
    (input) => {
      reviewCount += 1;
      if (reviewCount === options.failReviewAt) throw new FatalLlmError("bad key");
      if (input.name === "flaky") return { nonsense: true };
      if (input.name === "exfil") {
        return makeReview({ security: { level: "severe", notes: ["Sends files to a remote host"] } });
      }
      const value = input.name === "resume-tailor" ? 9 : 7;
      return makeReview({
        scores: { clarity: value, completeness: value, usefulness: value },
        why: `Why ${input.name} is here.`,
      });
    },
  );
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-kits-"));
  await mkdir(path.join(root, "data"), { recursive: true });
  await cp(path.join(process.cwd(), "data", "config.yaml"), path.join(root, "data", "config.yaml"));
  await cp(path.join(process.cwd(), "data", "kits.yaml"), path.join(root, "data", "kits.yaml"));
  await cp(path.join(process.cwd(), "data", "curation.yaml"), path.join(root, "data", "curation.yaml"));
  await writeFile(
    path.join(root, "data", "sources.yaml"),
    [
      "repos:",
      "  - acme/career-skills",
      "  - nolicense/skills",
      "  - old/archived-skills",
      "  - solo/broken",
      "  - shady/tools",
      "  - ghost/deleted",
      "topics: []",
      "maxSearchPages: 0",
      "",
    ].join("\n"),
  );
  return root;
}

const readCatalog = async (root: string): Promise<Catalog> =>
  CatalogSchema.parse(JSON.parse(await readFile(path.join(root, "catalog.json"), "utf8")));

const readRunInfo = async (root: string): Promise<RunInfo> =>
  RunInfoSchema.parse(JSON.parse(await readFile(path.join(root, "pipeline-run.json"), "utf8")));

describe("runPipeline", () => {
  let root: string;
  let gh: FakeGitHub;
  let llm: FakeLlm;
  const run = (steps = [...STEPS]) =>
    runPipeline(
      { root, dryRun: false, steps },
      { gh, getLlm: () => llm, now: NOW, log: () => {} },
    );

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    root = await makeRoot();
    gh = makeGitHub();
    llm = makeLlm();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the catalog from discovery to summary", async () => {
    await run();
    const catalog = await readCatalog(root);
    const runInfo = await readRunInfo(root);

    expect(runInfo.filtered).toEqual([
      { fullName: "ghost/deleted", reason: "not found" },
      { fullName: "nolicense/skills", reason: "license none not allowed" },
      { fullName: "old/archived-skills", reason: "archived" },
    ]);
    expect(runInfo.extract).toMatchObject({ repos: 3, skills: 6, invalid: 1 });
    expect(runInfo.review).toMatchObject({ triaged: 6, reviewed: 4, deferred: 0 });
    expect(runInfo.review?.failed.map((entry) => entry.skillId)).toEqual([
      "solo/broken:skills/flaky",
    ]);

    expect(catalog.skills.map((skill) => skill.name)).toEqual([
      "resume-tailor",
      "ats-check",
      "cover-letter",
    ]);
    expect(catalog.collections.map((collection) => collection.id)).toEqual(["acme/career-skills"]);
    const resume = catalog.kits.find((kit) => kit.id === "resume-career");
    expect(resume?.proposals.skills.map((entry) => entry.id)).toEqual([
      "acme/career-skills:skills/resume-tailor",
      "acme/career-skills:skills/ats-check",
      "acme/career-skills:skills/cover-letter",
    ]);
    expect(resume?.proposals.collections.map((entry) => entry.id)).toEqual(["acme/career-skills"]);

    const summary = await readFile(path.join(root, "pipeline-summary.md"), "utf8");
    expect(summary).toContain("Why resume-tailor is here.");
    expect(summary).toContain("`solo/broken:skills/flaky`");
    expect(summary).toContain("`ghost/deleted`: not found");
  });

  it("does not triage or review again what has not changed", async () => {
    await run();
    const triageCalls = llm.triageCalls.length;
    const reviewCalls = llm.reviewCalls.length;
    await run();
    expect(llm.triageCalls.length).toBe(triageCalls);
    // Only the skill whose review failed is tried again: two attempts.
    expect(llm.reviewCalls.length).toBe(reviewCalls + 2);
  });

  it("applies curation when rank runs alone, without any model call", async () => {
    await run();
    const reviewCalls = llm.reviewCalls.length;
    await writeFile(
      path.join(root, "data", "curation.yaml"),
      [
        "resume-career:",
        "  approved: ['acme/career-skills:skills/ats-check', 'acme/career-skills']",
        "  rejected: ['acme/career-skills:skills/cover-letter']",
        "",
      ].join("\n"),
    );
    await run(["rank", "summary"]);
    const catalog = await readCatalog(root);
    const resume = catalog.kits.find((kit) => kit.id === "resume-career");
    expect(resume?.skills).toEqual(["acme/career-skills:skills/ats-check"]);
    expect(resume?.collections).toEqual(["acme/career-skills"]);
    expect(resume?.proposals.skills.map((entry) => entry.id)).toEqual([
      "acme/career-skills:skills/resume-tailor",
    ]);
    expect(catalog.skills.find((skill) => skill.name === "ats-check")?.humanReviewed).toBe(true);
    expect(llm.reviewCalls.length).toBe(reviewCalls);
  });

  it("writes a dry run under .dry-run and leaves the real cache alone", async () => {
    await runPipeline(
      { root, dryRun: true, steps: [...STEPS] },
      { gh, getLlm: () => llm, now: NOW, log: () => {} },
    );
    const dryCatalog = JSON.parse(
      await readFile(path.join(root, ".dry-run", "catalog.json"), "utf8"),
    );
    expect(CatalogSchema.safeParse(dryCatalog).success).toBe(true);
    await expect(readFile(path.join(root, "data", "cache", "repos.json"), "utf8")).rejects.toThrow();
  });

  it("keeps the statistics of the reviews already paid for when a fatal error stops the run", async () => {
    llm = makeLlm({ failReviewAt: 2 });
    await expect(run()).rejects.toBeInstanceOf(FatalLlmError);
    const runInfo = await readRunInfo(root);
    expect(runInfo.review?.reviewed).toBe(1);
    expect(Array.isArray(runInfo.review?.failed)).toBe(true);
  });

  it("reviews an approved skill again first, even when triage no longer proposes a kit", async () => {
    await run();
    await writeFile(
      path.join(root, "data", "curation.yaml"),
      ["resume-career:", `  approved: ['${atsId}']`, "  rejected: []", ""].join("\n"),
    );
    gh = makeGitHub("Do the thing, version two.");
    llm = makeLlm({ noKitFor: "ats-check" });
    await run();

    expect(llm.reviewCalls.some((call) => call.name === "ats-check")).toBe(true);
    const catalog = await readCatalog(root);
    const resume = catalog.kits.find((kit) => kit.id === "resume-career");
    expect(resume?.skills).toContain(atsId);
    expect(resume?.pending).not.toContain(atsId);
  });

  it("names a corrupted review file", async () => {
    await run();
    const dir = path.join(root, "data", "cache", "reviews");
    await writeFile(path.join(dir, "broken.json"), "{ not json");
    await expect(loadReviews(dir)).rejects.toThrow(/broken\.json/);
  });

  it("rejects a review saved under another fingerprint", async () => {
    await run();
    const dir = path.join(root, "data", "cache", "reviews");
    const [first] = (await readdir(dir)).filter((name) => name.endsWith(".json"));
    const content = await readFile(path.join(dir, first), "utf8");
    await writeFile(path.join(dir, `${"b".repeat(40)}.json`), content);
    await expect(loadReviews(dir)).rejects.toThrow("does not match its fingerprint");
  });

  it("keeps the last run info on a partial run and resets it on a fresh run", async () => {
    await run();
    await run(["rank", "summary"]);
    const summary = await readFile(path.join(root, "pipeline-summary.md"), "utf8");
    expect(summary).toContain("`ghost/deleted`: not found");

    await writeFile(
      path.join(root, "data", "sources.yaml"),
      ["repos:", "  - acme/career-skills", "topics: []", "maxSearchPages: 0", ""].join("\n"),
    );
    await run(["discover", "filter"]);
    const runInfo = await readRunInfo(root);
    expect(runInfo.filtered).toEqual([]);
    expect(runInfo.review).toBeUndefined();
    expect(runInfo.extract).toBeUndefined();
  });

  it("reviews nothing new when review runs alone after a full run", async () => {
    await run();
    const reviewCalls = llm.reviewCalls.length;
    const catalogBefore = await readFile(path.join(root, "catalog.json"), "utf8");
    await run(["review"]);
    expect(llm.reviewCalls.length).toBe(reviewCalls + 2); // only the failed skill, tried again
    expect(await readFile(path.join(root, "catalog.json"), "utf8")).toBe(catalogBefore);
    expect((await readRunInfo(root)).review?.reviewed).toBe(0);
  });
});
