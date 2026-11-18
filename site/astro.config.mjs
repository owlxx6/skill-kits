import { defineConfig } from "astro/config";

// Static output: every page is generated at build time from catalog.json.
// SITE_URL is the public address (for example https://example.pages.dev). Set it when deploying so share images, canonical
// links and the sitemap get absolute URLs; without it those parts are simply left out.
export default defineConfig({
  output: "static",
  site: process.env.SITE_URL || undefined,
  trailingSlash: "always",
  vite: {
    // The site imports catalog.json and the pipeline schemas from outside site/.
    server: { fs: { allow: [".."] } },
  },
});
