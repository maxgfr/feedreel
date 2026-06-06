/**
 * Script step: reads and validates the video script written by the skill.
 *
 * The editorial work (selecting items, writing the title/description/hashtags and
 * the segments) is done by the Claude Code skill, which writes a JSON file. This
 * module only READS and VALIDATES it (zod) — no network, no generation.
 */
import fs from 'node:fs';
import { z } from 'zod';
import type { VideoScriptInput } from '../types';

/**
 * Zod schema for a script segment.
 * `hook` (intro), `headline`/`body`/`url`/`source` (item) are optional: the
 * scenes render defensively when a field is missing.
 */
const ScriptSegmentSchema = z.object({
  type: z.enum(['intro', 'item']),
  hook: z.string().optional(),
  headline: z.string().optional(),
  body: z.string().optional(),
  url: z.string().optional(),
  source: z.string().optional(),
});

/** Zod schema for the video script written by the skill. */
export const VideoScriptSchema: z.ZodType<VideoScriptInput> = z.object({
  date: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  hashtags: z.array(z.string()),
  segments: z.array(ScriptSegmentSchema).min(1),
});

/**
 * Parses a raw output (possibly wrapped in markdown fences or stray text)
 * into a validated VideoScriptInput.
 *
 * Steps: strip ```...``` fences → extract from the first `{` to the last `}`
 * → `JSON.parse` → zod validation. Throws a clear Error if any step fails.
 */
export function parseScriptJson(raw: string): VideoScriptInput {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('parseScriptJson: empty input.');
  }

  const withoutFences = raw.replace(/```(?:json)?/gi, '');
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('parseScriptJson: no JSON object detected in the input.');
  }
  const jsonText = withoutFences.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`parseScriptJson: invalid JSON (${String(e)}).`);
  }

  const result = VideoScriptSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `parseScriptJson: script does not conform to the schema — ${result.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join(' ; ')}`,
    );
  }
  return result.data;
}

/**
 * Reads and validates the script the skill wrote at `scriptFile`.
 * Throws a clear, actionable error if the file is missing or invalid.
 */
export function loadScript(scriptFile: string): VideoScriptInput {
  let raw: string;
  try {
    raw = fs.readFileSync(scriptFile, 'utf8');
  } catch {
    throw new Error(
      `No script found at ${scriptFile}. Write it first (see the "feedreel" skill), then run "feedreel render".`,
    );
  }
  return parseScriptJson(raw);
}

/**
 * Builds the copy-paste caption (title + description + hashtags + source links)
 * written next to the MP4 for manual posting. PURE.
 */
export function buildCaption(script: VideoScriptInput): string {
  const sources = script.segments
    .filter((s) => s.type === 'item' && typeof s.url === 'string' && s.url !== '')
    .map((s) => `- ${s.source ?? ''} : ${s.url}`);

  const blocks = [script.title.trim(), script.description.trim()];
  if (script.hashtags.length > 0) blocks.push(script.hashtags.join(' '));
  if (sources.length > 0) blocks.push(['Sources:', ...sources].join('\n'));
  return blocks.filter((b) => b.length > 0).join('\n\n') + '\n';
}
