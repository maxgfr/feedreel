---
name: feedreel
description: >-
  Generate the daily short video locally from the project's RSS feeds. Use this
  whenever the user asks to make/generate/produce the video — e.g. "generate me
  the video", "génère moi la vidéo", "fais la vidéo du jour", "make today's
  video" (optionally for a given date). It prepares the items, YOU write the
  script + title + description + hashtags as JSON, then it renders one vertical
  MP4 (music only) with an auto "subscribe" outro plus a copy-paste caption to
  post manually. Everything runs locally; no network beyond fetching the feeds.
---

# Skill: feedreel (daily video)

You drive the `feedreel` pipeline to produce **one vertical video** from the
project's RSS feeds. The pipeline is local and deterministic; **you** do the
editorial work (selecting items and writing the script, title, description and
hashtags). Music only — there is no voice-over.

All paths are relative to the project root. `<date>` is `YYYY-MM-DD` (default: today).

## Procedure

### 1. Prepare the items (RSS fetch + deduplication)

```bash
pnpm feedreel prepare
```

This fetches the feeds, deduplicates against past videos, and writes:

```
cache/items/<date>.json
```

Each item has: `title`, `url`, `summary`, `source`, `publishedAt`.
If the file has `[]` (no new item), tell the user there is nothing fresh to make
a video from today, and stop.

### 2. Write the video script

Read `cache/items/<date>.json`, then write `cache/scripts/<date>.json`.

- Read `config/feedreel.yaml` to know `video.maxItems`, `video.label` and the
  `language` block.
- **Output language** = `language.name`. Write EVERYTHING (title, headlines,
  bodies, description, hashtags, commentPrompt) in that language.
- **Geographic scope** = `language.region` (separate from the language):
  - `int` or `international` → worldwide: pick results/news from every country and
    confederation, a globally representative spread. Do NOT over-index on one
    nation just because of the output language.
  - any other value (e.g. `France`, `England`, `US`) → focus on that country/region.
  - If `region` is missing, default to `int` (worldwide).
- Select and **rank** the items by importance/appeal; keep at most `maxItems`.
- Filter out noise and near-duplicates.

#### Strict script schema (follow exactly)

Pure JSON. No surrounding text, no markdown, no emoji inside the text fields.

```json
{
  "date": "<date>",
  "title": "Catchy on-screen video title",
  "description": "2–4 sentence social caption that hooks and summarizes.",
  "hashtags": ["#football", "#…"],
  "commentPrompt": "Short question tied to a real story of the day, ending with 👇",
  "segments": [
    { "type": "intro", "hook": "1–2 punchy on-screen sentences." },
    {
      "type": "item",
      "headline": "Displayed title (<= 60 characters)",
      "body": "Displayed detail (<= 140 characters)",
      "url": "https://…",
      "source": "example.com"
    },
    {
      "type": "item",
      "home": "France", "away": "Spain",
      "homeScore": 2, "awayScore": 1,
      "competition": "International friendly",
      "body": "Optional one-line context shown under the scoreboard.",
      "url": "https://…",
      "source": "example.com"
    }
  ]
}
```

Rules:
- Exactly **one** `intro` at the top, then **one** `item` per selected news (≤ `maxItems`).
- Do **not** add an outro — the pipeline appends the "subscribe" scene automatically.
- **Scoreboard items (prefer for match results/fixtures):** set both `home` and
  `away` to render a clean scoreboard instead of a text card. Add `homeScore` +
  `awayScore` (integers) to show a **result** — the winner is highlighted; omit
  them to show an upcoming **fixture** (VS). `competition` is an optional label
  above the score (e.g. "World Cup warm-up", "Friendly · FT"). When you use a
  scoreboard you can drop `headline` (the teams are the title); keep `body` for a
  short context line. NEVER invent a scoreline — only add scores you can back from
  the source. Use a plain `headline`/`body` item for non-match stories (round-ups,
  transfers, analysis).
- `headline` ≤ 60 characters, `body` ≤ 140 characters.
- `url` and `source` copied faithfully from the source item.
- `date` matches the file.
- `hashtags`: 8–15 relevant, language-appropriate tags, each starting with `#`, no spaces.
- `commentPrompt` (recommended): ONE short comment-bait question, **tied to a real
  story you selected today** (name the actual subject), ≤ ~90 characters, ending
  with a 👇-style nudge. It is displayed on the closing scene to push viewers to
  reply. Stay true — never invent facts. Omit the field if nothing fits.

#### Editorial tone

- `title` and each `headline` must **hook** — punchy, curiosity-driven, the catchy
  tone of L'Equipe / Eurosport (slightly "clickbait").
- **Stay true**: never invent facts, numbers, names or quotes. The headline must be
  backed by the item.
- `body` and `description` stay factual and informative — they deliver what the
  headline promises.

### 3. Render the video + caption

```bash
pnpm feedreel render
```

Reads your script, fits the background music, renders the MP4 (intro + items +
auto subscribe outro), and writes the copy-paste caption.

Outputs:

```
output/<date>.mp4    the video to upload
output/<date>.txt    title + description + hashtags + source links (copy-paste)
```

### 4. Report

Give the user the absolute path of `output/<date>.mp4` and print the contents of
`output/<date>.txt` so they can copy the title/description/hashtags into their
social posts.

## Notes

- A specific date: append `--date YYYY-MM-DD` to both `prepare` and `render`.
- Switch feed set: `FEEDREEL_CONFIG=config/feedreel.tech.yaml pnpm feedreel prepare`.
- Dedup is persisted in `feedreel.db`: items are marked seen only after a
  successful `render`, so re-running `prepare` before rendering is safe.
