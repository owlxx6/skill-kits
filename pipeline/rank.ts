import type {
  Catalog,
  CatalogCollection,
  CatalogKit,
  CatalogSkill,
  Config,
  Curation,
  Kit,
  RepoMeta,
  Review,
  SkillRecord,
} from "./lib/schemas";
import { compareText } from "./lib/text";
import { collectionKitScore, repoSignal, reviewScore, skillScore } from "./lib/scores";

export interface RankInput {
  repos: RepoMeta[];
  skills: SkillRecord[];
  reviews: Map<string, Review>;
  kits: Kit[];
  curation: Curation;
  config: Config;
  now: Date;
}

interface Scored {
  id: string;
  score: number;
}

const byScoreThenId = (a: Scored, b: Scored): number =>
  b.score - a.score || compareText(a.id, b.id);

const duplicates = (ids: string[]): string[] =>
  ids.filter((id, index) => ids.indexOf(id) !== index);

export function validateCuration(curation: Curation, kits: Kit[]): void {
  const kitIds = new Set(kits.map((kit) => kit.id));
  const unknown = Object.keys(curation).filter((id) => !kitIds.has(id));
  if (unknown.length > 0) {
    throw new Error(`curation.yaml names kits that are not in kits.yaml: ${unknown.join(", ")}`);
  }
  for (const [kitId, entry] of Object.entries(curation)) {
    const duplicated = [
      ...duplicates(entry.approved),
      ...duplicates(entry.rejected),
      ...entry.approved.filter((id) => entry.rejected.includes(id)),
    ];
    if (duplicated.length > 0) {
      throw new Error(
        `curation.yaml, kit ${kitId}: ids listed twice or both approved and rejected: ${[...new Set(duplicated)].join(", ")}`,
      );
    }
  }
}

