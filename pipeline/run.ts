import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { discover } from "./discover";
import { runExtract } from "./extract";
import { filterRepos } from "./filter";
import type { GitHubClient } from "./lib/github";
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
  SkillRecordSchema,
  SourcesSchema,
  TriageCacheSchema,
} from "./lib/schemas";
import { type Paths, readJsonFile, readYamlFile, resolvePaths, writeJsonFile } from "./lib/store";
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
  now: Date;
  log: (message: string) => void;
}

interface StepContext {
  paths: Paths;
  config: Config;
  kits: Kit[];
  options: PipelineOptions;
  deps: PipelineDeps;
}

// A dry run measures cost and quality on a small sample: it never reviews more than this.
const DRY_RUN_MAX_REVIEWS = 40;

export async function loadReviews(dir: string): Promise<Map<string, Review>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const reviews = new Map<string, Review>();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    const parsed = ReviewRecordSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    if (!parsed.success) throw new Error(`${file} is invalid: ${parsed.error.message}`);
    reviews.set(parsed.data.fingerprint, parsed.data.review);
  }
  return reviews;
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
    const { repos, filtered } = await filterRepos(deps.gh, candidates, config.filter, deps.now);
    await writeJsonFile(paths.repos, repos);
    await updateRunInfo(paths.runInfo, { filtered });
    deps.log(`${repos.length} repos kept, ${filtered.length} excluded`);
  },

  async extract({ paths, deps }) {
    const repos = await readJsonFile(paths.repos, z.array(RepoMetaSchema), []);
    const previous = await readJsonFile(paths.skills, z.array(SkillRecordSchema), []);
    const { skills, stats } = await runExtract(deps.gh, repos, previous, (progress) =>
      writeJsonFile(paths.skills, progress),
    );
    await writeJsonFile(paths.skills, skills);
    await updateRunInfo(paths.runInfo, { extract: stats });
    deps.log(`${stats.skills} skills, ${stats.invalid} invalid, ${stats.failedRepos.length} repos failed`);
  },

  async review({ paths, config, kits, options, deps }) {
    const repos = await readJsonFile(paths.repos, z.array(RepoMetaSchema), []);
    const skills = await readJsonFile(paths.skills, z.array(SkillRecordSchema), []);
    const triage = await readJsonFile(paths.triage, TriageCacheSchema, {});
    const curation = await readYamlFile(paths.curation, CurationSchema);
    // Approved skills are re-reviewed first, even when triage no longer proposes a kit for them.
    const priorityIds = new Set(Object.values(curation).flatMap((entry) => entry.approved));
    const llm = deps.getLlm(config.review.model);
    const stats = emptyReviewStats();

    try {
      const nextTriage = await runTriage(
        llm,
        skills,
        triage,
        kits,
        config.review.triageBatchSize,
        stats,
        (cache) => writeJsonFile(paths.triage, cache),
      );
      await writeJsonFile(paths.triage, nextTriage);

      const reviewed = new Set((await loadReviews(paths.reviewsDir)).keys());
      const max = options.dryRun
        ? Math.min(config.review.maxReviewsPerRun, DRY_RUN_MAX_REVIEWS)
        : config.review.maxReviewsPerRun;
      const { selected, deferred } = selectForReview(skills, nextTriage, reviewed, repos, max, priorityIds);
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
      );
    } finally {
      // Written even when a fatal error stops the run: the reviews already paid for stay counted.
      await updateRunInfo(paths.runInfo, { review: stats });
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
    const catalog = CatalogSchema.parse(JSON.parse(await readFile(paths.catalog, "utf8")));
    const runInfo = await readJsonFile(paths.runInfo, RunInfoSchema, {});
    await mkdir(path.dirname(paths.summary), { recursive: true });
    await writeFile(paths.summary, buildSummary(catalog, runInfo), "utf8");
    deps.log(`summary written to ${paths.summary}`);
  },
};

export async function runPipeline(options: PipelineOptions, deps: PipelineDeps): Promise<void> {
  const paths = resolvePaths(options.root, options.dryRun);
  const config = await readYamlFile(paths.config, ConfigSchema);
  const kits = await readYamlFile(paths.kits, KitsSchema);
  for (const step of STEPS) {
    if (!options.steps.includes(step)) continue;
    deps.log(`> ${step}`);
    await handlers[step]({ paths, config, kits, options, deps });
  }
}
