// @ts-check
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

/**
 * Production URL. It drives canonical links, hreflang alternates, Open Graph URLs and the
 * sitemap. Keep `public/robots.txt` in sync with it.
 */
const SITE = "https://clc-kaiflow.netlify.app";

export default defineConfig({
  site: SITE,
  output: "static",
  trailingSlash: "ignore",
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es"],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: { defaultLocale: "en", locales: { en: "en-US", es: "es" } },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
