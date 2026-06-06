/**
 * Orchestration of social PUBLISHING (opt-in).
 *
 * Responsibility: for each (category × platform) pair, load or generate the
 * captions then publish via the matching adapter, SEQUENTIALLY and FAULT
 * TOLERANT (a failure on one pair NEVER stops the others). Idempotent thanks
 * to the registry (`published` table): an already-published pair is skipped
 * (unless `force`).
 *
 * This is the project's only outbound network step: strictly isolated, never
 * triggered without explicit configuration. Modeled on the spirit of
 * src/pipeline/orchestrate.ts.
 */
import fs from 'node:fs';
import type { VideoScriptInput } from '../types';
import type {
  PlatformAdapter,
  PlatformId,
  Privacy,
  PublishContext,
  PublishResult,
  VideoMeta,
} from './types';
import { loadConfig, paths, resolveLanguage } from '../../config/index';
import { loadPublishConfig, type PublishConfig } from '../../config/publish';
import { CATEGORIES, getCategory } from '../../config/categories';
import { today } from '../util';
import { log } from '../log';
import { generateCaptions } from './captions';
import {
  openRegistryDb,
  isPublished,
  recordPublished,
  closeRegistryDb,
} from './registry';
import { youtubeAdapter } from './youtube';
import { tiktokAdapter } from './tiktok';
import { instagramAdapter } from './instagram';
import { loadEnv } from './env';

/** Adapter table indexed by platform. */
export const ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  youtube: youtubeAdapter,
  tiktok: tiktokAdapter,
  instagram: instagramAdapter,
};

/** Aliases accepted on the command line → canonical platform identifier. */
const PLATFORM_ALIASES: Record<string, PlatformId> = {
  yt: 'youtube',
  youtube: 'youtube',
  tt: 'tiktok',
  tiktok: 'tiktok',
  ig: 'instagram',
  instagram: 'instagram',
};

/**
 * Parses a `--platforms` spec (e.g. "yt,tt") into canonical platforms.
 *
 *  - accepted aliases: `yt|youtube`, `tt|tiktok`, `ig|instagram`;
 *  - comma-separated; whitespace and case ignored;
 *  - `undefined` or empty string → ALL platforms;
 *  - deduplicated, in canonical order; unknown tokens are ignored.
 */
export function parsePlatforms(spec?: string): PlatformId[] {
  const all: PlatformId[] = ['youtube', 'tiktok', 'instagram'];
  if (spec === undefined || spec.trim() === '') return all;

  const wanted = new Set<PlatformId>();
  for (const token of spec.split(',')) {
    const id = PLATFORM_ALIASES[token.trim().toLowerCase()];
    if (id) wanted.add(id);
  }
  // Preserve canonical order and guarantee uniqueness.
  return all.filter((p) => wanted.has(p));
}

/**
 * Intersects the requested platforms (or all by default) with those marked
 * `enabled` in the publish configuration.
 */
export function enabledPlatforms(
  publish: PublishConfig,
  requested?: PlatformId[],
): PlatformId[] {
  const all: PlatformId[] = ['youtube', 'tiktok', 'instagram'];
  const base = requested ?? all;
  return base.filter((p) => publish.platforms[p].enabled);
}

/**
 * Resolves the effective privacy: explicit override > language i18n override >
 * configuration default privacy.
 */
export function resolvePrivacy(
  publish: PublishConfig,
  language: string,
  override?: Privacy,
): Privacy {
  return override ?? publish.i18n[language]?.privacy ?? publish.defaultPrivacy;
}

/** Result of caption generation for a category. */
export interface CaptionResult {
  category: string;
  status: 'ok' | 'skipped' | 'error';
  /** Path of the metadata file written (if `ok`). */
  file?: string;
  /** Error message (if `error`). */
  error?: string;
}

/**
 * Reads and parses a category's JSON video script from the cache.
 * Returns `null` if the file is missing or unreadable (category skipped).
 */
function readScript(scriptFile: string): VideoScriptInput | null {
  if (!fs.existsSync(scriptFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(scriptFile, 'utf8')) as VideoScriptInput;
  } catch (e) {
    log.warn(`Unreadable script (${scriptFile}): ${String(e)}.`);
    return null;
  }
}

/**
 * Generates (or re-reads) the captions for each targeted category.
 *
 *  - `categoryId` targets a single category; otherwise all `CATEGORIES`.
 *  - reads the script `paths(cfg,date,cat.id).scriptFile`: missing → `skipped`.
 *  - `generateCaptions(...)` → `ok` (file = metadataFile).
 *  - try/catch per category: a failure does not interrupt the following ones.
 *  - `mode` defaults to `loadPublishConfig().captions.mode`.
 */
export async function generateAllCaptions(args: {
  date?: string;
  categoryId?: string;
  mode?: 'auto' | 'file';
  platforms?: PlatformId[];
}): Promise<CaptionResult[]> {
  const cfg = loadConfig();
  const pub = loadPublishConfig();
  const date = args.date ?? today();
  const mode = args.mode ?? pub.captions.mode;
  const platforms = enabledPlatforms(pub, args.platforms);

  const categories = args.categoryId ? [getCategory(args.categoryId)] : CATEGORIES;
  const results: CaptionResult[] = [];

  for (const category of categories) {
    const scope = log.child(category.id);
    const { scriptFile, metadataFile } = paths(cfg, date, category.id);
    try {
      const script = readScript(scriptFile);
      if (script === null) {
        scope.info('Captions skipped (script missing).');
        results.push({ category: category.id, status: 'skipped' });
        continue;
      }
      const meta = await generateCaptions({
        script,
        category,
        cfg,
        publish: pub,
        date,
        mode,
        platforms,
      });
      if (meta === null) {
        scope.info('Captions skipped (no metadata generated).');
        results.push({ category: category.id, status: 'skipped' });
        continue;
      }
      scope.info(`Captions generated → ${metadataFile}`);
      results.push({ category: category.id, status: 'ok', file: metadataFile });
    } catch (e) {
      scope.error(String(e));
      results.push({ category: category.id, status: 'error', error: String(e) });
    }
  }

  return results;
}

