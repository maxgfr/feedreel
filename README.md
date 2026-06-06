# FeedReel

**Local-first generator of one daily vertical short video from RSS feeds.**
FeedReel turns RSS feeds into a single 1080×1920 vertical video (YouTube Shorts /
TikTok / Instagram Reels format), music only, with an auto "subscribe" outro — and
a ready-to-paste **title + description + hashtags** you post manually.

Everything runs locally. The pipeline pulls your RSS feeds, deduplicates against
past videos, and renders a fully code-generated video with
[Remotion](https://www.remotion.dev/). The editorial work (selecting items,
writing the script/title/description) is done by the bundled **Claude Code skill**.

|  |  |
|---|---|
| Output | one `output/<date>.mp4` (1080×1920 @ 30 fps, H.264/AAC) + `output/<date>.txt` |
| Rendering | [Remotion](https://www.remotion.dev/) (React/TSX), no external images |
| Audio | CC0 background music ([SoundSafari/CC0-1.0-Music](https://github.com/SoundSafari/CC0-1.0-Music)), fixed scene durations |
| Script & caption | written by the **`feedreel`** Claude Code skill |
| Publishing | none — you post the MP4 manually using the generated caption |

## How it works

```
feedreel prepare  → fetch RSS + dedup (SQLite) → cache/items/<date>.json   (local, deterministic)
   ↓  (the "feedreel" skill reads the items and writes the script)
cache/scripts/<date>.json   { date, title, description, hashtags, segments[intro,item…] }
   ↓
feedreel render   → music + Remotion → output/<date>.mp4
                                     → output/<date>.txt  (title + description + hashtags + sources)
                                     + prints the caption to the terminal
```

The closing "subscribe" scene is appended automatically — you don't write it.

## Requirements

- **macOS / Apple Silicon.**
- **Node.js >= 20** and **pnpm**.
- **ffmpeg / ffprobe** on the `PATH` (music trim + mux).
- **Claude Code** (to run the bundled skill).

## Installation

```bash
pnpm setup
```

`scripts/setup.sh` is **idempotent**: it checks Node >= 20, installs dependencies,
downloads the CC0 music tracks, vendors the OFL fonts, prepares the Remotion
headless browser, creates the working directories, and creates
`config/feedreel.yaml` from the example template if missing.

## Configuration (private)

Your feeds live in **`config/feedreel.yaml`**, which is **gitignored** (your RSS
feeds stay private). Start from the committed template:

```bash
cp config/feedreel.example.yaml config/feedreel.yaml   # then edit your feeds
```

The config describes a single video: format, language identity, editorial
identity (`label`, `emoji`, `accentColor`, `maxItems`, `subscribeText`), the
`feeds` list, the background `music`, and the `scene` durations
(`introSec` / `itemSec` / `outroSec`).

Keep alternate feed sets in their own gitignored files and switch with
`FEEDREEL_CONFIG`, e.g. `FEEDREEL_CONFIG=config/feedreel.tech.yaml pnpm feedreel prepare`.

## Usage

Just tell Claude Code **"generate me the video"** (or _"génère moi la vidéo"_). The
**`feedreel`** skill drives the whole flow locally: prepare → write the script →
render → report the MP4 and the copy-paste caption. Nothing leaves your machine
except fetching the RSS feeds.

Under the hood it runs two commands (both accept `--date YYYY-MM-DD`, default today):

```bash
# 1) Fetch + dedup today's items → cache/items/<date>.json
pnpm feedreel prepare

# 2) The skill reads the items and writes cache/scripts/<date>.json

# 3) Build the video + caption → output/<date>.mp4 + output/<date>.txt
pnpm feedreel render
```

Deduplication is persisted in SQLite (`feedreel.db`): items are marked seen only
after a successful `render`, so a second run on the same day won't repeat the same
news, while re-running `prepare` before rendering is safe.

## Configuration (environment variables)

All have defaults (see `config/index.ts`). Relative paths resolve from the project root.

| Variable | Default | Role |
|---|---|---|
| `FEEDREEL_CONFIG` | `config/feedreel.yaml` | Active config file |
| `FEEDREEL_OUTPUT_DIR` | `output` | Rendered videos directory |
| `FEEDREEL_CACHE_DIR` | `cache` | items / scripts / audio cache |
| `FEEDREEL_DB_PATH` | `feedreel.db` | SQLite dedup database |
| `FEEDREEL_MUSIC_TRACK` | (config) | Override the background track |
| `FEEDREEL_FPS` / `FEEDREEL_WIDTH` / `FEEDREEL_HEIGHT` | `30` / `1080` / `1920` | Video format |
| `FEEDREEL_FEED_TIMEOUT_MS` | `12000` | Per-feed RSS timeout (ms) |
| `FEEDREEL_LOG_FILE` | — | If set, also logs to this file |

## Project layout

```
feedreel/
  config/        feedreel.yaml (private) · feedreel.example.yaml · schema.ts · load.ts · index.ts
  src/
    types.ts · log.ts · exec.ts · util.ts · cli.ts
    pipeline/    fetchRss · dedup · script · music · render · orchestrate
    remotion/    FeedReelVideo.tsx · scenes/{Intro,Item,Outro} · components/* · theme · fonts
  scripts/       setup.sh · vendor-*.mjs
  .claude/skills/feedreel/   the skill that drives generation
```

## Licenses

| Component | License |
|---|---|
| TypeScript, Node, `tsx`, `vitest`, `rss-parser`, `better-sqlite3`, `zod`, `commander` | MIT |
| ffmpeg / ffprobe | LGPL |
| Remotion | source-available (free for solo use; see Remotion's terms) |
| Fonts **Unbounded**, **Hanken Grotesk**, **JetBrains Mono** | SIL Open Font License (OFL) |
| Music | CC0 (SoundSafari/CC0-1.0-Music) |
