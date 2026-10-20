# feedreel

Local-first generator of one daily vertical short video (1080×1920) from RSS feeds: `pnpm feedreel
prepare` fetches and deduplicates items, the `feedreel` skill writes the script, `pnpm feedreel
render` builds the MP4 with Remotion plus the caption. See `README.md` for setup, configuration and
layout. Checks: `pnpm typecheck` and `pnpm test`.

## Skills
- `skills/feedreel/SKILL.md` — generate a daily short video from RSS feeds with a written script, rendered MP4, and publication caption. Use it only when the user asks for it (read the file and follow it).

Install it for your agent with `npx skills add .` (pick the agent, or `-a <agent>`). Users install
the published skill with `npx skills add maxgfr/feedreel`.
