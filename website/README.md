# Kaiflow website

The marketing landing page for Kaiflow. A static [Astro](https://astro.build) site with
Tailwind CSS 4, no client-side JavaScript, English at `/` and Spanish at `/es/`.

It is fully isolated from the desktop app: its own `package.json`, lockfile, `tsconfig.json`
and build. The app's lint, typecheck and tests ignore this folder.

## Local development

Requirements: Node.js 22.23.4 or newer.

```bash
cd website
npm install
npm run dev       # http://localhost:4321 with hot reload
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 4321 |
| `npm run build` | Static build into `dist/` (optimized images, sitemap) |
| `npm run preview` | Serves `dist/` on port 4321 |
| `npm run check` | Type and template checks (`astro check`) |
| `npm run screenshots` | Re-captures the app screenshots (see below) |
| `npm run og` | Regenerates `public/og.png`, the social sharing image |

## Content and structure

| Path | Contents |
|---|---|
| `src/i18n/en.ts`, `src/i18n/es.ts` | All page copy, one typed object per language |
| `src/components/sections/` | One component per page section |
| `src/components/Screenshot.astro` | Light and dark screenshots that follow the visitor's color scheme |
| `src/styles/global.css` | Design tokens (light and dark) and shared component classes |
| `src/lib/links.ts` | Download, repository and documentation links |
| `public/` | Favicons (from `src-tauri/icons`), `og.png`, `robots.txt` |

To add a language, add it to `LOCALES` in `src/i18n/types.ts` and to `i18n.locales` in
`astro.config.mjs`, create a content file, and add a page under `src/pages/<locale>/`.

## Screenshots

The screenshots in `src/assets/screenshots/` are real captures of the app UI, taken from the
app's mocked backend (seeded data, no Rust build needed):

```bash
# once, at the repository root: the script uses the app's Vite and Playwright
npm install
npx playwright install chromium

# then, from website/
npm run screenshots
npm run og        # the social image reuses the Today screenshot
```

`scripts/screenshots.mjs` starts `vite --mode mock` on port 1430, opens the popover and the
Today, Overview, Goals and Focus sections at 2x in light and dark, and stops the server when it
finishes. The clock is fixed, so re-running it produces the same pictures unless the UI changed.
To reuse a server you already started, set `BASE_URL=http://localhost:1430`.

## Deploy

The build output is plain static files in `website/dist/`. Before the first deploy, replace the
placeholder domain `https://kaiflow.example.com` in `astro.config.mjs` (`SITE`) and in
`public/robots.txt`.

| Host | Settings |
|---|---|
| Vercel | Root directory `website`, framework preset Astro, build `npm run build`, output `dist` |
| Netlify | Base directory `website`, build command `npm run build`, publish directory `website/dist` |
| GitHub Pages | Build in `website/` with `withastro/action` (`path: website`), then `actions/deploy-pages`. For a project page (`user.github.io/repo`), also set `base` in `astro.config.mjs` |

CI (`.github/workflows/website.yml`) runs `npm ci`, `npm run check` and `npm run build` in
`website/` whenever something under `website/` changes.
