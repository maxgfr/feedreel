---
name: feedreel
description: >-
  Generates the daily tech-watch videos (FR) in file handoff mode: prepares the
  RSS items, you write the per-category JSON video script yourself, then it
  renders the MP4s via the local pipeline (Remotion + Kokoro TTS). Use this skill
  when the user wants to produce/update the tech-watch videos by hand, category
  by category, without invoking the autonomous mode.
---

# Skill: feedreel (file handoff mode)

You drive the `feedreel` pipeline in **file handoff mode**: YOU write the
video script for each category (Claude writes outside the pipeline), then the local
pipeline synthesizes the voice and renders the video. No network step is performed by the
pipeline in this mode (`--mode file` generates nothing on its own: it reads the scripts you wrote).

All paths are relative to the project root. The date `<date>` uses the `YYYY-MM-DD` format.

## Procedure

### 1. Prepare the items (RSS fetch + deduplication)

```bash
pnpm feedreel prepare
```

This fetches the feeds, deduplicates and writes, for each category that has items:

```
cache/items/<date>/<cat>.json
```

The categories are: `global`, `ia`, `typescript`, `java`, `rust`, `securite`.
A category with no new item will have no file (it will be skipped).

### 2. Write the video script for each category

For **each** category that has a `cache/items/<date>/<cat>.json` file:

1. Read the items JSON (title, source, url, summary, date).
2. Write a video script yourself in **French**, factual and concise: filter out noise
   and duplicates, rank items from most to least important.
3. Write the result to:

   ```
   cache/scripts/<date>/<cat>.json
   ```

#### STRICT script schema (to follow exactly)

Pure JSON, **no** surrounding text, **no** markdown or emoji INSIDE the text:

```json
{
  "category": "<cat>",
  "date": "<date>",
  "title": "Video title (short, catchy)",
  "segments": [
    { "type": "intro", "narration": "Spoken hook, 1 to 2 sentences." },
    {
      "type": "item",
      "headline": "Displayed title (<= 60 characters)",
      "body": "Displayed detail (<= 140 characters)",
      "narration": "1 to 3 natural spoken sentences.",
      "url": "https://…",
      "source": "example.com"
    }
  ]
}
```

Rules:
- Exactly **one** `intro` segment at the top, then **one** `item` segment per selected news item.
- Do not exceed the category's `maxItems` (at most the number of items provided).
- `headline` <= 60 characters, `body` <= 140 characters, `narration` = 1 to 3 spoken sentences.
- `url` and `source` copied faithfully from the source item.
- `category` and `date` must match the file (`<cat>` and `<date>`).

> The pipeline validates these scripts via a strict zod schema; an invalid JSON skips
> the category. Take care to respect the fields and the limits.

### 3. Build the videos (TTS + render)

```bash
pnpm feedreel run --mode file
```

In `--mode file`, the pipeline **reads** the scripts you wrote (it generates nothing on its own),
synthesizes the FR voice (Kokoro), concatenates the audio and renders each MP4. A category with no
written script is skipped; a failing category does not stop the others.

### 4. Report the output paths

Tell the user the videos produced:

```
output/<date>/<cat>.mp4
```

Explicitly list the generated files (absolute paths) and flag the categories
skipped or in error.

## Autonomous mode (alternative, no manual writing)

For fully automatic generation (the pipeline writes the scripts via `claude -p`
in headless mode), use:

```bash
pnpm feedreel run --mode auto
```

This is the mode used by the daily `launchd` job (07:00). Prefer the **file handoff
mode** above when you want to control/refine the editorial content yourself.

## (Optional) Social publishing

Once the videos are rendered, you can generate per-platform captions and then publish
(opt-in, isolated, never triggered without an explicit command):

```bash
pnpm feedreel captions --date <date>            # → cache/metadata/<date>/<cat>.json (per language)
pnpm feedreel publish  --date <date> --dry-run  # previews without any network call
pnpm feedreel publish  --date <date>            # publishes (private by default), if credentials present
```

As with the scripts, captions have a **file handoff mode** (`--mode file`):
you can write `cache/metadata/<date>/<cat>.json` yourself (`VideoMeta` schema:
`{ language, youtube?, tiktok?, instagram?: { title, description, hashtags[] } }`) before
`feedreel publish`. Without credentials (`.env`), each platform is **skipped cleanly**.
Configuration: `config/publish.yaml`; credential setup: `docs/publish-setup.md`.
