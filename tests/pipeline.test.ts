import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CatalogSchema,
  RunInfoSchema,
  SkillRecordSchema,
  type Catalog,
  type RunInfo,
} from "../pipeline/lib/schemas";
import { FatalLlmError } from "../pipeline/lib/errors";
import { STEPS, loadReviews, runPipeline } from "../pipeline/run";
import { FakeGitHub, FakeLlm, type FakeRepo, blobIdOf } from "./fakes";
import { NOW, makeRepo, makeReview, skillMd } from "./fixtures";
import { MIT_TEXT } from "./license-texts";
import { LICENSE_RULES_VERSION } from "../pipeline/lib/license";

const blobOf = blobIdOf;

const recent = "2026-11-05T00:00:00Z";

const atsId = "acme/career-skills:skills/ats-check";

function makeGitHub(
  options: {
    atsBody?: string;
    redirects?: Record<string, string>;
    careerLicense?: string | null;
    careerArchived?: boolean;
    extraRepos?: FakeRepo[];
  } = {},
): FakeGitHub {
  const {
    atsBody = "Do the thing.",
    redirects = {},
    careerLicense = "MIT",
    careerArchived = false,
    extraRepos = [],
  } = options;
  return new FakeGitHub([
    ...extraRepos,
    {
      meta: makeRepo({ fullName: "acme/career-skills", url: "https://github.com/acme/career-skills", stars: 2000, forks: 200, pushedAt: recent, license: careerLicense, archived: careerArchived }),
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
  ], {}, redirects);
}

function makeLlm(
  options: { noKitFor?: string; failReviewAt?: number; invalidFor?: string } = {},
): FakeLlm {
  let reviewCount = 0;
  const careerSkills = new Set([
    "resume-tailor",
    "ats-check",
    "cover-letter",
    "flaky",
    "exfil",
    "salary-coach",
    "negotiation",
  ]);
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
      if (input.name === "flaky" || input.name === options.invalidFor) return { nonsense: true };
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
  let clock: (() => number) | undefined;
  const run = (steps = [...STEPS]) =>
    runPipeline(
      { root, dryRun: false, steps },
      { gh, getLlm: () => llm, now: NOW, clock, log: () => {} },
    );

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    root = await makeRoot();
    gh = makeGitHub();
    llm = makeLlm();
    clock = undefined;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("builds the catalog from discovery to summary", async () => {
    await run();
    const catalog = await readCatalog(root);
    const runInfo = await readRunInfo(root);

    // A repository is no longer filtered for its license: nolicense/skills is read.
    expect(runInfo.filtered).toEqual([
      { fullName: "ghost/deleted", reason: "not found" },
      { fullName: "old/archived-skills", reason: "archived" },
    ]);
    expect(runInfo.extract).toMatchObject({ repos: 4, skills: 7, invalid: 1 });
    // The skill of nolicense/skills has no license evidence: it is not triaged.
    expect(runInfo.extract?.licenses).toEqual({
      identifiedAllowed: 6,
      identifiedNotAllowed: 0,
      custom: 0,
      ambiguous: 0,
      missing: 1,
      notReRead: 0,
      waitingForSafetyScan: 1,
      unresolved: 0,
      failedDownloads: 0,
    });
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
    // No safety scan yet: the unlicensed skill of nolicense/skills stays out, as before.
    expect(catalog.skills.map((skill) => [skill.license, skill.licenseOutcome, skill.licenseCategory])).toEqual([
      ["MIT", "identified", "permissive"],
      ["MIT", "identified", "permissive"],
      ["MIT", "identified", "permissive"],
    ]);
    expect(catalog.collections[0]).toMatchObject({ license: "MIT", licenses: ["MIT"] });
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
    gh = makeGitHub({ atsBody: "Do the thing, version two." });
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

  it("rejects a review file containing null", async () => {
    await run();
    const dir = path.join(root, "data", "cache", "reviews");
    await writeFile(path.join(dir, `${"c".repeat(40)}.json`), "null");
    await expect(loadReviews(dir)).rejects.toThrow(/c{40}\.json/);
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

  it("stops reviewing at the time budget and still writes the catalog and the summary", async () => {
    // The clock reads 0 when the run starts, then jumps past review.maxMinutes after one review.
    clock = () => (llm.reviewCalls.length >= 1 ? 141 * 60_000 : 0);
    await run();
    const runInfo = await readRunInfo(root);
    expect(runInfo.review).toMatchObject({ triaged: 6, reviewed: 1, deferred: 4, stoppedByTimeBudget: true });
    expect(llm.reviewCalls).toHaveLength(1);
    const catalog = await readCatalog(root);
    expect(catalog.skills.map((skill) => skill.name)).toEqual(["ats-check"]);
    const summary = await readFile(path.join(root, "pipeline-summary.md"), "utf8");
    expect(summary).toContain(
      "- Stopped by the time budget (review.maxMinutes): the rest is deferred to the next run",
    );
  });

  const kitsChanged =
    "kits.yaml changed since the last review: delete data/cache/triage.json, data/cache/reviews/ and data/cache/kits.sha256, then run again";

  async function editFirstKitDescription(): Promise<void> {
    const file = path.join(root, "data", "kits.yaml");
    const text = await readFile(file, "utf8");
    const edited = text.replace(/description: "[^"]*"/, 'description: "Something else entirely."');
    expect(edited).not.toBe(text);
    await writeFile(file, edited);
  }

  it("records the hash of the kits on the first review", async () => {
    await run();
    const hash = await readFile(path.join(root, "data", "cache", "kits.sha256"), "utf8");
    expect(hash).toMatch(/^[0-9a-f]{64}\n$/);
    await run(["review"]);
  });

  it("refuses to review after a kit changed, but still ranks", async () => {
    await run();
    await editFirstKitDescription();
    const reviewCalls = llm.reviewCalls.length;
    await expect(run(["review"])).rejects.toThrow(kitsChanged);
    expect(llm.reviewCalls.length).toBe(reviewCalls);
    await run(["rank", "summary"]);
    expect((await readCatalog(root)).skills.length).toBeGreaterThan(0);
  });

  it("refuses to review when a triage cache exists without a kits hash", async () => {
    await mkdir(path.join(root, "data", "cache"), { recursive: true });
    await writeFile(
      path.join(root, "data", "cache", "triage.json"),
      JSON.stringify({ ["a".repeat(40)]: [] }),
    );
    await expect(run()).rejects.toThrow(kitsChanged);
    expect(llm.triageCalls).toHaveLength(0);
  });

  it("reports a seed repository that now answers under another name", async () => {
    const sourcesFile = path.join(root, "data", "sources.yaml");
    const sources = await readFile(sourcesFile, "utf8");
    await writeFile(sourcesFile, sources.replace("  - acme/career-skills\n", "  - acme/old-career-skills\n"));
    gh = makeGitHub({ redirects: { "acme/old-career-skills": "acme/career-skills" } });
    await run();
    const runInfo = await readRunInfo(root);
    expect(runInfo.renamed).toEqual([{ from: "acme/old-career-skills", to: "acme/career-skills" }]);
    const summary = await readFile(path.join(root, "pipeline-summary.md"), "utf8");
    expect(summary).toContain("## Renamed repositories");
    expect(summary).toContain("- `acme/old-career-skills` -> `acme/career-skills`");
    expect(summary).toContain("Update data/sources.yaml and the ids in data/curation.yaml.");
  });

  async function approveAts(): Promise<void> {
    await writeFile(
      path.join(root, "data", "curation.yaml"),
      ["resume-career:", `  approved: ['${atsId}']`, "  rejected: []", ""].join("\n"),
    );
  }

  it("removes an approved skill whose repository is no longer listed", async () => {
    await run();
    await approveAts();
    gh = makeGitHub({ careerArchived: true });
    await run();
    const resume = (await readCatalog(root)).kits.find((kit) => kit.id === "resume-career");
    expect(resume?.removed).toEqual([{ id: atsId, reason: "repository no longer listed" }]);
    expect(resume?.skills).toEqual([]);
    const summary = await readFile(path.join(root, "pipeline-summary.md"), "utf8");
    expect(summary).toContain(`- \`${atsId}\` - repository no longer listed`);
  });

  it("keeps an approved skill whose license is now missing pending for the safety scan, without reviewing it", async () => {
    await run();
    await approveAts();
    gh = makeGitHub({ careerLicense: null, atsBody: "Do the thing, version two." });
    const reviewCalls = llm.reviewCalls.length;
    await run();
    const resume = (await readCatalog(root)).kits.find((kit) => kit.id === "resume-career");
    expect(resume?.pending).toEqual([atsId]);
    expect(resume?.pendingReasons).toEqual({ [atsId]: "waiting for the safety scan" });
    expect(resume?.removed).toEqual([]);
    expect(resume?.skills).toEqual([]);
    // The changed approved skill is not reviewed: only the failed flaky skill is tried again.
    expect(llm.reviewCalls.slice(reviewCalls).map((call) => call.name)).toEqual(["flaky", "flaky"]);
    const summary = await readFile(path.join(root, "pipeline-summary.md"), "utf8");
    expect(summary).toContain(`- \`${atsId}\` - waiting for the safety scan`);
    expect(summary).toMatch(/- Licenses: .* 5 waiting for the safety scan,/);
  });

  function splitRepo(): FakeRepo {
    return {
      meta: makeRepo({
        fullName: "split/skills",
        url: "https://github.com/split/skills",
        license: null,
        stars: 3,
        forks: 0,
        pushedAt: recent,
      }),
      files: {
        "skills/salary-coach/SKILL.md": skillMd("salary-coach", "Prepares a salary negotiation."),
        "skills/salary-coach/LICENSE": MIT_TEXT,
        "skills/negotiation/SKILL.md": skillMd("negotiation", "Negotiates an offer."),
      },
    };
  }

  async function nominateSplit(): Promise<void> {
    gh = makeGitHub({ extraRepos: [splitRepo()] });
    const sourcesFile = path.join(root, "data", "sources.yaml");
    const sources = await readFile(sourcesFile, "utf8");
    // A nominated repository with 3 stars: kept despite minStars.
    await writeFile(sourcesFile, sources.replace("repos:\n", "repos:\n  - split/skills\n"));
  }

  const licensesFile = (): string => path.join(root, "data", "cache", "licenses.json");

  it("publishes the one skill whose folder has an MIT license from a repository with no GitHub license", async () => {
    await nominateSplit();
    await run();

    const skills = z
      .array(SkillRecordSchema)
      .parse(JSON.parse(await readFile(path.join(root, "data", "cache", "skills.json"), "utf8")));
    const splitSkills = skills.filter((skill) => skill.repo === "split/skills");
    expect(
      splitSkills.map((skill) => [
        skill.name,
        skill.license?.outcome,
        skill.license?.outcome === "identified" ? skill.license.spdx : undefined,
      ]),
    ).toEqual([
      ["negotiation", "missing", undefined],
      ["salary-coach", "identified", "MIT"],
    ]);

    const catalog = await readCatalog(root);
    const listed = catalog.skills.filter((skill) => skill.repo === "split/skills");
    expect(listed.map((skill) => skill.name)).toEqual(["salary-coach"]);
    expect(listed[0]).toMatchObject({
      license: "MIT",
      licenseEvidence: {
        level: "skill",
        path: "skills/salary-coach/LICENSE",
        url: "https://github.com/split/skills/blob/main/skills/salary-coach/LICENSE",
      },
    });
    // No triage and no review is spent on the skill that cannot be published.
    expect(llm.triageCalls.flat().map((item) => item.name)).not.toContain("negotiation");
    expect(llm.reviewCalls.map((call) => call.name)).not.toContain("negotiation");
    expect(catalog.collections.map((collection) => collection.id)).not.toContain("split/skills");

    const licenseCache = JSON.parse(await readFile(licensesFile(), "utf8"));
    expect(licenseCache).toEqual({
      rulesVersion: LICENSE_RULES_VERSION,
      entries: { [blobOf(MIT_TEXT)]: { kind: "spdx", spdx: "MIT" } },
    });
  });

  it.each([
    ["written by other identification rules", { rulesVersion: LICENSE_RULES_VERSION + 1, entries: {} }],
    ["in the shape written before rules versions", {}],
  ])("identifies every license text again when the cache was %s", async (_label, shape) => {
    await nominateSplit();
    await mkdir(path.dirname(licensesFile()), { recursive: true });
    // A stale answer for the MIT text: it must not be used.
    const stale = { [blobOf(MIT_TEXT)]: { spdx: null } };
    const file = "entries" in shape ? { ...shape, entries: stale } : stale;
    await writeFile(licensesFile(), JSON.stringify(file));
    await run();
    expect(gh.fileReads).toContain("split/skills/skills/salary-coach/LICENSE");
    const catalog = await readCatalog(root);
    expect(catalog.skills.map((skill) => skill.name)).toContain("salary-coach");
    expect(JSON.parse(await readFile(licensesFile(), "utf8"))).toEqual({
      rulesVersion: LICENSE_RULES_VERSION,
      entries: { [blobOf(MIT_TEXT)]: { kind: "spdx", spdx: "MIT" } },
    });
  });

  it("replaces a discarded cache file even when no license text is downloaded", async () => {
    await mkdir(path.dirname(licensesFile()), { recursive: true });
    await writeFile(licensesFile(), JSON.stringify({ ["a".repeat(40)]: { spdx: "MIT" } }));
    await run();
    expect(JSON.parse(await readFile(licensesFile(), "utf8"))).toEqual({
      rulesVersion: LICENSE_RULES_VERSION,
      entries: {},
    });
  });

  it("does not download a license text again with a cache of the current rules", async () => {
    await nominateSplit();
    await run();
    gh = makeGitHub({ extraRepos: [splitRepo()] });
    await run(["extract"]);
    expect(gh.fileReads).not.toContain("split/skills/skills/salary-coach/LICENSE");
  });

  it("lists no collection for a repository whose tree listing was truncated", async () => {
    // Three skills, each with its own MIT license: eligible even in a truncated listing.
    const licensed: FakeRepo = {
      meta: makeRepo({ fullName: "big/skills", url: "https://github.com/big/skills", license: null, pushedAt: recent }),
      files: Object.fromEntries(
        ["resume-tailor", "ats-check", "cover-letter"].flatMap((name) => [
          [`skills/${name}/SKILL.md`, skillMd(name, `Does ${name}.`)],
          [`skills/${name}/LICENSE`, MIT_TEXT],
        ]),
      ),
    };
    gh = makeGitHub({ extraRepos: [licensed] });
    const sourcesFile = path.join(root, "data", "sources.yaml");
    const sources = await readFile(sourcesFile, "utf8");
    await writeFile(sourcesFile, sources.replace("repos:\n", "repos:\n  - big/skills\n"));
    await run();
    expect((await readCatalog(root)).collections.map((collection) => collection.id)).toContain("big/skills");

    gh.truncateTreeFor.add("big/skills");
    await run();
    const catalog = await readCatalog(root);
    expect(catalog.skills.filter((skill) => skill.repo === "big/skills")).toHaveLength(3);
    expect(catalog.collections.map((collection) => collection.id)).not.toContain("big/skills");
    // rank run alone reads the truncated repositories from the run information.
    await run(["rank"]);
    expect((await readCatalog(root)).collections.map((collection) => collection.id)).not.toContain("big/skills");
  });

  it("keeps a changed approved skill pending when its review fails", async () => {
    await run();
    await approveAts();
    gh = makeGitHub({ atsBody: "Do the thing, version two." });
    llm = makeLlm({ invalidFor: "ats-check" });
    await run();
    const resume = (await readCatalog(root)).kits.find((kit) => kit.id === "resume-career");
    expect(resume?.pending).toEqual([atsId]);
    expect(resume?.removed).toEqual([]);
    expect((await readRunInfo(root)).review?.failed.map((entry) => entry.skillId)).toContain(atsId);
    const summary = await readFile(path.join(root, "pipeline-summary.md"), "utf8");
    expect(summary).toContain(
      `**Approved entries pending (hidden until ready):**\n\n- \`${atsId}\` - awaiting re-review\n`,
    );
  });

  it("names catalog.json when the summary step cannot read it", async () => {
    await run();
    await writeFile(path.join(root, "catalog.json"), "{ not json");
    await expect(run(["summary"])).rejects.toThrow(/catalog\.json/);
  });

  it("counts the time budget from the start of the run", async () => {
    await approveAts();
    await run();
    const reviewCalls = llm.reviewCalls.length;
    gh = makeGitHub({ atsBody: "Do the thing, version two." });
    // The budget is spent while extract downloads the changed SKILL.md, before the review step.
    clock = () => (gh.fileReads.length > 0 ? 141 * 60_000 : 0);
    await run();
    expect(llm.reviewCalls.length).toBe(reviewCalls);
    const runInfo = await readRunInfo(root);
    // The changed approved skill and the skill whose review failed last run both wait.
    expect(runInfo.review).toMatchObject({
      reviewed: 0,
      deferred: 2,
      triageMissing: 1,
      stoppedByTimeBudget: true,
    });
    const resume = (await readCatalog(root)).kits.find((kit) => kit.id === "resume-career");
    expect(resume?.pending).toEqual([atsId]);
    const summary = await readFile(path.join(root, "pipeline-summary.md"), "utf8");
    expect(summary).toContain("- Stopped by the time budget (review.maxMinutes)");
  });

  it("accepts a cache restored from a failure artifact and reviews nothing twice", async () => {
    await run();
    const reviewCalls = llm.reviewCalls.length;
    const restored = await makeRoot();
    try {
      // What the recovery steps copy: reviews/, triage.json and kits.sha256, nothing else.
      const from = path.join(root, "data", "cache");
      const to = path.join(restored, "data", "cache");
      await cp(path.join(from, "reviews"), path.join(to, "reviews"), { recursive: true });
      await cp(path.join(from, "triage.json"), path.join(to, "triage.json"));
      await cp(path.join(from, "kits.sha256"), path.join(to, "kits.sha256"));
      await runPipeline(
        { root: restored, dryRun: false, steps: [...STEPS] },
        { gh, getLlm: () => llm, now: NOW, log: () => {} },
      );
      // Only the skill whose review failed is tried again: two attempts.
      expect(llm.reviewCalls.length).toBe(reviewCalls + 2);
      expect((await readCatalog(restored)).skills.length).toBe(3);
    } finally {
      await rm(restored, { recursive: true, force: true });
    }
  });

  it("names the cache files of a dry run when the kits changed", async () => {
    const cache = path.join(root, ".dry-run", "cache");
    await mkdir(cache, { recursive: true });
    await writeFile(path.join(cache, "triage.json"), JSON.stringify({ ["a".repeat(40)]: [] }));
    await expect(
      runPipeline(
        { root, dryRun: true, steps: ["review"] },
        { gh, getLlm: () => llm, now: NOW, log: () => {} },
      ),
    ).rejects.toThrow(
      "kits.yaml changed since the last review: delete .dry-run/cache/triage.json, .dry-run/cache/reviews/ and .dry-run/cache/kits.sha256, then run again",
    );
  });
});
