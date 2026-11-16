import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { discover } from "./discover";
import { runExtract } from "./extract";
import { filterRepos } from "./filter";
import { errorMessage } from "./lib/errors";
import type { GitHubClient } from "./lib/github";
import { isLicenseEligible, licenseCacheFile, readLicenseCache } from "./lib/license";
import type { LlmClient } from "./lib/llm";
import {
  CatalogSchema,
  type Config,
  ConfigSchema,
  CurationSchema,
  type Kit,
  KitsSchema,
  RepoMetaSchema,
  type Review,
  ReviewRecordSchema,
  type RunInfo,
  RunInfoSchema,
  type SkillRecord,
  SkillRecordSchema,
  SourcesSchema,
  type TriageCache,
  TriageCacheSchema,
} from "./lib/schemas";
import {
  type Paths,
  readJsonFile,
  readYamlFile,
  resolvePaths,
  writeJsonFile,
  writeTextFile,
} from "./lib/store";
import { compareText } from "./lib/text";
import { buildSummary } from "./publish";
import { buildCatalog } from "./rank";
import { emptyReviewStats, runReviews, runTriage, selectForReview } from "./review";

export const STEPS = ["discover", "filter", "extract", "review", "rank", "summary"] as const;
export type Step = (typeof STEPS)[number];

export interface PipelineOptions {
  root: string;
  dryRun: boolean;
  steps: Step[];
}

export interface PipelineDeps {
  gh: GitHubClient;
  // Created on demand so that rank and summary run without an API key.
  getLlm: (model: string) => LlmClient;
  // Dates written in records.
  now: Date;
  // Measures the time budget of the run; Date.now by default, replaced in tests.
  clock?: () => number;
  log: (message: string) => void;
}

interface StepContext {
  paths: Paths;
  config: Config;
  kits: Kit[];
  options: PipelineOptions;
  deps: PipelineDeps;
  // clock() reading when the run started: the time budget counts from here.
  startedAt: number;
}

// A dry run measures cost and quality on a small sample: it never reviews more than this.
const DRY_RUN_MAX_REVIEWS = 40;

// Review files are named <fingerprint>.json.
const fingerprintOf = (fileName: string): string => fileName.slice(0, -".json".length);

