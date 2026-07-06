// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Static output only (locked decision D1). No client JS except explicit
// search/filter islands added in later waves.
//
// SITE_URL / BASE_PATH default to production. The staging repo's CI sets them
// (e.g. SITE_URL=https://<owner>.github.io/<repo>, BASE_PATH=/<repo>) so the
// same source builds a subpath-hosted preview. PUBLIC_STAGING=1 adds noindex.
const SITE = process.env.SITE_URL ?? "https://data-science-group.github.io";
const BASE = process.env.BASE_PATH ?? "/";

export default defineConfig({
  site: SITE,
  base: BASE,
  output: "static",
  trailingSlash: "ignore",
  integrations: [
    sitemap({
      // Legacy archives are copied into dist post-build; they are linked,
      // crawlable HTML but not part of Astro's page graph.
    }),
  ],
  build: {
    format: "directory",
  },
});
