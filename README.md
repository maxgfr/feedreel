# FeedReel

**Local-first generator of daily tech-watch short videos.** FeedReel turns RSS
tech feeds into vertical 1080×1920 videos (YouTube Shorts / TikTok / Instagram
Reels format), writes per-platform captions & hashtags, and can publish them
automatically — all driven by code, running on your machine.

Every day the pipeline pulls RSS feeds across several tech categories, selects
the fresh items (with deduplication), writes a short video script, adds a
royalty-free background track (CC0), and renders a fully code-generated vertical
video with [Remotion](https://www.remotion.dev/). Everything runs locally; the
only outbound steps are the script/caption writing (delegated to Claude, isolated
in a single module) and the optional publishing step.

|  |  |
|---|---|
| Format | 1080×1920 @ 30 fps, MP4 H.264 / AAC |
| Categories | `global`, `ia`, `typescript`, `java`, `rust`, `securite` (editable in `config/feedreel.yaml`) |
| Rendering | [Remotion](https://www.remotion.dev/) (React/TSX) |
| Audio (default) | CC0 background music ([SoundSafari/CC0-1.0-Music](https://github.com/SoundSafari/CC0-1.0-Music)), fixed scene durations |
| Voice-over (optional) | Piper (`fr_FR-upmc`, MIT) or Kokoro-MLX — dedicated Python venv |
| Script & captions | Claude (file-handoff or autonomous `claude -p`) |
| Languages | configurable multilingual (FR default, EN provided) |
| Publishing | opt-in: YouTube Shorts, TikTok, Instagram Reels (auto captions + token refresh) |
| Scheduling | launchd (macOS) at 07:00 |

> **Audio.** By default videos are **music-only (no voice)** — configurable in
> `config/feedreel.yaml` (`audio.mode`). A TTS voice-over remains available
> (`audio.mode: voice`, Piper or Kokoro-MLX engines).

## Features

- **Local-first.** Feeds, dedup, TTS, audio mux and rendering all run on your
  machine. The only outbound calls are the Claude script/caption step and the
  optional publishing step — both isolated in dedicated modules.
- **Code-generated visuals.** No external images or video; everything is drawn
  with Remotion. OFL fonts are vendored locally at setup.
- **Resilient by design.** Categories are processed sequentially with per-item
  error isolation: a failing feed or category never stops the others.
- **Multilingual & scalable.** One language drives the Claude prompt, the voice,
  the on-screen labels and the date format. Add a language = add one entry in
  `config/feedreel.yaml`; no code changes.
- **Opt-in social publishing.** Per-platform captions/hashtags, dry-run preview,
  SQLite idempotency registry, and automatic OAuth token refresh for hands-off
  daily operation.

## Requirements

- **macOS / Apple Silicon.**
- **Node.js >= 20** and **pnpm**.
- **ffmpeg / ffprobe** on the `PATH` (music trim + mux).
- **Claude Code** (the `claude` CLI) for autonomous script/caption writing.
- *(voice option)* **[uv](https://docs.astral.sh/uv/)** for the TTS venvs,
  **Homebrew** for `espeak-ng`.

## Installation

```bash
pnpm setup                            # music mode (default)
FEEDREEL_SETUP_VOICE=1 pnpm setup     # + TTS voice engines (optional)
```

`scripts/setup.sh` is **idempotent**. It checks Node >= 20, installs
dependencies, downloads the CC0 music tracks, vendors the OFL fonts, prepares the
Remotion headless browser, optionally sets up the TTS venvs, and creates the
working directories (`output/`, `cache/`, `logs/`, …).

## Usage (CLI)

The binary is exposed via `pnpm feedreel <command>` (or `pnpm exec tsx src/cli.ts`).
With pnpm, pass arguments **without** `--` (e.g. `pnpm feedreel run --mode auto`).

```bash
# Fetch + dedup + cache today's items (cache/items/<date>/<cat>.json)
pnpm feedreel prepare

# Full pipeline (prepare → script → audio → render) for all categories
pnpm feedreel run --mode auto         # script written via claude -p (autonomous)
pnpm feedreel run --mode file         # manual script writing (file handoff)

# Target a category / date, or skip rendering
pnpm feedreel run --category ia --date 2026-06-05
pnpm feedreel run --no-render         # stop before the Remotion render
```

Outputs: `output/<date>/<cat>.mp4`. Intermediate caches: `cache/items/`,
`cache/scripts/`, `cache/audio/`, `cache/metadata/`.

Deduplication is persisted in SQLite (`feedreel.db`): a second run on the same
day won't repeat the same news. A category with no new item is **skipped**; a
category that errors is logged and **does not stop** the others.

## How it works

```
feedreel prepare  → fetch RSS + dedup → cache/items/<date>/<cat>.json   (local, deterministic)
   ↓
summarize         → validated JSON script: (a) read from a handoff file, OR
                    (b) generated via `claude -p` → cache/scripts/<date>/<cat>.json
   ↓
build             → TTS/music + ffprobe + concat + Remotion render       (local, deterministic)
   ↓
output/<date>/<cat>.mp4
   ↓ (optional, opt-in)
captions + publish → cache/metadata/<date>/<cat>.json → YouTube / TikTok / Instagram
```

## Publishing (opt-in)

After rendering, FeedReel can publish the vertical videos to **YouTube Shorts**,
**TikTok** and **Instagram Reels**, with **titles / descriptions / hashtags
generated per platform, in each category's language**.

> **Local-first preserved.** Publishing is the only *outbound* step: it is
> **strictly opt-in**, isolated in `src/publish/`, and its cloud dependencies are
> lazily imported (the offline pipeline never loads them). Nothing is published
> without an explicit `feedreel publish` (or the daily job with `enabled: true`).
> Without credentials, each platform is **skipped cleanly**.

```bash
# 1) Generate captions (titles/descriptions/hashtags) → cache/metadata/<date>/<cat>.json
pnpm feedreel captions --date 2026-06-05
pnpm feedreel captions --category rust --platforms yt,tt   # targeted

# 2) Preview WITHOUT publishing (no network calls)
pnpm feedreel publish --date 2026-06-05 --dry-run

# 3) Publish (once credentials are set; private by default)
pnpm feedreel publish --date 2026-06-05 --platforms yt,tt,ig
pnpm feedreel publish --privacy unlisted --force           # overrides
```

The daily job publishes automatically after rendering **only if**
`config/publish.yaml` has `enabled: true` (`scripts/run-daily.sh` runs
`run --mode auto --publish`).

**Configuration & secrets**

- `config/publish.yaml` (optional, non-sensitive) — active platforms, default
  privacy, hosting, per-language overrides. Template: `config/publish.yaml.example`.
- `.env` (gitignored) — OAuth secrets. Template: `.env.example`.
- **Idempotency**: a SQLite `published` registry prevents double-posting
  (`--force` to override).

**Hands-off token refresh.** YouTube uses a permanent OAuth refresh token
(auto-refreshed per call). TikTok (~24 h) and Instagram (~60 d) tokens are
**refreshed automatically** when refresh credentials are provided, persisted in a
gitignored store (`cache/publish/tokens.json`); otherwise the static token is
used as a fallback.

**Multilingual / scalable.** Captions follow each category's language
(`config/feedreel.yaml` → `languages` + `category.language`). To post FR and EN
to different accounts, a language-suffixed secret takes precedence:
`YT_REFRESH_TOKEN_EN` wins over `YT_REFRESH_TOKEN` (automatic fallback).

➡️ **Step-by-step credential setup** (YouTube, TikTok, Meta/Instagram, Cloudflare
R2): see **[`docs/publish-setup.md`](docs/publish-setup.md)**.

## Scheduling (launchd, macOS)

The daily job runs `scripts/run-daily.sh` (which executes `run --mode auto
--publish` and logs start/end to `logs/feedreel-<date>.log`) every day at **07:00**.

```bash
# 1. Install the agent, replacing the __PROJECT_DIR__ placeholder with the project root:
sed "s#__PROJECT_DIR__#$PWD#g" launchd/com.feedreel.daily.plist \
  > ~/Library/LaunchAgents/com.feedreel.daily.plist

# 2. Load the agent:
launchctl load ~/Library/LaunchAgents/com.feedreel.daily.plist

# Unload (to disable):
launchctl unload ~/Library/LaunchAgents/com.feedreel.daily.plist
```

## Configuration (environment variables)

All options have defaults (see `config/index.ts`). Relative paths are resolved
from the project root.

| Variable | Default | Role |
|---|---|---|
| `FEEDREEL_OUTPUT_DIR` | `output` | Rendered videos directory |
| `FEEDREEL_CACHE_DIR` | `cache` | items / scripts / audio / metadata cache |
| `FEEDREEL_DB_PATH` | `feedreel.db` | SQLite dedup + publish registry |
| `FEEDREEL_CONFIG` | `config/feedreel.yaml` | Editable app config path |
| `FEEDREEL_PUBLISH_CONFIG` | `config/publish.yaml` | Publishing config path |
| `FEEDREEL_VOICE` | `ff_siwis` | Kokoro voice |
| `FEEDREEL_PYTHON` | `.venv/bin/python` | TTS venv Python |
| `FEEDREEL_CLAUDE_BIN` | `claude` | Claude CLI binary (autonomous mode) |
| `FEEDREEL_FPS` / `FEEDREEL_WIDTH` / `FEEDREEL_HEIGHT` | `30` / `1080` / `1920` | Video format |
| `FEEDREEL_FEED_TIMEOUT_MS` | `12000` | Per-feed RSS timeout (ms) |
| `FEEDREEL_LOG_FILE` | — | If set, also logs to this file (used by `run-daily.sh`) |

## Project layout

```
feedreel/
  config/        categories + feeds + languages + audio (feedreel.yaml) · publish.ts · index.ts
  src/
    types.ts · log.ts · exec.ts · util.ts · cli.ts
    pipeline/    fetchRss · dedup · summarize · tts · music · render · orchestrate
    publish/     captions · youtube · tiktok · instagram · hosting · registry · tokens · orchestrate
    remotion/    FeedReelVideo.tsx · scenes/* · components/* · theme · fonts
  scripts/       setup.sh · run-daily.sh · tts.py · vendor-*.mjs
  launchd/       com.feedreel.daily.plist
  docs/          publish-setup.md
```

## Licenses

| Component | License |
|---|---|
| TypeScript, Node, `tsx`, `vitest`, `rss-parser`, `better-sqlite3`, `zod`, `commander` | MIT |
| `@googleapis/youtube`, `google-auth-library`, `@aws-sdk/*` | Apache-2.0 |
| `dotenv` | BSD-2 |
| Kokoro-MLX | Apache-2.0 |
| ffmpeg / ffprobe | LGPL |
| Remotion | source-available (free for solo use; see Remotion's terms) |
| Fonts **Unbounded**, **Hanken Grotesk**, **JetBrains Mono** | SIL Open Font License (OFL) |

## Notes & limits (16 GB memory budget)

- Categories are processed **sequentially** and Remotion render concurrency is
  bounded (≈ 2) to stay within a **16 GB** memory budget.
- Autonomous mode needs the `claude` CLI configured and network access for the
  script/caption step only.
- First run downloads: the Kokoro model (Hugging Face) and the headless Chromium
  (Remotion). Afterwards everything runs offline (except autonomous writing).
