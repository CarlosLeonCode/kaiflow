#!/usr/bin/env bash
# Builds Kaiflow (debug) as a .app, signs it with the stable self-signed identity
# "Kaiflow Dev" and installs it to ~/Applications.
#
# Why: macOS ties the Accessibility (TCC) grant to the code signature. An ad-hoc or changing
# signature loses the grant on every build; a stable identity keeps it. `tauri dev` cannot be
# used to test Accessibility because the grant goes to the terminal, not to the app.
#
# Create the identity once: see scripts/create-dev-identity.md.
#
# Usage: scripts/dev-sign.sh [--release]
set -euo pipefail

IDENTITY="${KAIFLOW_SIGNING_IDENTITY:-Kaiflow Dev}"
INSTALL_DIR="${HOME}/Applications"
PROFILE_ARGS=(--debug)
PROFILE_DIR="debug"
if [[ "${1:-}" == "--release" ]]; then
  PROFILE_ARGS=()
  PROFILE_DIR="release"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this script only runs on macOS" >&2
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -Fq "\"${IDENTITY}\""; then
  echo "error: no valid code signing identity named \"${IDENTITY}\" in your keychains." >&2
  echo "       Create it first: see scripts/create-dev-identity.md" >&2
  exit 1
fi

# The Tauri CLI reads the signing identity from this variable and applies the hardened
# runtime and Entitlements.plist configured in tauri.conf.json.
export APPLE_SIGNING_IDENTITY="$IDENTITY"

echo "==> Building the app bundle (${PROFILE_DIR})"
npx tauri build "${PROFILE_ARGS[@]}" --bundles app

BUNDLE_DIR="$ROOT/target/${PROFILE_DIR}/bundle/macos"
APP="$(find "$BUNDLE_DIR" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "$APP" ]]; then
  echo "error: no .app found in $BUNDLE_DIR" >&2
  exit 1
fi

echo "==> Verifying the signature of $(basename "$APP")"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvv "$APP" 2>&1 | grep -E "^(Identifier|Authority|Signature|CodeDirectory)" || true
echo "Designated requirement (must stay identical between builds to keep the TCC grant):"
codesign -d -r- "$APP" 2>&1 | grep -E "^designated" || true

echo "==> Installing to ${INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"
TARGET="$INSTALL_DIR/$(basename "$APP")"
# Quit a running instance so the bundle can be replaced.
osascript -e 'tell application id "com.carlosleon.kaiflow" to quit' >/dev/null 2>&1 || true
rm -rf "$TARGET"
ditto "$APP" "$TARGET"
codesign --verify --deep --strict "$TARGET"

echo "Installed: $TARGET"
echo "Next: open it, then grant Accessibility in System Settings > Privacy & Security."