async function listReviewFiles(dir: string): Promise<string[]> {
  try {
    // Temporary files left by an interrupted write end in .tmp and are ignored.
    return (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadReviews(dir: string): Promise<Map<string, Review>> {
  const reviews = new Map<string, Review>();
  for (const name of await listReviewFiles(dir)) {
    const file = path.join(dir, name);
    const record = await readJsonFile(file, ReviewRecordSchema.optional(), undefined);
    // undefined: the file was deleted between listing and reading. A null file fails the schema.
    if (record === undefined) continue;
    if (record.fingerprint !== fingerprintOf(name)) {
      throw new Error(`${file} does not match its fingerprint`);
    }
    reviews.set(record.fingerprint, record.review);
  }
  return reviews;
}

// Only what the model reads: keywords do not reach the prompts.
export function hashKits(kits: Kit[]): string {
  const content = kits
    .map(({ id, title, description }) => ({ id, title, description }))
    .sort((a, b) => compareText(a.id, b.id));
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

async function readOptionalText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// Triage answers and reviews depend on the kit list: a changed list makes them stale.
async function checkKitsHash(
  root: string,
  paths: Paths,
  kits: Kit[],
  triage: TriageCache,
): Promise<void> {
  const current = hashKits(kits);
  const stored = (await readOptionalText(paths.kitsHash))?.trim();
  if (stored === current) return;
  const hasCache =
    Object.keys(triage).length > 0 || (await listReviewFiles(paths.reviewsDir)).length > 0;
  if (stored === undefined && !hasCache) {
    await writeTextFile(paths.kitsHash, `${current}\n`);
    return;
  }
  // Paths of this run, relative to the root: a dry run names its own .dry-run/cache copy.
  const shown = (file: string): string => path.relative(root, file).split(path.sep).join("/");
  throw new Error(
    `kits.yaml changed since the last review: delete ${shown(paths.triage)}, ${shown(paths.reviewsDir)}/ and ${shown(paths.kitsHash)}, then run again`,
  );
}

async function updateRunInfo(file: string, patch: RunInfo): Promise<void> {
  const current = await readJsonFile(file, RunInfoSchema, {});
  await writeJsonFile(file, { ...current, ...patch });
}

const handlers: Record<Step, (context: StepContext) => Promise<void>> = {
  async discover({ paths, config, options, deps }) {
    const sources = await readYamlFile(paths.sources, SourcesSchema);
    const candidates = await discover(deps.gh, sources, config.filter.minStars, options.dryRun);
    await writeJsonFile(paths.candidates, candidates);
    deps.log(`${candidates.length} candidate repos`);
  },

  async filter({ paths, config, deps }) {
    const candidates = await readJsonFile(paths.candidates, z.array(z.string()), []);
    // Repositories listed in sources.yaml are nominations: minStars does not apply to them.
    const sources = await readYamlFile(paths.sources, SourcesSchema);
    const { repos, filtered, renamed } = await filterRepos(
      deps.gh,
      candidates,
      config.filter,
      deps.now,
      new Set(sources.repos),
    );
    await writeJsonFile(paths.repos, repos);
    await updateRunInfo(paths.runInfo, { filtered, renamed });
    deps.log(`${repos.length} repos kept, ${filtered.length} excluded`);
  },

  async extract({ paths, config, deps }) {
    const repos = await readJsonFile(paths.repos, z.array(RepoMetaSchema), []);
    const previous = await readJsonFile(paths.skills, z.array(SkillRecordSchema), []);
    // Entries identified by other rules (or written before rules versions) are dropped.
    const storedLicenses = await readJsonFile(paths.licenses, z.unknown(), undefined);
    const licenseCache = readLicenseCache(storedLicenses);
    // A discarded file is replaced now, so a stale one never stays on disk.
    if (storedLicenses !== undefined && Object.keys(licenseCache).length === 0) {
      await writeJsonFile(paths.licenses, licenseCacheFile(licenseCache));
    }
    const { skills, stats } = await runExtract(
      deps.gh,
      repos,
      previous,
      (progress) => writeJsonFile(paths.skills, progress),
      {
        cache: licenseCache,
        save: (cache) => writeJsonFile(paths.licenses, licenseCacheFile(cache)),
        allowed: config.filter.allowedLicenses,
      },
    );
    await writeJsonFile(paths.skills, skills);
    await updateRunInfo(paths.runInfo, { extract: stats });
    deps.log(`${stats.skills} skills, ${stats.invalid} invalid, ${stats.failedRepos.length} repos failed`);
  },

  async review({ paths, config, kits, options, deps, startedAt }) {
    const repos = await readJsonFile(paths.repos, z.array(RepoMetaSchema), []);
    const skills = await readJsonFile(paths.skills, z.array(SkillRecordSchema), []);
    const triage = await readJsonFile(paths.triage, TriageCacheSchema, {});
    await checkKitsHash(options.root, paths, kits, triage);
    const curation = await readYamlFile(paths.curation, CurationSchema);
    // Approved skills are re-reviewed first, even when triage no longer proposes a kit for them.
    const priorityIds = new Set(Object.values(curation).flatMap((entry) => entry.approved));
    // A skill whose license keeps it out of the catalog is neither triaged nor reviewed.
    const isEligible = (skill: SkillRecord): boolean =>
      isLicenseEligible(skill.license, config.filter.allowedLicenses);
    const llm = deps.getLlm(config.review.model);
    const stats = emptyReviewStats();
    const clock = deps.clock ?? Date.now;
    const end = startedAt + config.review.maxMinutes * 60_000;
    const deadline = (): boolean => clock() >= end;

    let completed = false;
    try {
      const nextTriage = await runTriage(
        llm,
        skills.filter(isEligible),
        triage,
        kits,
        config.review.triageBatchSize,
        stats,
        (cache) => writeJsonFile(paths.triage, cache),
        deadline,
      );
      await writeJsonFile(paths.triage, nextTriage);

      const reviewed = new Set((await listReviewFiles(paths.reviewsDir)).map(fingerprintOf));
      const max = options.dryRun
        ? Math.min(config.review.maxReviewsPerRun, DRY_RUN_MAX_REVIEWS)
        : config.review.maxReviewsPerRun;
      const { selected, deferred } = selectForReview(
        skills,
        nextTriage,
        reviewed,
        repos,
        max,
        priorityIds,
        isEligible,
      );
      stats.deferred = deferred;

      await runReviews(
        {
          llm,
          gh: deps.gh,
          kits,
          repos,
          skills,
          settings: config.review,
          now: deps.now,
          saveReview: (record) =>
            writeJsonFile(path.join(paths.reviewsDir, `${record.fingerprint}.json`), record),
        },
        selected,
        stats,
        deadline,
      );
      completed = true;
    } finally {
      // Written even when a fatal error stops the run: the reviews already paid for stay counted.
      try {
        await updateRunInfo(paths.runInfo, { review: stats });
      } catch (error) {
        if (completed) throw error;
        // Never let this hide the error that stopped the review.
        console.error(`Could not save the review statistics: ${errorMessage(error)}`);
      }
    }
    deps.log(`${stats.reviewed} reviewed, ${stats.failed.length} failed, ${stats.deferred} deferred`);
  },

  async rank({ paths, config, kits, deps }) {
    const repos = await readJsonFile(paths.repos, z.array(RepoMetaSchema), []);
    const skills = await readJsonFile(paths.skills, z.array(SkillRecordSchema), []);
    const reviews = await loadReviews(paths.reviewsDir);
    const curation = await readYamlFile(paths.curation, CurationSchema);
    const catalog = CatalogSchema.parse(
      buildCatalog({ repos, skills, reviews, kits, curation, config, now: deps.now }),
    );
    await writeJsonFile(paths.catalog, catalog);
    deps.log(`catalog: ${catalog.skills.length} skills, ${catalog.collections.length} collections`);
  },

  async summary({ paths, deps }) {
    const catalog = await readJsonFile(paths.catalog, CatalogSchema.optional(), undefined);
    if (catalog === undefined) throw new Error(`${paths.catalog} is missing: run the rank step first`);
    const runInfo = await readJsonFile(paths.runInfo, RunInfoSchema, {});
    await mkdir(path.dirname(paths.summary), { recursive: true });
    await writeFile(paths.summary, buildSummary(catalog, runInfo), "utf8");
    deps.log(`summary written to ${paths.summary}`);
  },
};

export async function runPipeline(options: PipelineOptions, deps: PipelineDeps): Promise<void> {
  const startedAt = (deps.clock ?? Date.now)();
  const paths = resolvePaths(options.root, options.dryRun);
  const config = await readYamlFile(paths.config, ConfigSchema);
  const kits = await readYamlFile(paths.kits, KitsSchema);
  // A fresh run starts from empty run information; partial runs keep the last one.
  if (options.steps.includes("discover")) await writeJsonFile(paths.runInfo, {});
  for (const step of STEPS) {
    if (!options.steps.includes(step)) continue;
    deps.log(`> ${step}`);
    await handlers[step]({ paths, config, kits, options, deps, startedAt });
  }
}
