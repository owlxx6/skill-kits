import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { mergeApprovedCollections, type CollectionApproval } from "../pipeline/lib/merge-collections";
import { CatalogSchema, CurationSchema } from "../pipeline/lib/schemas";

// Adds the owner's whole-repository approvals to catalog.json without regenerating the rest of
// the public catalog (a plain rank would list every reviewed skill). No network, no model.
//
//   npx tsx pipeline/cli.ts rank --dry-run          (builds .dry-run/catalog.json from the cache)
//   npx tsx scripts/approve-collections.ts --repos owner/a,owner/b [--computed .dry-run/catalog.json] [--apply]
//
// Each repository must be approved in data/curation.yaml, under the kit that shows it.
// Without --apply nothing is written and the changes are listed.
const args = process.argv.slice(2);
const option = (name: string, fallback?: string): string => {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const repos = option("--repos").split(",").map((repo) => repo.trim()).filter(Boolean);
const computedFile = option("--computed", ".dry-run/catalog.json");
const apply = args.includes("--apply");

const json = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));
const curation = CurationSchema.parse(parse(await readFile("data/curation.yaml", "utf8")));
const existing = CatalogSchema.parse(await json("catalog.json"));
const computed = CatalogSchema.parse(await json(computedFile));

const approvals: CollectionApproval[] = repos.map((repo) => {
  const kitIds = Object.entries(curation)
    .filter(([, entry]) => entry.approved.includes(repo))
    .map(([kitId]) => kitId);
  if (kitIds.length !== 1) {
    throw new Error(`${repo} must be approved under exactly one kit in curation.yaml (found ${kitIds.length})`);
  }
  return { kitId: kitIds[0], repo };
});

const merged = CatalogSchema.parse(mergeApprovedCollections(existing, computed, approvals));
const addedSkills = merged.skills.length - existing.skills.length;
console.log(`skills ${existing.skills.length} -> ${merged.skills.length} (+${addedSkills}); collections ${existing.collections.length} -> ${merged.collections.length}`);
for (const approval of approvals) {
  const collection = merged.collections.find((entry) => entry.id === approval.repo)!;
  console.log(`  ${approval.kitId}: ${approval.repo} (${collection.catalogSkillIds.length} of ${collection.skillCount} skills reviewed)`);
}
if (!apply) {
  console.log("Preview only: add --apply to write catalog.json.");
} else {
  await writeFile("catalog.json", `${JSON.stringify(merged, null, 2)}\n`);
  console.log("catalog.json written.");
}
