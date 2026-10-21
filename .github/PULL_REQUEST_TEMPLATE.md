## What and why

<!-- What does this change do, and why? Link the issue: "Closes #123". -->

## How to test

<!-- Steps a reviewer can follow, including the platform you tested on. -->

## Checklist

- [ ] Title follows Conventional Commits (`feat(scope): ...`, `fix: ...`)
- [ ] `cargo fmt --all --check` and `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test --workspace`
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`
- [ ] `npm run e2e` (UI changes)
- [ ] Bindings regenerated (`UPDATE_BINDINGS=1 cargo test -p kaiflow generated_bindings`) if IPC changed
- [ ] Tests added or updated
- [ ] Docs updated (README, AGENTS.md, docs/) if behavior or setup changed
- [ ] No new data leaves the device (or it is opt-in and documented)