// Deterministic: no network, no model. The same cache, curation and date give the same catalog.
export function buildCatalog(input: RankInput): Catalog {
  const { repos, skills, reviews, kits, curation, config, now } = input;
  validateCuration(curation, kits);

  const repoByName = new Map(repos.map((repo) => [repo.fullName, repo]));
  const signalByRepo = new Map(
    repos.map((repo) => [repo.fullName, repoSignal(repo, now, config.scoring)]),
  );
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const fingerprintById = new Map(skills.map((skill) => [skill.id, skill.fingerprint]));
  const approvedIds = new Set(Object.values(curation).flatMap((entry) => entry.approved));
  const listedLower = new Set(repos.map((repo) => repo.fullName.toLowerCase()));

  const catalogSkills: CatalogSkill[] = [];
  const skillCountByRepo = new Map<string, number>();
  for (const skill of skills) {
    const repo = repoByName.get(skill.repo);
    if (!repo) continue;
    skillCountByRepo.set(skill.repo, (skillCountByRepo.get(skill.repo) ?? 0) + 1);
    const review = reviews.get(skill.fingerprint);
    if (!review) continue;
    const reviewValue = reviewScore(review.scores);
    if (reviewValue < config.review.minCatalogScore) continue;
    if (review.security.level === "severe") continue;
    const signal = signalByRepo.get(skill.repo) ?? 0;
    catalogSkills.push({
      id: skill.id,
      repo: skill.repo,
      path: skill.path,
      name: skill.name,
      description: skill.description,
      url: skill.path ? `${repo.url}/tree/${repo.defaultBranch}/${skill.path}` : repo.url,
      license: repo.license ?? "",
      stars: repo.stars,
      forks: repo.forks,
      pushedAt: repo.pushedAt,
      review,
      reviewScore: reviewValue,
      repoSignal: signal,
      score: skillScore(reviewValue, signal, config.scoring),
      humanReviewed: approvedIds.has(skill.id),
    });
  }
  catalogSkills.sort(byScoreThenId);

  const collections: CatalogCollection[] = [];
  for (const repo of repos) {
    const total = skillCountByRepo.get(repo.fullName) ?? 0;
    const listed = catalogSkills.filter((skill) => skill.repo === repo.fullName);
    if (total < config.collection.minSkills || listed.length === 0) continue;
    const signal = signalByRepo.get(repo.fullName) ?? 0;
    const kitScores: Record<string, number> = {};
    for (const kit of kits) {
      const scores = listed
        .filter((skill) => skill.review.kits.includes(kit.id))
        .map((skill) => skill.reviewScore);
      if (scores.length >= config.collection.minKitSkills) {
        kitScores[kit.id] = collectionKitScore(signal, scores, config.scoring);
      }
    }
    collections.push({
      id: repo.fullName,
      url: repo.url,
      description: repo.description,
      license: repo.license ?? "",
      stars: repo.stars,
      forks: repo.forks,
      pushedAt: repo.pushedAt,
      repoSignal: signal,
      skillCount: total,
      catalogSkillIds: listed.map((skill) => skill.id),
      kitScores,
      humanReviewed: approvedIds.has(repo.fullName),
    });
  }
  collections.sort((a, b) => b.repoSignal - a.repoSignal || compareText(a.id, b.id));

  const skillIds = new Set(catalogSkills.map((skill) => skill.id));
  const collectionIds = new Set(collections.map((collection) => collection.id));

  const catalogKits: CatalogKit[] = kits.map((kit) => {
    const decided = curation[kit.id] ?? { approved: [], rejected: [] };
    const taken = new Set([...decided.approved, ...decided.rejected]);
    const collectionProposals = collections
      .filter((collection) => kit.id in collection.kitScores && !taken.has(collection.id))
      .map((collection) => ({ id: collection.id, score: collection.kitScores[kit.id] }))
      .sort(byScoreThenId)
      .slice(0, config.proposals.collections);
    // A copy of content the curator already decided on is not proposed again.
    const takenFingerprints = new Set(
      [...taken].flatMap((id) => {
        const fingerprint = fingerprintById.get(id);
        return fingerprint === undefined ? [] : [fingerprint];
      }),
    );
    const proposedFingerprints = new Set<string>();
    const skillProposals = catalogSkills
      .filter(
        (skill) =>
          skill.review.kits.includes(kit.id) &&
          !taken.has(skill.id) &&
          !takenFingerprints.has(fingerprintById.get(skill.id) ?? skill.id),
      )
      .map((skill) => ({ id: skill.id, score: skill.score }))
      .sort(byScoreThenId)
      .filter((proposal) => {
        // Copies of one folder are one idea: propose the best-scored copy only.
        const fingerprint = fingerprintById.get(proposal.id) ?? proposal.id;
        if (proposedFingerprints.has(fingerprint)) return false;
        proposedFingerprints.add(fingerprint);
        return true;
      })
      .slice(0, config.proposals.skills);
    const notShown = decided.approved.filter((id) => !collectionIds.has(id) && !skillIds.has(id));
    // Why an approved entry left the catalog, for the curator.
    const removalReason = (id: string): string => {
      const record = skillById.get(id);
      // Skills of a repository dropped by the filter lose their record at extraction.
      const repoName = record?.repo ?? id.split(":")[0];
      if (!listedLower.has(repoName.toLowerCase())) return "repository no longer listed";
      if (!record) {
        return id.includes(":")
          ? "skill no longer found in the repository"
          : `collection below ${config.collection.minSkills} skills or with no skill in the catalog`;
      }
      const review = reviews.get(record.fingerprint);
      if (!review) return "not found in the catalog";
      const value = reviewScore(review.scores);
      if (value < config.review.minCatalogScore) {
        return `review score ${value} below ${config.review.minCatalogScore}`;
      }
      if (review.security.level === "severe") return "security severe";
      return "not found in the catalog";
    };
    // An approved skill whose new version waits for a review is pending, not removed.
    const pending = notShown.filter((id) => {
      const record = skillById.get(id);
      return record !== undefined && repoByName.has(record.repo) && !reviews.has(record.fingerprint);
    });
    return {
      id: kit.id,
      title: kit.title,
      description: kit.description,
      collections: decided.approved.filter((id) => collectionIds.has(id)),
      skills: decided.approved.filter((id) => skillIds.has(id)),
      pending,
      removed: notShown
        .filter((id) => !pending.includes(id))
        .map((id) => ({ id, reason: removalReason(id) })),
      proposals: { collections: collectionProposals, skills: skillProposals },
    };
  });

  return {
    generatedAt: now.toISOString(),
    kits: catalogKits,
    skills: catalogSkills,
    collections,
  };
}
