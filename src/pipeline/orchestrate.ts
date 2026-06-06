/**
 * Orchestration of the feedreel pipeline (one video per day).
 *
 *  - `prepare`: fetch RSS + dedup → cache/items/<date>.json (for the skill to read).
 *  - `render` : read the skill-written script → music + Remotion → output/<date>.mp4,
 *               plus a copy-paste caption at output/<date>.txt.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { GlobalConfig, RssItem } from '../types';
import { loadConfig, paths } from '../../config/index';
import { today, ensureDir } from '../util';
import { log } from '../log';
import { fetchFeeds } from './fetchRss';
import { openDb, selectNewItems, markSeen, closeDb } from './dedup';
import { loadScript, buildCaption } from './script';
import { assembleMusicVideo } from './music';
import { renderVideo, closeBrowser } from './render';

/** Result of the `prepare` step. */
export interface PrepareResult {
  date: string;
  itemsFile: string;
  count: number;
}

/** Result of the `render` step. */
export interface RenderResult {
  date: string;
  outputFile: string;
  textFile: string;
  title: string;
  description: string;
  hashtags: string[];
}

/**
 * Prepares the day's items: fetch all feeds, select the new ones (dedup WITHOUT
 * marking — items are only marked after a successful render), write the JSON cache.
 */
export async function prepare(args: { date?: string } = {}): Promise<PrepareResult> {
  const cfg = loadConfig();
  const date = args.date ?? today();
  const { itemsFile } = paths(cfg, date);

  const fetched = await fetchFeeds(cfg.feeds, cfg);
  const db = openDb(cfg);
  let items: RssItem[];
  try {
    items = selectNewItems(db, fetched, cfg.video.maxItems, { mark: false });
  } finally {
    closeDb(db);
  }

  ensureDir(path.dirname(itemsFile));
  fs.writeFileSync(itemsFile, JSON.stringify(items, null, 2), 'utf8');
  log.info(`${items.length} item(s) prepared → ${itemsFile}`);
  return { date, itemsFile, count: items.length };
}

/**
 * Renders the day's video from the skill-written script, writes the copy-paste
 * caption, and marks the day's items as seen (so they don't repeat next time).
 */
export async function render(args: { date?: string } = {}): Promise<RenderResult> {
  const cfg = loadConfig();
  const date = args.date ?? today();
  const p = paths(cfg, date);

  const script = loadScript(p.scriptFile);
  const video = await assembleMusicVideo({ script, cfg, date });

  let outputFile: string;
  try {
    outputFile = await renderVideo({ script: video, cfg, date });
  } finally {
    await closeBrowser();
  }
  log.info(`Video rendered → ${outputFile}`);

  // Copy-paste caption (title + description + hashtags + sources).
  const textFile = p.textFile;
  ensureDir(path.dirname(textFile));
  fs.writeFileSync(textFile, buildCaption(script), 'utf8');
  log.info(`Caption written → ${textFile}`);

  // Mark the day's items as seen now that the video succeeded (idempotent).
  markDayItems(cfg, date);

  return {
    date,
    outputFile,
    textFile,
    title: script.title,
    description: script.description,
    hashtags: script.hashtags,
  };
}

/** Marks the items cached for `date` as seen (best effort). */
function markDayItems(cfg: GlobalConfig, date: string): void {
  const { itemsFile } = paths(cfg, date);
  let items: RssItem[];
  try {
    items = JSON.parse(fs.readFileSync(itemsFile, 'utf8')) as RssItem[];
  } catch {
    log.warn(`Items cache unreadable (${itemsFile}): dedup not updated.`);
    return;
  }
  const db = openDb(cfg);
  try {
    markSeen(db, items);
  } finally {
    closeDb(db);
  }
}
