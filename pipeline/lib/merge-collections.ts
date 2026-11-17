import type { Catalog, CatalogCollection } from "./schemas";
import { compareText } from "./text";

export interface CollectionApproval {
  kitId: string;
  repo: string;
}

// Adds whole-repository collections the owner approved to an existing public catalog, without
// refreshing anything else. `computed` is a catalog built from the current cache and curation
// (rank): only the collections of the approved repositories and the reviewed skills they list
// are taken from it. Existing skills, collections and kit entries are kept as they are.
//
// Public-record rules, as for the other local imports: the new records are not marked as read
// by a person (approving a repository is not reading every skill in it), and the security notes
// stay private (the level is kept).
export function mergeApprovedCollections(
  existing: Catalog,
  computed: Catalog,
  approvals: CollectionApproval[],
): Catalog {
  const repos = [...new Set(approvals.map((approval) => approval.repo))];
  const computedCollections = new Map(computed.collections.map((collection) => [collection.id, collection]));
  const missing = repos.filter((repo) => !computedCollections.has(repo));
  if (missing.length > 0) {
    throw new Error(`Not an eligible collection in the computed catalog: ${missing.join(", ")}`);
  }
  const kitIds = new Set(existing.kits.map((kit) => kit.id));
  const unknownKits = [...new Set(approvals.map((approval) => approval.kitId))].filter((id) => !kitIds.has(id));
  if (unknownKits.length > 0) {
    throw new Error(`Unknown kit in the approvals: ${unknownKits.join(", ")}`);
  }

  const known = new Set(existing.skills.map((skill) => skill.id));
  const added = computed.skills
    .filter((skill) => repos.includes(skill.repo) && !known.has(skill.id))
    .map((skill) => ({
      ...skill,
      humanReviewed: false,
      review: { ...skill.review, security: { ...skill.review.security, notes: [] } },
    }))
    .sort((a, b) => b.score - a.score || compareText(a.id, b.id));
  const skills = [...existing.skills, ...added];

  const merged: CatalogCollection[] = [
    ...existing.collections.filter((collection) => !repos.includes(collection.id)),
    ...repos.map((repo) => ({ ...computedCollections.get(repo)!, humanReviewed: false })),
  ].sort((a, b) => b.repoSignal - a.repoSignal || compareText(a.id, b.id));

  // Every skill a collection lists must be in the catalog.
  const skillIds = new Set(skills.map((skill) => skill.id));
  for (const collection of merged) {
    const absent = collection.catalogSkillIds.filter((id) => !skillIds.has(id));
    if (absent.length > 0) {
      throw new Error(`Collection ${collection.id} lists skills missing from the catalog: ${absent.join(", ")}`);
    }
  }

  const kits = existing.kits.map((kit) => {
    const approved = approvals
      .filter((approval) => approval.kitId === kit.id)
      .map((approval) => approval.repo);
    if (approved.length === 0) return kit;
    return {
      ...kit,
      collections: [...kit.collections, ...approved.filter((repo) => !kit.collections.includes(repo))],
      proposals: {
        ...kit.proposals,
        collections: kit.proposals.collections.filter((proposal) => !approved.includes(proposal.id)),
      },
    };
  });

  return { generatedAt: computed.generatedAt, kits, skills, collections: merged };
}
