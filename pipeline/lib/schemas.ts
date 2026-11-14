import { z } from "zod";

const repoName = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, "expected owner/repo")
  .refine((value) => value.split("/").every((part) => part !== "." && part !== ".."), {
    message: "owner and repo cannot be . or ..",
  });
const kitId = z.string().regex(/^[a-z0-9-]+$/, "expected a lowercase kit id");
const gitObjectId = z.string().regex(/^[0-9a-f]{40,64}$/, "expected a git object id");
const score = z.number().int().min(0).max(10);
const securityLevel = z.enum(["none", "notice", "severe"]);
const range = z
  .object({ min: z.number().positive(), max: z.number().positive() })
  .refine((value) => value.min < value.max, { message: "min must be below max" });
const weight = z.number().min(0);
const sumsToOne = (values: number[]): boolean =>
  Math.abs(values.reduce((total, value) => total + value, 0) - 1) < 1e-9;

export const SourcesSchema = z.object({
  repos: z.array(repoName),
  topics: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,49}$/, "expected a GitHub topic")),
  maxSearchPages: z.number().int().min(0).max(10),
});
export type Sources = z.infer<typeof SourcesSchema>;

export const KitSchema = z.object({
  id: kitId,
  title: z.string().min(1),
  description: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
});
export const KitsSchema = z.array(KitSchema).min(1);
export type Kit = z.infer<typeof KitSchema>;

export const ConfigSchema = z.object({
  filter: z.object({
    allowedLicenses: z
      .array(z.string().regex(/^[A-Za-z0-9.+-]+$/, "expected an SPDX license identifier"))
      .min(1),
    minStars: z.number().int().min(0),
    maxDaysSinceLastCommit: z.number().int().positive(),
  }),
  collection: z.object({
    minSkills: z.number().int().positive(),
    minKitSkills: z.number().int().positive(),
  }),
  review: z.object({
    model: z.string().min(1),
    triageBatchSize: z.number().int().positive(),
    maxReviewsPerRun: z.number().int().min(0),
    minCatalogScore: z.number().min(0).max(10),
    maxSkillChars: z.number().int().positive(),
  }),
  scoring: z.object({
    stars: range,
    forks: range,
    freshness: z
      .object({ fullDays: z.number().min(0), zeroDays: z.number().positive() })
      .refine((value) => value.fullDays < value.zeroDays, {
        message: "fullDays must be below zeroDays",
      }),
    repoSignal: z
      .object({ stars: weight, forks: weight, freshness: weight })
      .refine((value) => sumsToOne([value.stars, value.forks, value.freshness]), {
        message: "weights must sum to 1",
      }),
    skill: z
      .object({ review: weight, repoSignal: weight })
      .refine((value) => sumsToOne([value.review, value.repoSignal]), {
        message: "weights must sum to 1",
      }),
    collection: z
      .object({
        repoSignal: weight,
        medianReview: weight,
        coverage: weight,
        coverageCap: z.number().positive(),
      })
      .refine((value) => sumsToOne([value.repoSignal, value.medianReview, value.coverage]), {
        message: "weights must sum to 1",
      }),
  }),
  proposals: z.object({
    collections: z.number().int().min(0),
    skills: z.number().int().min(0),
  }),
});
export type Config = z.infer<typeof ConfigSchema>;

export const CurationSchema = z.record(
  kitId,
  z.object({ approved: z.array(z.string()), rejected: z.array(z.string()) }),
);
export type Curation = z.infer<typeof CurationSchema>;

export const RepoMetaSchema = z.object({
  fullName: repoName,
  url: z.url(),
  description: z.string().nullable(),
  stars: z.number().int().min(0),
  forks: z.number().int().min(0),
  license: z.string().nullable(),
  pushedAt: z.iso.datetime(),
  defaultBranch: z.string().min(1),
  archived: z.boolean(),
});
export type RepoMeta = z.infer<typeof RepoMetaSchema>;

export const SkillRecordSchema = z.object({
  id: z.string().min(1),
  repo: repoName,
  path: z.string(),
  name: z.string().min(1),
  description: z.string().min(1),
  fingerprint: gitObjectId,
  files: z.array(z.string()),
});
export type SkillRecord = z.infer<typeof SkillRecordSchema>;

