# Contributing to Kaiflow

Thanks for your interest. Bug reports, fixes, docs and well-scoped features are all welcome.
This project is also meant to be forked and customized; if you only want your own variant,
see [docs/forking.md](../docs/forking.md) instead.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Security problems go through [SECURITY.md](SECURITY.md), never public issues.

## Before you start

- **Small fixes** (typos, obvious bugs, docs): open a pull request directly.
- **Features or behavior changes**: open an issue first (Feature request template) so we can
  agree on scope before you invest time. Privacy-sensitive changes (anything that reads more
  from the OS or sends data off the device) always need an issue first.

## Development setup

Requirements:

- Rust 1.93 or newer (`rust-toolchain.toml` pins it), with `clippy` and `rustfmt`
- Node.js 22.12 or newer and npm
- macOS: Xcode command line tools. Linux: the WebKitGTK packages listed in
  [docs/platform-support.md](../docs/platform-support.md). Windows: WebView2 and the MSVC
  build tools.

```bash
git clone https://github.com/<you>/kaiflow.git
cd kaiflow
npm install
npm run tauri dev      # full app (Rust + UI)
npm run dev:mock       # UI only, in-memory backend, no Rust build
```

With `dev:mock`, open `http://localhost:1420/main.html` or `http://localhost:1420/popover.html`.

On macOS the Accessibility grant is tied to the app signature, so under `tauri dev` it goes to
your terminal. To test permissions, use a signed build: see
[scripts/create-dev-identity.md](../scripts/create-dev-identity.md).

## Architecture

Read [AGENTS.md](../AGENTS.md) before your first change. It is written for AI coding agents
but is the best map for humans too: crate boundaries, invariants, and the end-to-end recipe
for adding a feature (migration, domain, application, adapter, IPC, UI, tests).

## Gates to run before opening a pull request

All of these run in CI; run them locally first:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p kaiflow
npx tsc --noEmit
npm run lint
npm test
npm run build
npm run e2e            # when the UI changed (needs `npx playwright install chromium` once)
```

If you changed an IPC command or DTO, regenerate the TypeScript bindings and commit them:

```bash
UPDATE_BINDINGS=1 cargo test -p kaiflow generated_bindings
```

If you changed the landing page:

```bash
npm --prefix website run check
npm --prefix website run build
```

## Commit convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <imperative summary>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`. Scopes
usually match an area: `engine`, `ui`, `focus`, `goals`, `review`, `website`, `release`...

Examples: `fix(engine): close the open segment on sleep`,
`docs(readme): explain first-open steps on macOS`.

Keep each commit a reviewable unit: code, tests and docs for one change travel together.

## Pull requests

1. Fork, then branch from `main` (`feat/short-name` or `fix/short-name`).
2. Keep the pull request focused; split unrelated changes.
3. Add or update tests: domain and application logic in Rust unit tests, UI behavior in
   Vitest, user flows in Playwright (`e2e/`).
4. Fill in the pull request template, including the gates you ran.
5. English for code, comments, UI copy and docs.

## Reporting bugs and requesting features

Use the issue templates. For bugs, include your OS and version, the app version, and the
Accessibility permission state (macOS) because many tracking issues depend on it.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](../LICENSE).
