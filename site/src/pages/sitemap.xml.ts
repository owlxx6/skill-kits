import type { APIRoute } from "astro";
import { collectionHref, loadCatalog, skillHref } from "../lib/catalog";

// Absolute addresses need the final domain, so the list stays empty until SITE_URL is set when the site is built.
export const GET: APIRoute = ({ site }) => {
  const header = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  if (!site) return new Response(`${header}</urlset>\n`, { headers: { "Content-Type": "application/xml" } });
  const catalog = loadCatalog();
  const paths = [
    "/",
    "/search/",
    "/methodology/",
    ...catalog.kits.map((kit) => `/kits/${kit.id}/`),
    ...[...new Set(catalog.skills.map((skill) => skill.repo))].map((repo) => collectionHref(repo)),
    ...catalog.skills.map((skill) => skillHref(skill.id)),
  ];
  const urls = paths.map((entry) => `  <url><loc>${new URL(entry, site).href}</loc></url>`).join("\n");
  return new Response(`${header}${urls}\n</urlset>\n`, { headers: { "Content-Type": "application/xml" } });
};
