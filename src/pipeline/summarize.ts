/**
 * "summarize" step of the pipeline (PRD §11).
 *
 * Transforms a list of RSS items into a validated JSON video script (VideoScriptInput).
 * Two modes:
 *   - `file`: reads/validates an already-written JSON (by a Claude Code skill), NO network;
 *   - `auto`: generates the JSON via the `claude -p` CLI (headless mode), with a single retry.
 *
 * Strict validation via zod: any JSON that does not match the schema is rejected.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type {
  CategoryConfig,
  GlobalConfig,
  RssItem,
  VideoScriptInput,
} from '../types';
import { paths, resolveLanguage } from '../../config/index';
import { ensureDir } from '../util';
import { exec } from '../exec';
import { createLogger } from '../log';

const log = createLogger('summarize');

/** Script generation mode. */
export type SummarizeMode = 'file' | 'auto';

/** Timeout for a `claude -p` call (ms). */
const CLAUDE_TIMEOUT_MS = 180_000;

/** Maximum number of `claude -p` attempts (tolerance for transient API errors). */
const MAX_CLAUDE_ATTEMPTS = 3;

/**
 * Zod schema for a script segment (ScriptSegmentInput).
 * `narration` is always required; `headline`/`body`/`url`/`source` are optional
 * (and only make sense for `item` segments).
 */
const ScriptSegmentSchema = z.object({
  type: z.enum(['intro', 'item']),
  headline: z.string().optional(),
  body: z.string().optional(),
  narration: z.string().min(1),
  url: z.string().optional(),
  source: z.string().optional(),
});

/**
 * Zod schema for the video script produced by Claude (VideoScriptInput).
 * The cast guarantees exact alignment with the shared contract `src/types.ts`.
 */
export const VideoScriptSchema: z.ZodType<VideoScriptInput> = z.object({
  category: z.string().min(1),
  date: z.string().min(1),
  title: z.string().min(1),
  segments: z.array(ScriptSegmentSchema).min(1),
});

/**
 * Builds the strict prompt for `claude -p` (instructions §11).
 * Expected output: STRICT JSON only, with no surrounding text or markdown.
 */
export function buildPrompt(
  category: CategoryConfig,
  items: RssItem[],
  date: string,
  languageName = 'français',
): string {
  const LANG = languageName.toUpperCase();
  const list = items
    .map(
      (it, i) =>
        `${i + 1}. ${it.title}\n   source: ${it.source}\n   url: ${it.url}\n   summary: ${it.summary}`,
    )
    .join('\n');

  return [
    `You are a tech journalist. You are writing, IN ${LANG}, the script of a short tech-watch video for the category "${category.label}" (date: ${date}).`,
    '',
    'Strict instructions:',
    '- Reply ONLY with valid STRICT JSON: no text before or after, no markdown block, no comments.',
    `- All editorial content (title, headline, body, narration) is written in ${LANG}, in a factual and concise way.`,
    '- Do not use markdown or emoji INSIDE the texts (title, headline, body, narration fields).',
    `- Select and RANK the items by importance, then keep at most ${category.maxItems} items (maxItems = ${category.maxItems}).`,
    '- Filter out noise and duplicates; ignore irrelevant topics.',
    '',
    'Expected JSON structure:',
    '{',
    `  "category": "${category.id}",`,
    `  "date": "${date}",`,
    '  "title": "<a catchy video title>",',
    '  "segments": [',
    '    { "type": "intro", "narration": "<a spoken hook of 1 to 2 sentences>" },',
    '    { "type": "item", "headline": "<≤ 60 characters>", "body": "<≤ 140 characters>", "narration": "<1 to 3 natural spoken sentences>", "url": "<item url>", "source": "<item source>" }',
    '  ]',
    '}',
    '',
    'Content rules:',
    "- The first segment MUST be an intro segment `{type:'intro', narration}` (1 to 2 hook sentences).",
    `- Then, one \`{type:'item'}\` segment per selected item (at most ${category.maxItems}), ranked by importance.`,
    '- For each item: `headline` (≤ 60 characters), `body` (≤ 140 characters), `narration` (1 to 3 spoken sentences), `url` and `source` taken from the item.',
    '',
    `Available items (${items.length}):`,
    list,
  ].join('\n');
}

/**
 * Parses a raw output (potentially surrounded by markdown fences and stray text)
 * into a validated VideoScriptInput.
 *
 * Steps: strip ```...``` fences → extract from the first `{` to the last `}`
 * → `JSON.parse` → zod validation. Throws a clear Error if any of these steps fails.
 */
