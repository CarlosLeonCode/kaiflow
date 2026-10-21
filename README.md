# TimeTrack

TimeTrack is a local-first menu bar app that records which apps and windows you use, so you can see where your day actually goes. Nothing leaves your machine. It is built for macOS and also tracks on Windows and Linux (X11; Wayland sessions are limited), see [docs/platform-support.md](docs/platform-support.md).

## Features

- Menu bar popover with today's total, the current app and a pause/resume shortcut
- Today view with a timeline colored by activity, totals by app and by activity
- Overview by day, week, month and the last 90 days (trend, busiest hours, focus ratio), with JSON export
- Activities (projects, clients or tasks) with rules by app or by window-title pattern, each flagged productive, neutral or distracting
- Idle detection: when you come back, choose to discard the time or assign it
- Privacy controls: excluded apps, hidden titles, delete by range or everything
- Light and dark themes, keyboard shortcuts, automatic updates

## How tracking works on macOS

- The frontmost app's name comes from `NSWorkspace` and needs no permission.
- Window titles are read through the Accessibility API. Grant it once in
  System Settings → Privacy & Security → Accessibility. Without it, TimeTrack
  still records app names.
- Screen Recording is never requested.
- Data is stored in SQLite under `~/Library/Application Support/com.carlosleon.timetrack/`.

## Development

Requirements: Rust 1.93+, Node.js 22.12+, Xcode command line tools.

```bash
npm install
```

```bash
npm run tauri dev
```

UI only, with a mocked backend (no Rust build needed):

```bash
npm run dev:mock
```

Then open `http://localhost:1420/main.html` or `http://localhost:1420/popover.html`.

Accessibility grants are tied to the app's signature. Under `tauri dev` the grant goes to your terminal, so test permissions with a signed build: see [scripts/create-dev-identity.md](scripts/create-dev-identity.md) and `scripts/dev-sign.sh`.

## Tests

```bash
cargo test --workspace
```

```bash
npm test
```

```bash
npm run e2e
```

## Project layout

| Path | Contents |
|---|---|
| `crates/domain` | Pure tracking rules: segments, state machine, idle gaps, activities, privacy |
| `crates/application` | Ports, tracking engine, queries, commands, JSON export, backup and restore |
| `crates/adapters-sqlite` | SQLite schema, migrations and repositories |
| `crates/adapters-common` | Platform-neutral sampler core, idle edge detection, signal fan-out |
| `crates/adapters-macos` | NSWorkspace, Accessibility, idle, lock and permission adapters |
| `crates/adapters-windows` | Win32 foreground window, WinEvent hook, idle, lock and power adapters |
| `crates/adapters-linux` | X11 (`x11rb`) focus and idle, logind over D-Bus, Wayland detection |
| `src-tauri` | Tauri shell: composition, typed IPC, tray, windows, updater |
| `src` | React frontend: popover, main window, onboarding |
| `website` | Marketing landing page (Astro, isolated build), see [website/README.md](website/README.md) |

## Releases

Releases are built by `.github/workflows/release.yml` on `v*` tags. Signing, notarization and updater keys are described in [docs/release.md](docs/release.md).

The original Electron prototype is preserved at the `electron-final` tag.

## Contributing

Please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) before contributing.

## License

[MIT](LICENSE)
