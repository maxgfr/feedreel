/**
 * Caption generation (titles, descriptions, hashtags) per platform.
 *
 * Editorial module of the publishing pipeline: for each requested platform, and
 * in the category's language, it produces ready-to-publish metadata (VideoMeta).
 * Two modes, mirroring src/pipeline/summarize.ts:
 *   - `file`: re-reads/validates an already-written metadataFile (produced by a
 *     Claude Code skill), NO network;
 *   - `auto`: generates the JSON via the `claude -p` CLI (headless mode), with
 *     bounded retry.
 *
 * Everything else (fence-tolerant parsing, truncation to limits, hashtag
 * normalization) is PURE and testable without network. Per-platform limits are
 * enforced by DEFENSIVE truncation, never by rejection: an over-long text must
 * not doom the publication.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type {
  CategoryConfig,
  GlobalConfig,
  LanguageConfig,
  VideoScriptInput,
} from '../types';
import type { PlatformId, PlatformMeta, VideoMeta } from './types';
import type { PublishConfig } from '../../config/publish';
import { paths, resolveLanguage } from '../../config/index';
import { ensureDir, truncate } from '../util';
import { exec } from '../exec';
import { createLogger } from '../log';

const log = createLogger('publish:captions');

/** Timeout of a `claude -p` call (ms). */
const CLAUDE_TIMEOUT_MS = 180_000;

/** Maximum number of `claude -p` attempts (tolerance for transient API errors). */
const MAX_CLAUDE_ATTEMPTS = 3;

/** Minimum desired number of hashtags (editorial guideline). */
const MIN_HASHTAGS = 8;

/**
 * Editorial limits per platform.
 *  - `title`   : maximum title length;
 *  - `caption` : maximum description / caption length;
 *  - `maxHashtags` : maximum number of hashtags kept.
 */
export const PLATFORM_LIMITS: Record<
  PlatformId,
  { title: number; caption: number; maxHashtags: number }
> = {
  youtube: { title: 100, caption: 5000, maxHashtags: 15 },
  tiktok: { title: 150, caption: 2200, maxHashtags: 12 },
  instagram: { title: 150, caption: 2200, maxHashtags: 30 },
};

/** All known platforms (stable order for prompts/outputs). */
const ALL_PLATFORMS: PlatformId[] = ['youtube', 'tiktok', 'instagram'];

/**
 * Zod schema of ONE platform's metadata (PlatformMeta).
 * `title` must be non-empty; `description` may be empty; `hashtags` is a list of
 * strings (normalization / `#` prefixing happens after parsing).
 */
const PlatformMetaSchema: z.ZodType<PlatformMeta> = z.object({
  title: z.string().min(1),
  description: z.string(),
  hashtags: z.array(z.string()),
});

/**
 * Zod schema of the video metadata (VideoMeta).
 * `language` is required; each platform is optional (Claude only returns the
 * requested platforms). The cast guarantees exact alignment with the shared
 * contract src/publish/types.ts.
 */
export const VideoMetaSchema: z.ZodType<VideoMeta> = z.object({
  language: z.string().min(1),
  youtube: PlatformMetaSchema.optional(),
  tiktok: PlatformMetaSchema.optional(),
  instagram: PlatformMetaSchema.optional(),
});

/**
 * Builds the strict prompt for `claude -p`.
 * Asks Claude to reply ONLY with strict JSON, with one key per REQUESTED
 * platform, all text written in `language.name`, respecting the per-platform
 * limits and the hashtag guidelines.
 */
