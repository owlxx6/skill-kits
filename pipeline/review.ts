import { FatalLlmError, errorMessage } from "./lib/errors";
import type { GitHubClient } from "./lib/github";
import type { LlmClient, LlmResult, ReviewInput } from "./lib/llm";
import {
  type Config,
  type Kit,
  type RepoMeta,
  type Review,
  type ReviewRecord,
  ReviewSchema,
  type ReviewStats,
  type SkillRecord,
  type TokenUsage,
  type TriageCache,
  TriageWireSchema,
} from "./lib/schemas";
import { skillFilePath } from "./lib/skillfile";
import { compareText } from "./lib/text";

type ReviewSettings = Config["review"];

const MAX_KITS_PER_SKILL = 2;
const REVIEW_ATTEMPTS = 2;
const MAX_LIST_ITEMS = 3;
const MAX_KEYWORDS = 12;
// Triage reads only the start of a description: enough to classify, and it bounds the cost.
const TRIAGE_DESCRIPTION_CHARS = 500;

export function emptyReviewStats(): ReviewStats {
  return {
    triaged: 0,
    triageMissing: 0,
    reviewed: 0,
    reviewedIds: [],
    deferred: 0,
    truncated: 0,
    failed: [],
    triageUsage: { inputTokens: 0, outputTokens: 0 },
    reviewUsage: { inputTokens: 0, outputTokens: 0 },
  };
}

function addUsage(total: TokenUsage, extra: TokenUsage): void {
  total.inputTokens += extra.inputTokens;
  total.outputTokens += extra.outputTokens;
}

// Copies of the same skill folder in several repos share a fingerprint: handle them once.
function uniqueByFingerprint(skills: SkillRecord[]): SkillRecord[] {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    if (seen.has(skill.fingerprint)) return false;
    seen.add(skill.fingerprint);
    return true;
  });
}

export async function runTriage(
  llm: Pick<LlmClient, "triage">,
  skills: SkillRecord[],
  triage: TriageCache,
  kits: Kit[],
  batchSize: number,
  stats: ReviewStats,
): Promise<TriageCache> {
  const kitIds = new Set(kits.map((kit) => kit.id));
  const pending = uniqueByFingerprint(skills.filter((skill) => !(skill.fingerprint in triage)));
  const next: TriageCache = { ...triage };

  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const items = batch.map((skill, index) => ({
      index,
      name: skill.name,
      description: skill.description.slice(0, TRIAGE_DESCRIPTION_CHARS),
    }));
    let result: LlmResult;
    try {
      result = await llm.triage(items, kits);
    } catch (error) {
      if (error instanceof FatalLlmError) throw error;
      console.warn(`Triage batch failed, will retry next run: ${errorMessage(error)}`);
      stats.triageMissing += batch.length;
      continue;
    }
    addUsage(stats.triageUsage, result.usage);
    const parsed = TriageWireSchema.safeParse(result.data);
    if (!parsed.success) {
      stats.triageMissing += batch.length;
      continue;
    }
    const answered = new Set<number>();
    for (const item of parsed.data.results) {
      const skill = batch[item.index];
      if (!skill || answered.has(item.index)) continue;
      answered.add(item.index);
      next[skill.fingerprint] = item.kits
        .filter((id) => kitIds.has(id))
        .slice(0, MAX_KITS_PER_SKILL);
      stats.triaged += 1;
    }
    stats.triageMissing += batch.length - answered.size;
  }
  return next;
}

export function selectForReview(
  skills: SkillRecord[],
  triage: TriageCache,
  reviewed: Set<string>,
  repos: RepoMeta[],
  max: number,
): { selected: SkillRecord[]; deferred: number } {
  const stars = new Map(repos.map((repo) => [repo.fullName, repo.stars]));
  const candidates = uniqueByFingerprint(
    skills.filter(
      (skill) =>
        (triage[skill.fingerprint]?.length ?? 0) > 0 && !reviewed.has(skill.fingerprint),
    ),
  ).sort(
    (a, b) =>
      (stars.get(b.repo) ?? 0) - (stars.get(a.repo) ?? 0) || compareText(a.id, b.id),
  );
  return {
    selected: candidates.slice(0, max),
    deferred: Math.max(0, candidates.length - max),
  };
}