/**
 * Loads a category's metadata: re-reads `metadataFile` if it exists, otherwise
 * tries to generate it from the script (according to `pub.captions.mode`).
 * Returns `null` if nothing is available (category skipped).
 */
async function loadVideoMeta(args: {
  cfg: ReturnType<typeof loadConfig>;
  pub: PublishConfig;
  date: string;
  categoryId: string;
  platforms: PlatformId[];
}): Promise<VideoMeta | null> {
  const { cfg, pub, date, categoryId, platforms } = args;
  const { scriptFile, metadataFile } = paths(cfg, date, categoryId);

  // 1) Metadata already present: re-read it as-is.
  if (fs.existsSync(metadataFile)) {
    try {
      return JSON.parse(fs.readFileSync(metadataFile, 'utf8')) as VideoMeta;
    } catch (e) {
      log.warn(`Unreadable metadata (${metadataFile}): ${String(e)}. Regenerating.`);
    }
  }

  // 2) Otherwise: generate from the script (if present).
  const script = readScript(scriptFile);
  if (script === null) return null;
  return generateCaptions({
    script,
    category: getCategory(categoryId),
    cfg,
    publish: pub,
    date,
    mode: pub.captions.mode,
    platforms,
  });
}

/**
 * Publishes the rendered videos to the active platforms, opt-in.
 *
 * For each targeted category (all or one) that has a rendered video
 * (`output/<date>/<cat>.mp4`), then for each active platform:
 *  - platform not configured (credentials missing for the language) → `skipped`;
 *  - pair already published (registry) and no `force` → `skipped`;
 *  - platform metadata missing → `skipped`;
 *  - otherwise `adapter.publish(ctx)`; an `ok` success is recorded in the registry.
 *
 * Each (category × platform) pair is isolated by try/catch: a failure produces
 * an `error` result but does not interrupt the other publications.
 * `dryRun` is propagated to each adapter (no network).
 */
export async function publish(args: {
  date?: string;
  categoryId?: string;
  platforms?: PlatformId[];
  dryRun?: boolean;
  privacy?: Privacy;
  force?: boolean;
}): Promise<PublishResult[]> {
  const cfg = loadConfig();
  const pub = loadPublishConfig();
  await loadEnv();
  const date = args.date ?? today();
  const plats = enabledPlatforms(pub, args.platforms);

  const categories = args.categoryId ? [getCategory(args.categoryId)] : CATEGORIES;
  const db = openRegistryDb(cfg);
  const results: PublishResult[] = [];

  try {
    for (const category of categories) {
      const scope = log.child(category.id);
      const { outputFile } = paths(cfg, date, category.id);

      // No rendered video for this category: nothing to publish.
      if (!fs.existsSync(outputFile)) {
        scope.info(`No rendered video (${outputFile}): category ignored.`);
        continue;
      }

      const lang = resolveLanguage(cfg, category).code;

      // Metadata (per platform): re-read or generated. Missing → everything skipped.
      const videoMeta = await loadVideoMeta({
        cfg,
        pub,
        date,
        categoryId: category.id,
        platforms: plats,
      });
      if (videoMeta === null) {
        scope.warn('No metadata available: category skipped.');
        for (const platform of plats) {
          results.push({ platform, category: category.id, status: 'skipped' });
        }
        continue;
      }

      for (const platform of plats) {
        const adapter = ADAPTERS[platform];

        // Missing credentials for this language: skip (this is not an error).
        if (!adapter.isConfigured(lang, pub)) {
          scope.warn(`${platform}: missing credentials for language "${lang}" — skipped.`);
          results.push({ platform, category: category.id, status: 'skipped' });
          continue;
        }

        // Idempotence: pair already published and no --force → skipped.
        if (!args.force && isPublished(db, { date, category: category.id, platform })) {
          scope.info(`${platform}: already published — skipped.`);
          results.push({ platform, category: category.id, status: 'skipped' });
          continue;
        }

        // Metadata for THIS platform required.
        const meta = videoMeta[platform];
        if (!meta) {
          scope.warn(`${platform}: no metadata — skipped.`);
          results.push({ platform, category: category.id, status: 'skipped' });
          continue;
        }

        const ctx: PublishContext = {
          platform,
          videoPath: outputFile,
          meta,
          language: lang,
          privacy: resolvePrivacy(pub, lang, args.privacy),
          dryRun: !!args.dryRun,
          cfg,
          publish: pub,
          date,
          category,
        };

        try {
          const res = await adapter.publish(ctx);
          if (res.status === 'ok') {
            recordPublished(db, {
              date,
              category: category.id,
              platform,
              videoId: res.videoId,
              url: res.url,
            });
          }
          results.push(res);
        } catch (e) {
          scope.error(`${platform}: ${String(e)}`);
          results.push({
            platform,
            category: category.id,
            status: 'error',
            error: String(e),
          });
        }
      }
    }
  } finally {
    closeRegistryDb(db);
  }

  return results;
}