export function parseScriptJson(raw: string): VideoScriptInput {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('parseScriptJson: empty input.');
  }

  // 1) Strip markdown fences (``` or ```json), wherever they are.
  const withoutFences = raw.replace(/```(?:json)?/gi, '');

  // 2) Extract from the first '{' to the last '}'.
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('parseScriptJson: no JSON object detected in the output.');
  }
  const jsonText = withoutFences.slice(start, end + 1);

  // 3) JSON.parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`parseScriptJson: invalid JSON (${String(e)}).`);
  }

  // 4) Zod validation.
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
 * Generates (or re-reads) the video script for a category.
 *
 *  - `items.length === 0` → `null` (category skipped).
 *  - `file` mode: re-reads `scriptFile` if it exists, otherwise `null` (NO network).
 *  - `auto` mode: reuses `scriptFile` if it exists; otherwise calls `claude -p`
 *    (single retry with a corrective reminder), validates, writes the JSON and returns the object.
 */
export async function generateScript(args: {
  category: CategoryConfig;
  items: RssItem[];
  cfg: GlobalConfig;
  date: string;
  mode: SummarizeMode;
}): Promise<VideoScriptInput | null> {
  const { category, items, cfg, date, mode } = args;

  if (items.length === 0) {
    log.info(`Category "${category.id}" has no items: skipped.`);
    return null;
  }

  const scriptFile = paths(cfg, date, category.id).scriptFile;

  // Reuse of an already-present script (both modes), in a TOLERANT way:
  // a corrupted file (interrupted write, invalid JSON) must not condemn
  // the category on every re-run — we regenerate (auto mode) or skip (file mode).
  if (fs.existsSync(scriptFile)) {
    try {
      return parseScriptJson(fs.readFileSync(scriptFile, 'utf8'));
    } catch (e) {
      log.warn(
        `Cached script unreadable for "${category.id}" (${scriptFile}): ${shortMessage(e)}. Regenerating.`,
      );
    }
  }

  if (mode === 'file') {
    log.warn(
      `"file" mode: no script found for "${category.id}" (${scriptFile}). Category skipped.`,
    );
    return null;
  }

  // "auto" mode: generation via `claude -p`, in the category's language.
  const language = resolveLanguage(cfg, category);
  const basePrompt = buildPrompt(category, items, date, language.name);

  // Robustness loop: tolerates transient API errors (closed socket,
  // timeout) AND non-conforming outputs. A SHORT corrective note (never
  // the raw error, which would contain the prompt) is appended from the 2nd attempt onward.
  const correctiveSuffix =
    '\n\nREMINDER: reply ONLY with the requested strict JSON, ' +
    'with no surrounding text or markdown block, respecting the structure exactly.';

  let script: VideoScriptInput | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_CLAUDE_ATTEMPTS; attempt++) {
    try {
      script = await runClaude(cfg, attempt === 1 ? basePrompt : basePrompt + correctiveSuffix);
      lastError = undefined;
      break;
    } catch (e) {
      lastError = e;
      log.warn(
        `Generating "${category.id}": attempt ${attempt}/${MAX_CLAUDE_ATTEMPTS} failed (${shortMessage(e)}).`,
      );
    }
  }
  if (script === undefined) {
    throw new Error(
      `Generating the script "${category.id}" failed after ${MAX_CLAUDE_ATTEMPTS} attempts: ${shortMessage(lastError)}`,
    );
  }

  // ATOMIC write of the validated script to the cache (tmp + rename): a file
  // is never visible half-written, even if the process is interrupted.
  ensureDir(path.dirname(scriptFile));
  const tmpFile = scriptFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(script, null, 2), 'utf8');
  fs.renameSync(tmpFile, scriptFile);
  log.info(`Script generated for "${category.id}" → ${scriptFile}`);
  return script;
}

/** Truncates an error message for readable logs (the prompt no longer appears in it). */
function shortMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

/**
 * Calls `claude -p` (prompt provided via STDIN, not in argv: avoids ARG_MAX and
 * keeps error messages clean) and parses the output. Isolated for the retry.
 */
async function runClaude(
  cfg: GlobalConfig,
  prompt: string,
): Promise<VideoScriptInput> {
  const res = await exec(cfg.claudeBin, ['-p'], {
    input: prompt,
    timeoutMs: CLAUDE_TIMEOUT_MS,
  });
  if (res.code !== 0) {
    throw new Error(
      `claude -p failed (code ${res.code}): ${(res.stderr || res.stdout).slice(0, 300)}`,
    );
  }
  return parseScriptJson(res.stdout);
}
