/**
 * Orchestration of the feedreel pipeline.
 *
 * Responsibility: chain fetch → dedup → script → tts → render for each
 * category, IN SERIES, with per-category error isolation (log + continue).
 * The aggregate category ('global') is always processed LAST: its items
 * are the top item (the freshest) of each other category processed in the run.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CategoryConfig, GlobalConfig, RssItem } from '../types';
import { loadConfig, paths } from '../../config/index';
import { CATEGORIES, getCategory } from '../../config/categories';
import { today, ensureDir } from '../util';
import { log } from '../log';
import { fetchCategory } from './fetchRss';
import { openDb, selectNewItems, markSeen, closeDb } from './dedup';
import { generateScript, type SummarizeMode } from './summarize';
import { synthesizeVideo } from './tts';
import { assembleMusicVideo } from './music';
import { renderVideo, closeBrowser } from './render';

/** Result of processing a category (for the CLI summary). */
export interface CategoryResult {
  category: string;
  status: 'ok' | 'skipped' | 'error';
  outputFile?: string;
  error?: string;
}

/**
 * Prepares a category: fetches the feeds, selects the new items
 * (dedup + marking), writes the JSON items cache, returns the retained items.
 */
export async function prepareCategory(args: {
  category: CategoryConfig;
  cfg: GlobalConfig;
  date: string;
  db: import('better-sqlite3').Database;
}): Promise<RssItem[]> {
  const { category, cfg, date, db } = args;
  const fetched = await fetchCategory(category, cfg);
  // Selection WITHOUT marking: items are only marked after the category fully
  // succeeds (see processCategory), so a downstream failure doesn't lose them.
  const items = selectNewItems(db, category, fetched, { mark: false });
  const { itemsFile } = paths(cfg, date, category.id);
  ensureDir(path.dirname(itemsFile));
  fs.writeFileSync(itemsFile, JSON.stringify(items, null, 2), 'utf8');
  return items;
}

/**
 * Builds the items of the aggregate category from the top item (the
 * freshest) of each other category already prepared in the run. NO dedup here.
 */
function aggregateItems(
  category: CategoryConfig,
  prepared: Map<string, RssItem[]>,
): RssItem[] {
  const tops: RssItem[] = [];
  for (const [catId, items] of prepared) {
    if (catId === category.id) continue;
    const top = topByFreshness(items);
    if (top) tops.push({ ...top, category: category.id });
  }
  // Sort by descending freshness, then cut to maxItems.
  tops.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return tops.slice(0, category.maxItems);
}

/** Freshest item of a list (max publishedAt ISO), or undefined if empty. */
function topByFreshness(items: RssItem[]): RssItem | undefined {
  let best: RssItem | undefined;
  for (const it of items) {
    if (best === undefined || it.publishedAt.localeCompare(best.publishedAt) > 0) {
      best = it;
    }
  }
  return best;
}

/**
 * Processes a category end to end: items → script → tts → render.
 * The aggregate category's items come from the categories already prepared.
 */
async function processCategory(args: {
  category: CategoryConfig;
  cfg: GlobalConfig;
  date: string;
  db: import('better-sqlite3').Database;
  mode: SummarizeMode;
  render: boolean;
  prepared: Map<string, RssItem[]>;
}): Promise<CategoryResult> {
  const { category, cfg, date, db, mode, render, prepared } = args;
  const scope = log.child(category.id);

  // 1. Items: aggregation for 'global', otherwise fetch + dedup.
  const items = category.aggregate
    ? aggregateItems(category, prepared)
    : await prepareCategory({ category, cfg, date, db });
  prepared.set(category.id, items);
  scope.info(`${items.length} item(s) retained.`);

  // 2. Script (claude -p in auto mode, or cache file in file mode).
  const script = await generateScript({ category, items, cfg, date, mode });
  if (script === null) {
    scope.info('Category skipped (no item or missing script).');
    return { category: category.id, status: 'skipped' };
  }

  // 3. Soundtrack: background music (fixed durations) OR TTS voice-over (durations aligned with the audio).
  const vs =
    cfg.audio.mode === 'music'
      ? await assembleMusicVideo({ script, category, cfg, date })
      : await synthesizeVideo({ script, category, cfg, date });

  // 4. Video render (unless --no-render).
  let outputFile: string | undefined;
  if (render) {
    outputFile = await renderVideo({ script: vs, cfg, date });
    scope.info(`Video rendered: ${outputFile}`);
  } else {
    scope.info('Render disabled (--no-render).');
  }

  // 5. Full success → dedup marking (except the aggregate category, which doesn't use dedup).
  //    A 2nd run on the same day will therefore not reproduce these items (acceptance §17),
  //    whereas a previous FAILED run leaves the items available for retry.
  if (!category.aggregate) {
    markSeen(db, category, items);
  }

  return { category: category.id, status: 'ok', outputFile };
}

/**
 * Runs the full pipeline.
 *
 * - `date` defaults to today().
 * - `categoryId` targets a single category; otherwise all `CATEGORIES`.
 * - 'global' (aggregate) is ALWAYS processed LAST.
 * - SEQUENTIAL: each category is isolated by try/catch (log + continue);
 *   a failed category does not interrupt the following ones.
 * - `render` (default true); `mode` (default 'auto').
 */
export async function run(args: {
  date?: string;
  categoryId?: string;
  render?: boolean;
  mode?: SummarizeMode;
}): Promise<CategoryResult[]> {
  const cfg = loadConfig();
  const date = args.date ?? today();
  const render = args.render !== false;
  const mode: SummarizeMode = args.mode ?? 'auto';

  const categories = orderedCategories(args.categoryId);
  const db = openDb(cfg);
  const prepared = new Map<string, RssItem[]>();
  const results: CategoryResult[] = [];

  try {
    // Feeding the aggregate categories: if a 'global' category is requested
    // without ALL its sources (non-aggregate categories) already being in the run,
    // we first prepare those sources (fetch + selection WITHOUT marking) to fill
    // `prepared`. Otherwise `run --category global` would have no items.
    const sources = CATEGORIES.filter((c) => !c.aggregate);
    const sourcesInRun = categories.filter((c) => !c.aggregate).length;
    if (categories.some((c) => c.aggregate) && sourcesInRun < sources.length) {
      for (const src of sources) {
        if (prepared.has(src.id)) continue;
        try {
          prepared.set(src.id, await prepareCategory({ category: src, cfg, date, db }));
        } catch (e) {
          log.child(src.id).warn(`Preparation (global feeding) failed: ${String(e)}`);
          prepared.set(src.id, []);
        }
      }
    }

    for (const category of categories) {
      try {
        const result = await processCategory({
          category,
          cfg,
          date,
          db,
          mode,
          render,
          prepared,
        });
        results.push(result);
      } catch (e) {
        log.child(category.id).error(String(e));
        results.push({
          category: category.id,
          status: 'error',
          error: String(e),
        });
      }
    }
  } finally {
    closeDb(db);
    // Close the run's shared Chromium instance (frees RAM, §16).
    await closeBrowser();
  }

  return results;
}

/**
 * Ordered list of categories to process: the aggregate category always comes
 * last (so that its items are built from the others).
 */
function orderedCategories(categoryId?: string): CategoryConfig[] {
  const selected = categoryId ? [getCategory(categoryId)] : CATEGORIES;
  const regular = selected.filter((c) => !c.aggregate);
  const aggregate = selected.filter((c) => c.aggregate);
  return [...regular, ...aggregate];
}
