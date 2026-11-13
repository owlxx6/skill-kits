import type { Config, RepoMeta, Review } from "./schemas";

type Scoring = Config["scoring"];

const MS_PER_DAY = 86_400_000;

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function logScale(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 10;
  return (10 * (Math.log(value) - Math.log(min))) / (Math.log(max) - Math.log(min));
}

export function freshnessScore(days: number, fullDays: number, zeroDays: number): number {
  if (days <= fullDays) return 10;
  if (days >= zeroDays) return 0;
  return (10 * (zeroDays - days)) / (zeroDays - fullDays);
}

export function daysBetween(fromIso: string, now: Date): number {
  return (now.getTime() - new Date(fromIso).getTime()) / MS_PER_DAY;
}

export function repoSignal(
  repo: Pick<RepoMeta, "stars" | "forks" | "pushedAt">,
  now: Date,
  scoring: Scoring,
): number {
  const stars = logScale(repo.stars, scoring.stars.min, scoring.stars.max);
  const forks = logScale(repo.forks, scoring.forks.min, scoring.forks.max);
  const freshness = freshnessScore(
    daysBetween(repo.pushedAt, now),
    scoring.freshness.fullDays,
    scoring.freshness.zeroDays,
  );
  return round1(
    scoring.repoSignal.stars * stars +
      scoring.repoSignal.forks * forks +
      scoring.repoSignal.freshness * freshness,
  );
}

export function reviewScore(scores: Review["scores"]): number {
  return round1((scores.clarity + scores.completeness + scores.usefulness) / 3);
}

export function skillScore(review: number, signal: number, scoring: Scoring): number {
  return round1(scoring.skill.review * review + scoring.skill.repoSignal * signal);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function collectionKitScore(
  signal: number,
  kitReviewScores: number[],
  scoring: Scoring,
): number {
  const cap = scoring.collection.coverageCap;
  const coverage = (10 * Math.min(kitReviewScores.length, cap)) / cap;
  return round1(
    scoring.collection.repoSignal * signal +
      scoring.collection.medianReview * median(kitReviewScores) +
      scoring.collection.coverage * coverage,
  );
}
