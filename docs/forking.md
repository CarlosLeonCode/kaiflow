# Fork and customize

Kaiflow is meant to be a base you can fork: a working, private, local-first time
tracker with a clean architecture, so you (or an AI coding agent) can bend it to your own
workflow. It is MIT licensed: you can use, modify and redistribute it, including for
commercial work, as long as you keep the copyright and license notice.

## 1. Fork and run it

```bash
gh repo fork CarlosLeonCode/kaiflow --clone   # or use the Fork button
cd kaiflow
npm install
npm run dev:mock          # UI only, in-memory backend: fastest way to explore
npm run tauri dev         # the real app
```

Then point your agent at [AGENTS.md](../AGENTS.md) (Claude Code also reads `CLAUDE.md`, which
points there). It explains the architecture, the invariants and the exact commands to verify a
change.

## 2. Rebrand checklist

Do these before you distribute your own build, so it does not collide with the original app
(same bundle id means macOS treats both as the same app: shared data and permissions).

| What | Where |
|---|---|
| Bundle identifier `com.carlosleon.kaiflow` | `src-tauri/tauri.conf.json` (`identifier`), `scripts/dev-sign.sh` (`osascript ... application id`). It also names the data folder (`~/Library/Application Support/<identifier>/`). |
| App name "Kaiflow" | `src-tauri/tauri.conf.json` (`productName`), `src-tauri/src/windows.rs` (window titles), `src-tauri/src/tray.rs` and `src-tauri/src/tray_text.rs` (tooltip, with its tests), `main.html` / `popover.html` / `onboarding.html` (`<title>`), `src/features/onboarding/components/OnboardingView.tsx`, `crates/adapters-windows/src/message_loop.rs` |
| Keychain service for AI keys `com.carlosleon.kaiflow` | `crates/application/src/ai.rs` (`KEYCHAIN_SERVICE`; `LEGACY_KEYCHAIN_SERVICE` is the pre-rename name, kept only to move old keys) |
| Data carried over from the old identity | `src-tauri/src/data_migration.rs` (`LEGACY_IDENTIFIER`, `LEGACY_DB_FILE`). A fork with its own identifier can delete this module and its call in `src-tauri/src/lib.rs`. |
| Logo and icons | Master artwork in `assets/brand/` (mark, mono mark, app icon, wordmarks; see its README). Render `kaiflow-app-icon.svg` to a 1024x1024 PNG and run `npx tauri icon path/to/icon.png` to regenerate `src-tauri/icons/` (all sizes, `.icns`, `.ico`; delete the `android/`, `ios/` and `Square*` extras it also writes). Rebuild `src-tauri/icons/tray-template.png` from `kaiflow-mark-mono.svg`: black on transparent, 36x36 px (18 pt @2x), used as a macOS template image in `src-tauri/src/tray.rs`; Windows and Linux trays use `icons/64x64.png`. The inline mark lives in `src/shared/ui/kaiflow-mark.tsx` (app) and `website/src/components/Logo.astro` (landing). Landing icons: `website/public/favicon.ico`, `favicon.png`, `apple-touch-icon.png`, `website/src/assets/brand/app-icon.png`, then `npm --prefix website run og`. |
| Updater endpoint and public key | `src-tauri/tauri.conf.json` (`plugins.updater`), and the test in `src-tauri/src/updater.rs` that asserts the endpoint. Generate your own key: see [release.md](release.md). Never reuse someone else's endpoint. |
| Repository links | `README.md`, `website/src/lib/links.ts`, `.github/` templates, `src/features/settings` (About block), `package.json` (`author`) |
| Landing page | `website/` (Astro). Copy in `website/src/i18n/en.ts` and `es.ts`, site URL in `website/astro.config.mjs`, screenshots in `website/src/assets/screenshots/` (`npm --prefix website run screenshots` regenerates them from the mock UI). |
| Release signing identity | `.github/workflows/release.yml` signs with a self-signed identity named "Kaiflow Release" when you provide it; see [release.md](release.md). Pick your own name and certificate. |
| License notice | Keep the original copyright line in `LICENSE`; add your own line below it if you like. |

A quick way to find leftovers:

```bash
git grep -n -e 'com.carlosleon.kaiflow' -e 'Kaiflow' -e 'CarlosLeonCode'
```

## 3. Customization ideas

- **Billing export**: CSV per client and week, ready for an invoice or a timesheet tool.
- **Project detection**: map Git repositories or IDE window titles to activities
  automatically (title-pattern rules already exist; add smarter suggestions).
- **Pomodoro mode** on top of focus sessions.
- **Calendar import**: read a local `.ics` file to label meetings (keep it local).
- **Per-team presets**: ship your own activity presets and rules for your company's tools.
- **Different charts or a compact dashboard** for small screens.
- **A different AI provider** for the weekly review (add an adapter in `crates/adapters-ai`).
- **Stricter privacy**: titles always hashed, or automatic retention of N days.

Keep the invariants in [AGENTS.md](../AGENTS.md): pure domain, one writer thread, OS calls
behind ports, and no data leaving the device unless the user opts in.

## 4. Example prompts for an AI coding agent

Start each session with: "Read AGENTS.md first and follow its invariants and verification
commands."

- *Rebrand*: "Rebrand this fork to 'Acme Hours' with bundle id `com.acme.hours`. Follow the
  rebrand checklist in docs/forking.md, update tests that assert the old name, and run the
  verification commands."
- *New export*: "Add a CSV export of totals per activity for a date range. Follow the
  'Adding a feature end to end' recipe in AGENTS.md: application use case, IPC command,
  capability for the main window, bindings, mock backend handler, a button in the Data panel,
  a Vitest test and an E2E spec."
- *New rule type*: "Let activity rules match on the app bundle id as well as the app name.
  Keep the domain pure, add proptest coverage, and a migration if storage changes."
- *UI change*: "Using `npm run dev:mock`, add a weekly total to the popover. Keep the
  container/presentational split and check both themes."
- *Platform work*: "Improve Wayland support on GNOME. Put any OS call behind a port in
  `application/src/ports.rs` and implement it in `crates/adapters-linux`. Verify with the
  Docker recipe in AGENTS.md."

Review what the agent changed (especially capabilities, migrations and anything touching the
network) before you ship it.

## 5. Ship your fork

- Releases: tag `vX.Y.Z` and let `.github/workflows/release.yml` build it. Everything works
  without a paid Apple Developer account; see [release.md](release.md).
- Landing: `.github/workflows/website.yml` checks and builds `website/`; publish
  `website/dist/` on any static host (GitHub Pages, Netlify...) after updating the site URL.
- Staying in sync: `git remote add upstream https://github.com/CarlosLeonCode/kaiflow.git`
  and merge `upstream/main` from time to time.
