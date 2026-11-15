import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import { kitView, loadCatalog, skillSlug } from "../site/src/lib/catalog";
import { SEARCH_OPTIONS } from "../site/src/lib/search";

// Checks the built site against the catalog it was built from. Run after `npm run site:build`.
const dist = path.join(process.cwd(), "site", "dist");
const problems: string[] = [];
const page = (relative: string): string | null => {
  const file = path.join(dist, relative, "index.html");
  if (!existsSync(file)) {
    problems.push(`missing page ${relative}/`);
    return null;
  }
  return readFileSync(file, "utf8");
};

const catalog = loadCatalog();
page("");
page("search");
page("methodology");
for (const kit of catalog.kits) {
  const html = page(`kits/${kit.id}`);
  const view = kitView(catalog, kit.id);
  for (const id of [...(view?.collections.map((entry) => entry.id) ?? []), ...(view?.skills.map((entry) => entry.name) ?? [])]) {
    if (html && !html.includes(id)) problems.push(`kit ${kit.id} does not show ${id}`);
  }
}
for (const skill of catalog.skills) page(`skills/${skillSlug(skill.id)}`);
for (const repo of new Set(catalog.skills.map((skill) => skill.repo))) page(`collections/${repo}`);

const indexFile = path.join(dist, "search-index.json");
if (!existsSync(indexFile)) problems.push("missing search-index.json");
else {
  const index = MiniSearch.loadJSON(readFileSync(indexFile, "utf8"), SEARCH_OPTIONS);
  for (const kit of catalog.kits) {
    const first = kitView(catalog, kit.id)?.skills[0];
    const keyword = first?.review.keywords[0];
    if (keyword && index.search(keyword).length === 0) problems.push(`search finds nothing for "${keyword}" (kit ${kit.id})`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`site OK: ${catalog.kits.length} kits, ${catalog.skills.length} skill pages`);
