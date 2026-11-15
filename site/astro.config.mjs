import { defineConfig } from "astro/config";

// Static output: every page is generated at build time from catalog.json.
export default defineConfig({
  output: "static",
  trailingSlash: "always",
  vite: {
    // The site imports catalog.json and the pipeline schemas from outside site/.
    server: { fs: { allow: [".."] } },
  },
});
