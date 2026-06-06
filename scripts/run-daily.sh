#!/usr/bin/env bash
#
# run-daily.sh — autonomous daily run of feedreel.
#
# Launched by launchd (com.feedreel.daily.plist) every day at 07:00.
# Generates the 6 videos in autonomous mode (`claude -p`) without intervention.
# Logs timestamped start/end into logs/veille-<date>.log (via FEEDREEL_LOG_FILE,
# which the Node logger — src/log.ts — relays into that file).
#
# Fault tolerance: the orchestrator isolates errors per category
# (a failing category does not stop the others).

set -uo pipefail

# Project root: this script lives in <root>/scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# --- PATH hardening (launchd starts with a minimal environment) ---
# Without this, node / npx / claude / ffmpeg (Homebrew + fnm) would not be found.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# Node via fnm: honors .node-version (20.17.0, ABI used by better-sqlite3).
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env 2>/dev/null)" || true
  fnm use --install-if-missing >/dev/null 2>&1 || true
fi
# Fallback: stable path of the fnm node if node remains undetectable.
if ! command -v node >/dev/null 2>&1; then
  NODE_BIN="$(ls -d "$HOME"/.local/share/fnm/node-versions/v20*/installation/bin 2>/dev/null | tail -1)"
  [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi

DATE="$(date +%F)"            # YYYY-MM-DD
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

# The Node logger also writes into this file (see src/log.ts).
export FEEDREEL_LOG_FILE="$LOG_DIR/veille-$DATE.log"

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

{
  echo "$(stamp) [run-daily] start — date=$DATE project=$PROJECT_ROOT"
} | tee -a "$FEEDREEL_LOG_FILE"

# Full run in autonomous mode (script generated via claude -p).
# --publish: attempts social publishing AFTER rendering, but ONLY if
# config/publish.yaml has `enabled: true` (otherwise the step is skipped). Opt-in, private
# by default; platforms without credentials are skipped cleanly.
pnpm exec tsx src/cli.ts run --mode auto --publish
STATUS=$?

{
  echo "$(stamp) [run-daily] end — exit code=$STATUS"
} | tee -a "$FEEDREEL_LOG_FILE"

exit "$STATUS"
