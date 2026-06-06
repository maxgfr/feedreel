#!/usr/bin/env bash
#
# setup.sh — local installation of feedreel (macOS / Apple Silicon).
#
# Idempotent and tolerant: each step first checks what is already done
# and does not fail on a step that is already complete.
#
# The default audio mode is "music" (royalty-free music, NO voice):
# voice (TTS) setup is therefore OPTIONAL (only if FEEDREEL_SETUP_VOICE=1).
#
# Steps:
#   1. Check Node >= 20.
#   2. pnpm install (JS dependencies).
#   3. node scripts/vendor-music.mjs (CC0 tracks → assets/music/) — for music mode.
#   4. node scripts/vendor-fonts.mjs (OFL fonts → public/fonts/).
#   5. pnpm exec remotion browser ensure (headless Chromium for rendering).
#   6. [OPTIONAL, FEEDREEL_SETUP_VOICE=1] Piper venv + FR voice, kokoro-mlx, espeak-ng.
#   7. Create the working directories.
#
# Usage: bash scripts/setup.sh            (music mode, default)
#        FEEDREEL_SETUP_VOICE=1 bash scripts/setup.sh   (+ TTS voice engines)

set -euo pipefail

# Project root: this script lives in <root>/scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

VENV_DIR="$PROJECT_ROOT/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"

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

# --- 3. CC0 music (default audio mode) --------------------------------------
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

# --- 6. Voice-over (OPTIONAL — "voice" audio mode only) ---------------------
# The default mode is "music"; the TTS voice is only installed when requested.
if [ "${FEEDREEL_SETUP_VOICE:-}" = "1" ]; then
  if ! command -v uv >/dev/null 2>&1; then
    warn "\`uv\` not found: cannot create the TTS venvs. Install uv (https://docs.astral.sh/uv/)."
  else
    # Piper (default FR voice engine, MIT/ONNX) + upmc voice.
    PIPER_VENV="$PROJECT_ROOT/.venv-piper"
    if [ ! -x "$PIPER_VENV/bin/python" ]; then
      log "Creating the Piper venv + installing piper-tts…"
      uv venv --python 3.12 "$PIPER_VENV"
      uv pip install --python "$PIPER_VENV/bin/python" piper-tts
    fi
    log "Downloading the Piper FR voice (voices/)…"
    mkdir -p "$PROJECT_ROOT/voices"
    PV_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/upmc/medium"
    for ext in onnx onnx.json; do
      [ -f "$PROJECT_ROOT/voices/fr_FR-upmc-medium.$ext" ] || \
        curl -fsSL -o "$PROJECT_ROOT/voices/fr_FR-upmc-medium.$ext" "$PV_BASE/fr_FR-upmc-medium.$ext" \
        || warn "Failed to download Piper voice ($ext)."
    done
    # kokoro-mlx (alternative voice engine, e.g. EN languages) + espeak-ng.
    if [ ! -x "$VENV_PYTHON" ]; then
      log "Creating the kokoro-mlx venv (alternative voice)…"
      uv venv --python 3.12 "$VENV_DIR"
      uv pip install --python "$VENV_PYTHON" kokoro-mlx
    fi
    if ! command -v espeak-ng >/dev/null 2>&1; then
      if command -v brew >/dev/null 2>&1; then brew install espeak-ng || warn "brew espeak-ng failed"; \
      else warn "Homebrew missing: install espeak-ng manually (required by kokoro FR)."; fi
    fi
    log "Voice engines ready (enable voice mode: audio.mode=voice in config/feedreel.yaml)."
  fi
else
  log "Voice mode not requested (music default). To install it: FEEDREEL_SETUP_VOICE=1 bash scripts/setup.sh"
fi

# --- 7. Working directories --------------------------------------------------
log "Creating the working directories…"
mkdir -p "$PROJECT_ROOT/output" \
         "$PROJECT_ROOT/cache" \
         "$PROJECT_ROOT/logs" \
         "$PROJECT_ROOT/public/fonts" \
         "$PROJECT_ROOT/assets/music"

log "Setup complete. Useful commands: pnpm feedreel run --help"
