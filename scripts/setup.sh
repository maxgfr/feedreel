#!/usr/bin/env bash
#
# setup.sh — local installation of feedreel (macOS / Apple Silicon).
#
# Idempotent and tolerant: each step first checks what is already done
# and does not fail on a step that is already complete.
#
# Steps:
#   1. Check Node >= 20.
#   2. pnpm install (JS dependencies).
#   3. node scripts/vendor-music.mjs (CC0 tracks → assets/music/).
#   4. node scripts/vendor-fonts.mjs (OFL fonts → public/fonts/).
#   5. pnpm exec remotion browser ensure (headless Chromium for rendering).
#   6. Create the working directories + the active config (if missing).
#
# Usage: bash scripts/setup.sh

set -euo pipefail

# Project root: this script lives in <root>/scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup][warn]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[setup][error]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. Node >= 20 -----------------------------------------------------------
log "Checking Node.js (>= 20 required)…"
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js not found. Install Node >= 20 (https://nodejs.org) then re-run."
fi
NODE_RAW="$(node -v)"                 # e.g. v20.11.1
NODE_MAJOR="${NODE_RAW#v}"            # 20.11.1
NODE_MAJOR="${NODE_MAJOR%%.*}"        # 20
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node $NODE_RAW detected; version >= 20 required."
fi
log "Node $NODE_RAW OK."

# --- 2. JS dependencies ------------------------------------------------------
log "Installing dependencies (pnpm)…"
pnpm install
log "pnpm dependencies installed."

# --- 3. CC0 music ------------------------------------------------------------
log "Downloading CC0 music tracks (assets/music/)…"
if ! node scripts/vendor-music.mjs; then
  warn "vendor-music reported a problem; re-run \`node scripts/vendor-music.mjs\`, or drop your own tracks into assets/music/."
fi

# --- 4. OFL fonts ------------------------------------------------------------
log "Vendoring fonts (public/fonts/)…"
if ! node scripts/vendor-fonts.mjs; then
  warn "vendor-fonts reported a problem; re-run \`node scripts/vendor-fonts.mjs\` later."
fi

# --- 5. Headless Chromium for Remotion --------------------------------------
log "Preparing the Remotion headless browser…"
if ! pnpm exec remotion browser ensure; then
  warn "\`pnpm exec remotion browser ensure\` failed; video rendering might require a retry."
fi

# --- 6. Working directories + active config ----------------------------------
log "Creating the working directories…"
mkdir -p "$PROJECT_ROOT/output" \
         "$PROJECT_ROOT/cache" \
         "$PROJECT_ROOT/logs" \
         "$PROJECT_ROOT/public/fonts" \
         "$PROJECT_ROOT/assets/music"

if [ ! -f "$PROJECT_ROOT/config/feedreel.yaml" ]; then
  log "Creating config/feedreel.yaml from the example template…"
  cp "$PROJECT_ROOT/config/feedreel.example.yaml" "$PROJECT_ROOT/config/feedreel.yaml"
  warn "Edit config/feedreel.yaml with your own RSS feeds (it is gitignored)."
fi

log "Setup complete. Next: pnpm feedreel prepare  (then use the \"feedreel\" skill)."
