import { loadCatalog } from "../lib/catalog";
import { buildSearchIndex } from "../lib/search";

export function GET(): Response {
  return new Response(JSON.stringify(buildSearchIndex(loadCatalog())), {
    headers: { "Content-Type": "application/json" },
  });
}