// Trims what the model may overshoot by a little (counts, unknown kits) so it does not cost a
// paid retry. Everything else stays untouched for the strict schema to judge.
export function normalizeReview(data: unknown, kitIds: Set<string>): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const copy: Record<string, unknown> = { ...data };
  if (Array.isArray(copy.kits)) {
    copy.kits = copy.kits
      .filter((id): id is string => typeof id === "string" && kitIds.has(id))
      .slice(0, MAX_KITS_PER_SKILL);
  }
  if (Array.isArray(copy.strengths)) copy.strengths = copy.strengths.slice(0, MAX_LIST_ITEMS);
  if (Array.isArray(copy.cautions)) copy.cautions = copy.cautions.slice(0, MAX_LIST_ITEMS);
  if (Array.isArray(copy.keywords)) copy.keywords = copy.keywords.slice(0, MAX_KEYWORDS);
  return copy;
}

export interface ReviewOutcome {
  review: Review | null;
  reason?: string;
  usage: TokenUsage;
  truncated: boolean;
}

export async function reviewSkill(
  llm: Pick<LlmClient, "review">,
  skill: SkillRecord,
  content: string,
  kits: Kit[],
  settings: ReviewSettings,
): Promise<ReviewOutcome> {
  const truncated = content.length > settings.maxSkillChars;
  const input: ReviewInput = {
    name: skill.name,
    description: skill.description,
    repo: skill.repo,
    files: skill.files,
    content: truncated ? content.slice(0, settings.maxSkillChars) : content,
    truncated,
  };
  const kitIds = new Set(kits.map((kit) => kit.id));
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let reason = "no answer";

  for (let attempt = 1; attempt <= REVIEW_ATTEMPTS; attempt += 1) {
    const result = await llm.review(input, kits, settings.maxSkillChars);
    addUsage(usage, result.usage);
    if (result.refusal) {
      reason = "model refused"; // asking again would get the same refusal
      break;
    }
    const parsed = ReviewSchema.safeParse(normalizeReview(result.data, kitIds));
    if (parsed.success) return { review: parsed.data, usage, truncated };
    const issue = parsed.error.issues[0];
    reason = `invalid review: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim();
  }
  return { review: null, reason, usage, truncated };
}

export interface ReviewDeps {
  llm: Pick<LlmClient, "review">;
  gh: Pick<GitHubClient, "getFileText">;
  kits: Kit[];
  repos: RepoMeta[];
  settings: ReviewSettings;
  now: Date;
  saveReview: (record: ReviewRecord) => Promise<void>;
}

// Reviews run one at a time on purpose: simple, and gentle on rate limits.
// Add concurrency only if the dry run shows a full pass takes too long.
export async function runReviews(
  deps: ReviewDeps,
  selected: SkillRecord[],
  stats: ReviewStats,
): Promise<void> {
  const repoByName = new Map(deps.repos.map((repo) => [repo.fullName, repo]));
  for (const skill of selected) {
    const repo = repoByName.get(skill.repo);
    if (!repo) continue;
    try {
      const content = await deps.gh.getFileText(
        repo.fullName,
        repo.defaultBranch,
        skillFilePath(skill.path),
      );
      const outcome = await reviewSkill(deps.llm, skill, content, deps.kits, deps.settings);
      addUsage(stats.reviewUsage, outcome.usage);
      if (outcome.truncated) stats.truncated += 1;
      if (!outcome.review) {
        stats.failed.push({ skillId: skill.id, reason: outcome.reason ?? "unknown" });
        continue;
      }
      await deps.saveReview({
        fingerprint: skill.fingerprint,
        model: deps.settings.model,
        reviewedAt: deps.now.toISOString(),
        review: outcome.review,
      });
      stats.reviewed += 1;
      stats.reviewedIds.push(skill.id);
    } catch (error) {
      if (error instanceof FatalLlmError) throw error;
      stats.failed.push({ skillId: skill.id, reason: errorMessage(error) });
    }
  }
}