export const ReviewSchema = z.object({
  kits: z.array(kitId).max(2),
  scores: z.object({ clarity: score, completeness: score, usefulness: score }),
  why: z.string().min(1).max(160),
  summary: z.string().min(1).max(400),
  strengths: z.array(z.string().min(1)).max(3),
  cautions: z.array(z.string().min(1)).max(3),
  keywords: z.array(z.string().min(1)).min(5).max(12),
  security: z.object({
    level: securityLevel,
    notes: z.array(z.string()),
  }),
});
export type Review = z.infer<typeof ReviewSchema>;

// Schemas sent to the model: same shape, no length or range constraints,
// because structured outputs accept only a subset of JSON Schema.
// ReviewSchema enforces the limits after the response comes back.
export const ReviewWireSchema = z.object({
  kits: z.array(z.string()),
  scores: z.object({ clarity: z.int(), completeness: z.int(), usefulness: z.int() }),
  why: z.string(),
  summary: z.string(),
  strengths: z.array(z.string()),
  cautions: z.array(z.string()),
  keywords: z.array(z.string()),
  security: z.object({
    level: securityLevel,
    notes: z.array(z.string()),
  }),
});

export const TriageWireSchema = z.object({
  results: z.array(z.object({ index: z.int(), kits: z.array(z.string()) })),
});

export const TriageCacheSchema = z.record(z.string(), z.array(z.string()));
export type TriageCache = z.infer<typeof TriageCacheSchema>;

export const ReviewRecordSchema = z.object({
  fingerprint: gitObjectId,
  model: z.string().min(1),
  reviewedAt: z.string().min(1),
  review: ReviewSchema,
});
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

export const TokenUsageSchema = z.object({ inputTokens: z.number(), outputTokens: z.number() });
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const FilteredRepoSchema = z.object({ fullName: z.string(), reason: z.string() });
export type FilteredRepo = z.infer<typeof FilteredRepoSchema>;

export const ExtractStatsSchema = z.object({
  repos: z.number(),
  skills: z.number(),
  invalid: z.number(),
  failedDownloads: z.number(),
  truncatedRepos: z.array(z.string()),
  failedRepos: z.array(z.object({ repo: z.string(), error: z.string() })),
});
export type ExtractStats = z.infer<typeof ExtractStatsSchema>;

export const ReviewStatsSchema = z.object({
  triaged: z.number(),
  triageMissing: z.number(),
  reviewed: z.number(),
  reviewedIds: z.array(z.string()),
  deferred: z.number(),
  truncated: z.number(),
  failed: z.array(z.object({ skillId: z.string(), reason: z.string() })),
  triageUsage: TokenUsageSchema,
  reviewUsage: TokenUsageSchema,
});
export type ReviewStats = z.infer<typeof ReviewStatsSchema>;

export const RunInfoSchema = z.object({
  filtered: z.array(FilteredRepoSchema).optional(),
  extract: ExtractStatsSchema.optional(),
  review: ReviewStatsSchema.optional(),
});
export type RunInfo = z.infer<typeof RunInfoSchema>;

const proposal = z.object({ id: z.string(), score: z.number() });

export const CatalogSkillSchema = z.object({
  id: z.string(),
  repo: repoName,
  path: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.url(),
  license: z.string(),
  stars: z.number(),
  forks: z.number(),
  pushedAt: z.string(),
  review: ReviewSchema,
  reviewScore: z.number(),
  repoSignal: z.number(),
  score: z.number(),
  humanReviewed: z.boolean(),
});
export type CatalogSkill = z.infer<typeof CatalogSkillSchema>;

export const CatalogCollectionSchema = z.object({
  id: repoName,
  url: z.url(),
  description: z.string().nullable(),
  license: z.string(),
  stars: z.number(),
  forks: z.number(),
  pushedAt: z.string(),
  repoSignal: z.number(),
  skillCount: z.number(),
  catalogSkillIds: z.array(z.string()),
  kitScores: z.record(z.string(), z.number()),
  humanReviewed: z.boolean(),
});
export type CatalogCollection = z.infer<typeof CatalogCollectionSchema>;

export const CatalogKitSchema = z.object({
  id: kitId,
  title: z.string(),
  description: z.string(),
  collections: z.array(z.string()),
  skills: z.array(z.string()),
  removed: z.array(z.string()),
  proposals: z.object({ collections: z.array(proposal), skills: z.array(proposal) }),
});
export type CatalogKit = z.infer<typeof CatalogKitSchema>;

export const CatalogSchema = z.object({
  generatedAt: z.string(),
  kits: z.array(CatalogKitSchema),
  skills: z.array(CatalogSkillSchema),
  collections: z.array(CatalogCollectionSchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;