export function buildCaptionsPrompt(args: {
  category: CategoryConfig;
  script: VideoScriptInput;
  date: string;
  language: LanguageConfig;
  platforms: PlatformId[];
  publish: PublishConfig;
}): string {
  const { category, script, date, language, platforms, publish } = args;
  const LANG = language.name;

  // List of items (excluding intro) as editorial context.
  const items = script.segments
    .filter((s) => s.type === 'item')
    .map((s, i) => {
      const headline = s.headline ?? s.narration;
      const source = s.source ?? '';
      const url = s.url ?? '';
      return `${i + 1}. ${headline}\n   source: ${source}\n   url: ${url}`;
    })
    .join('\n');

  // Source links (to include at the end of the YouTube description).
  const links = script.segments
    .filter((s) => s.type === 'item' && typeof s.url === 'string' && s.url !== '')
    .map((s) => `- ${s.source ?? ''} : ${s.url ?? ''}`)
    .join('\n');

  // Detailed per-platform guidelines (only the requested ones).
  const platformLines = platforms.map((p) => {
    const lim = PLATFORM_LIMITS[p];
    if (p === 'youtube') {
      return `  - "youtube": title ≤ ${lim.title} characters, description ≤ ${lim.caption} characters including the source links at the end of the description, ${MIN_HASHTAGS} to ${lim.maxHashtags} hashtags, MANDATORILY including "#Shorts".`;
    }
    if (p === 'tiktok') {
      return `  - "tiktok": title ≤ ${lim.title} characters, short and catchy description, ${MIN_HASHTAGS} to ${lim.maxHashtags} hashtags suited to TikTok (title + hashtags ≤ ${lim.caption} characters in total).`;
    }
    return `  - "instagram": title ≤ ${lim.title} characters, caption ≤ ${lim.caption} characters, ${MIN_HASHTAGS} to ${lim.maxHashtags} hashtags suited to Instagram.`;
  });

  // i18n override: base hashtags to include for this language, if configured.
  const baseHashtags = publish.i18n[language.code]?.baseHashtags;
  const baseHashtagLine =
    baseHashtags && baseHashtags.length > 0
      ? `- Always include these base hashtags: ${baseHashtags.join(' ')}.`
      : null;

  // Expected JSON object, with ONE key per requested platform.
  const jsonShape = [
    '{',
    `  "language": "${language.code}",`,
    ...platforms.map(
      (p, i) =>
        `  "${p}": { "title": "<title in ${LANG}>", "description": "<description in ${LANG}>", "hashtags": ["#example", "#…"] }${i < platforms.length - 1 ? ',' : ''}`,
    ),
    '}',
  ].join('\n');

  return [
    `You are a tech content marketing expert. You write, IN ${LANG}, the publishing metadata (titles, descriptions, hashtags) for a short tech-watch video in the "${category.label}" category (date: ${date}).`,
    '',
    'Strict instructions:',
    '- Reply ONLY with valid STRICT JSON: no text before or after, no markdown block, no comments.',
    `- All editorial text (title, description, hashtags) is written in ${LANG}, in a catchy yet factual tone.`,
    `- Produce EXACTLY ONE key per REQUESTED platform: ${platforms.map((p) => `"${p}"`).join(', ')}. Do NOT add any other platform.`,
    `- Each platform has ${MIN_HASHTAGS} to 15 relevant, platform-specific hashtags, each starting with "#", with no space, deduplicated.`,
    '- STRICTLY respect the length limits below.',
    ...(baseHashtagLine ? [baseHashtagLine] : []),
    '',
    'Per-platform limits and rules:',
    ...platformLines,
    '',
    'Expected JSON structure:',
    jsonShape,
    '',
    `Video title (context): ${script.title}`,
    '',
    `Video items (${script.segments.filter((s) => s.type === 'item').length}):`,
    items || '(no item)',
    '',
    'Source links (to reuse at the end of the YouTube description if requested):',
    links || '(no link)',
  ].join('\n');
}

/**
 * Parses a raw output (potentially wrapped in markdown fences and stray text)
 * into a validated, TRUNCATED and NORMALIZED VideoMeta.
 *
 * PURE: no side effects. Steps:
 *   1. strip ```...``` fences;
 *   2. extract from the first `{` to the last `}`;
 *   3. JSON.parse;
 *   4. zod validation;
 *   5. for each REQUESTED platform: truncate title/description to the limits
 *      (via util.truncate) and normalize hashtags (`#` prefix, no space, dedup,
 *      clamp to maxHashtags);
 *   6. keep ONLY the requested platforms; force `language`.
 * Throws a clear Error if any of steps 1–4 fails.
 */
