import type { APIRoute, GetStaticPaths } from "astro";
import { loadCatalog, plural } from "../../lib/catalog";
import { renderShareCard, type ShareCard } from "../../lib/og-image";

// One share image for the site and one per kit: /og/default.png and /og/<kit>.png.
export const getStaticPaths: GetStaticPaths = () => [
  { params: { name: "default" } },
  ...loadCatalog().kits.map((kit) => ({ params: { name: kit.id } })),
];

export const GET: APIRoute = async ({ params }) => {
  const catalog = loadCatalog();
  const kit = catalog.kits.find((entry) => entry.id === params.name);
  const card: ShareCard = kit
    ? {
        eyebrow: `Kit · ${plural(kit.collections.length, "collection")}`,
        title: kit.title,
        lines: kit.collections.slice(0, 3).map((id, position) => `${position + 1}   ${id}`),
        footer: "Reviewed agent skills, one command per part",
      }
    : {
        eyebrow: "Reviewed agent skills",
        title: ["Pick a job.", "Install the whole kit."],
        lines: [],
        footer: `${plural(catalog.skills.length, "skill")} · ${plural(catalog.collections.length, "collection")} · ${plural(catalog.kits.length, "kit")}`,
      };
  return new Response(await renderShareCard(card), { headers: { "Content-Type": "image/png" } });
};
