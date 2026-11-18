import type { APIRoute } from "astro";

// The sitemap line needs the final address, which is read from SITE_URL when the site is built (see astro.config.mjs).
export const GET: APIRoute = ({ site }) => {
  const lines = ["User-agent: *", "Allow: /"];
  if (site) lines.push(`Sitemap: ${new URL("/sitemap.xml", site).href}`);
  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
