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
  // Repositories never processed, e.g. registries that copy thousands of other people's skills.
  exclude: z.array(repoName).optional(),
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
    // Minutes since the start of the run after which triage and reviews stop, so the run
    // ends within the workflow step limit (170 minutes).
    maxMinutes: z.number().positive(),
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

// A collection id (owner/repo) or a skill id (owner/repo:dir). No control character or
// backtick: ids are printed in code spans of the pull request.
const curationId = z.string().refine(
  (value) => {
    const colon = value.indexOf(":");
    if (colon < 0) return repoName.safeParse(value).success;
    return (
      repoName.safeParse(value.slice(0, colon)).success &&
      /^[^\x00-\x1f\x7f`]+$/.test(value.slice(colon + 1))
    );
  },
  { message: "expected owner/repo or owner/repo:dir" },
);

export const CurationSchema = z.record(
  kitId,
  z.object({ approved: z.array(curationId), rejected: z.array(curationId) }),
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

export const LICENSE_OUTCOMES = ["identified", "custom", "ambiguous", "missing"] as const;
export const LICENSE_LEVELS = ["skill", "ancestor", "repository", "none"] as const;
const evidenceLevel = z.enum(["skill", "ancestor", "repository"]);
// identified: a known license; restricted: a known license modified or with added terms;
// multiple: several licenses in one text; unknown: no known license recognised; unread: the
// text could not be read this run (download failed, wrong content, unresolved link);
// auxiliary: a license-named file that never decides (third-party list, notice, data file).
export const LICENSE_FILE_STATUSES = [
  "identified",
  "restricted",
  "multiple",
  "unknown",
  "unread",
  "auxiliary",
] as const;

// One piece of license evidence, with the level it counts at. A file is identified from its
// text, a front matter value from its SPDX id, and "github" is the id GitHub detected for the
// repository (value is RepoMeta.license: an id or NOASSERTION; null is not recorded).
export const LicenseEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("file"),
    level: evidenceLevel,
    path: z.string(),
    blob: gitObjectId,
    status: z.enum(LICENSE_FILE_STATUSES),
    spdx: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("frontmatter"),
    level: z.literal("skill"),
    path: z.string(),
    value: z.string(),
    spdx: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("github"),
    level: z.literal("repository"),
    value: z.string(),
    spdx: z.string().nullable(),
  }),
]);
export type LicenseEvidence = z.infer<typeof LicenseEvidenceSchema>;

// Shared by every outcome: the evidence, and the id of the tree it was read from.
const resolutionBase = {
  evidence: z.array(LicenseEvidenceSchema),
  revision: z.string().optional(),
};

// See docs/LICENSE-RESOLUTION.md. spdx exists only when the outcome is "identified".
// unread: the outcome is ambiguous because a deciding license file ("license-file") or the
// changed SKILL.md ("skill-file") could not be read in this run.
export const LicenseResolutionSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("identified"), spdx: z.string(), level: evidenceLevel, ...resolutionBase }),
  z.strictObject({ outcome: z.literal("custom"), level: evidenceLevel, ...resolutionBase }),
  z.strictObject({
    outcome: z.literal("ambiguous"),
    level: z.enum(LICENSE_LEVELS),
    unread: z.enum(["license-file", "skill-file"]).optional(),
    ...resolutionBase,
  }),
  z.strictObject({ outcome: z.literal("missing"), level: z.literal("none"), ...resolutionBase }),
]);
export type LicenseResolution = z.infer<typeof LicenseResolutionSchema>;
export type LicenseOutcome = LicenseResolution["outcome"];
export type LicenseLevel = LicenseResolution["level"];

// What a license text was identified as.
export const TextIdentificationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("spdx"), spdx: z.string() }),
  z.strictObject({ kind: z.literal("restricted") }),
  z.strictObject({ kind: z.literal("multiple") }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
export type TextIdentification = z.infer<typeof TextIdentificationSchema>;

// Identified license texts, by git blob id: a changed file has a new id and is identified again.
export const LicenseCacheSchema = z.record(gitObjectId, TextIdentificationSchema);
export type LicenseCache = z.infer<typeof LicenseCacheSchema>;

export const SkillRecordSchema = z.object({
  // No control character or backtick: the id is printed in code spans of the pull request.
  id: z.string().min(1).regex(/^[^\x00-\x1f\x7f`]+$/, "unsafe skill id"),
  repo: repoName,
  path: z.string(),
  name: z.string().min(1),
  description: z.string().min(1),
  fingerprint: gitObjectId,
  files: z.array(z.string()),
  // Optional when reading: a record without it is unresolved, never eligible. A resolution in
  // a shape this code no longer reads is dropped, so the next extract resolves it again.
  license: LicenseResolutionSchema.optional().catch(undefined),
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
  scores: z.object({
    clarity: z.int().min(0).max(10),
    completeness: z.int().min(0).max(10),
    usefulness: z.int().min(0).max(10),
  }),
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
  results: z.array(z.object({ index: z.int().min(0), kits: z.array(z.string()) })),
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

export const RenamedRepoSchema = z.object({ from: z.string(), to: z.string() });
export type RenamedRepo = z.infer<typeof RenamedRepoSchema>;

// License outcomes of the skills kept after extraction. Optional in ExtractStats so run
// information written before license resolution still loads.
export const LicenseStatsSchema = z.object({
  identifiedAllowed: z.number(),
  identifiedNotAllowed: z.number(),
  custom: z.number(),
  ambiguous: z.number(),
  missing: z.number(),
  // Ambiguous because a license file or the changed SKILL.md could not be read this run.
  notReRead: z.number().default(0),
  // Records without a resolution (kept from a failed or truncated read before this change).
  unresolved: z.number(),
  // License files that could not be read: failed download, content not matching the listed
  // blob, or a symbolic link that could not be resolved.
  failedDownloads: z.number(),
});
export type LicenseStats = z.infer<typeof LicenseStatsSchema>;

export const ExtractStatsSchema = z.object({
  repos: z.number(),
  skills: z.number(),
  invalid: z.number(),
  failedDownloads: z.number(),
  truncatedRepos: z.array(z.string()),
  failedRepos: z.array(z.object({ repo: z.string(), error: z.string() })),
  licenses: LicenseStatsSchema.optional(),
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
  // Defaults to false so run information written before this field still loads.
  stoppedByTimeBudget: z.boolean().default(false),
});
export type ReviewStats = z.infer<typeof ReviewStatsSchema>;

export const RunInfoSchema = z.object({
  filtered: z.array(FilteredRepoSchema).optional(),
  renamed: z.array(RenamedRepoSchema).optional(),
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
  // Where the license comes from. Optional so the site builds on an older catalog.json.
  licenseEvidence: z
    .object({
      level: z.enum(["skill", "ancestor", "repository"]),
      path: z.string().nullable(),
      url: z.url().nullable(),
    })
    .optional(),
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
  // The single SPDX id of the repository's skills, or "Mixed".
  license: z.string(),
  // Sorted SPDX ids of the repository's skills. Optional so the site builds on an older catalog.json.
  licenses: z.array(z.string()).optional(),
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
  pending: z.array(z.string()),
  removed: z.array(z.object({ id: z.string(), reason: z.string() })),
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