export function parseCaptionsJson(
  raw: string,
  platforms: PlatformId[],
  language: string,
): VideoMeta {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('parseCaptionsJson: empty input.');
  }

  // 1) Strip markdown fences (``` or ```json), wherever they are.
  const withoutFences = raw.replace(/```(?:json)?/gi, '');

  // 2) Extract from the first '{' to the last '}'.
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('parseCaptionsJson: no JSON object detected in the output.');
  }
  const jsonText = withoutFences.slice(start, end + 1);

  // 3) JSON.parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`parseCaptionsJson: invalid JSON (${String(e)}).`);
  }

  // 4) zod validation.
  const result = VideoMetaSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `parseCaptionsJson: metadata does not match the schema — ${result.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join(' ; ')}`,
    );
  }
  const data = result.data;

  // 5–6) Keep ONLY the requested platforms, truncating and normalizing.
  const out: VideoMeta = { language };
  for (const platform of platforms) {
    const meta = data[platform];
    if (!meta) continue;
    out[platform] = normalizePlatformMeta(platform, meta);
  }
  return out;
}

/**
 * Truncates (title/description) and normalizes (hashtags) a platform's metadata
 * according to its limits. Guarantees the constraints are met even if Claude
 * ignored them.
 */
function normalizePlatformMeta(
  platform: PlatformId,
  meta: PlatformMeta,
): PlatformMeta {
  const lim = PLATFORM_LIMITS[platform];
  const forceShorts = platform === 'youtube';
  return {
    title: truncate(meta.title, lim.title),
    description: truncate(meta.description, lim.caption),
    hashtags: normalizeHashtags(meta.hashtags, lim.maxHashtags, forceShorts),
  };
}

/**
 * Normalizes a list of hashtags:
 *   - `#` prefix added if missing;
 *   - internal spaces removed;
 *   - empty entries ignored;
 *   - deduplication (case-insensitive);
 *   - clamp to the maximum count.
 * For YouTube, guarantees the presence of `#Shorts` (first, within the limit).
 */
function normalizeHashtags(
  raw: string[],
  max: number,
  forceShorts: boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  // YouTube: force #Shorts in first position.
  if (forceShorts) {
    out.push('#Shorts');
    seen.add('#shorts');
  }

  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    // Remove all internal spaces (a hashtag is a single token).
    let tag = entry.replace(/\s+/g, '');
    if (tag === '' || tag === '#') continue;
    if (!tag.startsWith('#')) tag = `#${tag}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }

  return out.slice(0, max);
}

/**
 * Generates (or re-reads) the publishing metadata of a category.
 *
 *  - re-reads `metadataFile` if it exists and is VALID (both modes, tolerant);
 *  - `file` mode without a file: `null` (warn log, NO network);
 *  - `auto` mode: calls `claude -p` (bounded retry with corrective reminder),
 *    parses, truncates/normalizes, writes the JSON ATOMICALLY and returns the
 *    object.
 */
export async function generateCaptions(args: {
  script: VideoScriptInput;
  category: CategoryConfig;
  cfg: GlobalConfig;
  publish: PublishConfig;
  date: string;
  mode: 'auto' | 'file';
  platforms: PlatformId[];
}): Promise<VideoMeta | null> {
  const { script, category, cfg, publish, date, mode, platforms } = args;

  if (platforms.length === 0) {
    log.warn(`No platform requested for "${category.id}": captions skipped.`);
    return null;
  }

  const language = resolveLanguage(cfg, category);
  const metadataFile = paths(cfg, date, category.id).metadataFile;

  // TOLERANT reuse of an already-present cache (both modes): a corrupted file
  // does not doom the category — we regenerate (auto) or skip (file).
  if (fs.existsSync(metadataFile)) {
    try {
      return parseCaptionsJson(
        fs.readFileSync(metadataFile, 'utf8'),
        platforms,
        language.code,
      );
    } catch (e) {
      log.warn(
        `Cached metadata unreadable for "${category.id}" (${metadataFile}): ${shortMessage(e)}. Regenerating.`,
      );
    }
  }

  if (mode === 'file') {
    log.warn(
      `"file" mode: no metadata found for "${category.id}" (${metadataFile}). Category skipped.`,
    );
    return null;
  }

  // "auto" mode: generation via `claude -p`, in the category's language.
  const basePrompt = buildCaptionsPrompt({
    category,
    script,
    date,
    language,
    platforms,
    publish,
  });

  // Robustness loop: tolerates transient API errors AND non-conforming outputs.
  // A SHORT corrective note (never the raw error, which would contain the
  // prompt) is appended from the 2nd attempt onward.
  const correctiveSuffix =
    '\n\nREMINDER: reply ONLY with the requested strict JSON, ' +
    'with no text or markdown block around it, respecting exactly the structure and the requested platforms.';

  let meta: VideoMeta | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_CLAUDE_ATTEMPTS; attempt++) {
    try {
      meta = await runClaude(
        cfg,
        attempt === 1 ? basePrompt : basePrompt + correctiveSuffix,
        platforms,
        language.code,
      );
      lastError = undefined;
      break;
    } catch (e) {
      lastError = e;
      log.warn(
        `Captions generation "${category.id}": attempt ${attempt}/${MAX_CLAUDE_ATTEMPTS} failed (${shortMessage(e)}).`,
      );
    }
  }
  if (meta === undefined) {
    throw new Error(
      `Captions generation "${category.id}" failed after ${MAX_CLAUDE_ATTEMPTS} attempts: ${shortMessage(lastError)}`,
    );
  }

  // ATOMIC write (tmp + rename): never a half-written visible file.
  ensureDir(path.dirname(metadataFile));
  const tmpFile = metadataFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(meta, null, 2), 'utf8');
  fs.renameSync(tmpFile, metadataFile);
  log.info(`Captions generated for "${category.id}" → ${metadataFile}`);
  return meta;
}

/** Truncates an error message for readable logs (the prompt no longer appears in it). */
function shortMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

/**
 * Calls `claude -p` (prompt via STDIN: avoids ARG_MAX and keeps error messages
 * clean) and parses the output. Isolated for the retry.
 */
async function runClaude(
  cfg: GlobalConfig,
  prompt: string,
  platforms: PlatformId[],
  language: string,
): Promise<VideoMeta> {
  const res = await exec(cfg.claudeBin, ['-p'], {
    input: prompt,
    timeoutMs: CLAUDE_TIMEOUT_MS,
  });
  if (res.code !== 0) {
    throw new Error(
      `claude -p failed (code ${res.code}): ${(res.stderr || res.stdout).slice(0, 300)}`,
    );
  }
  return parseCaptionsJson(res.stdout, platforms, language);
}

/** Re-exported for API consistency (stable platform order). */
export { ALL_PLATFORMS };
