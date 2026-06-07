import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { GlobalConfig, RssItem } from '../types';
import { closeDb, openDb, selectNewItems } from './dedup';

/** Creates a test config pointing `dbPath` at a unique temporary file. */
function makeTestConfig(): GlobalConfig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-dedup-'));
  return {
    projectRoot: dir,
    outputDir: path.join(dir, 'output'),
    cacheDir: path.join(dir, 'cache'),
    dbPath: path.join(dir, 'feedreel-test.db'),
    fps: 30,
    width: 1080,
    height: 1920,
    feedTimeoutMs: 12000,
    language: {
      name: 'English',
      uiLabel: 'NEWS',
      dateLocale: 'en-US',
      topLabel: 'Top',
      subscribeLabel: 'Subscribe',
      joinLabel: 'Join the debate',
      sourcesLabel: 'Sources',
    },
    video: { label: 'Daily News', emoji: '📰', accentColor: '#4ea8ff', maxItems: 2, subscribeText: 'Subscribe' },
    feeds: ['https://example.com/feed.xml'],
    music: { dir: 'assets/music', fadeSec: 1.5, volume: 1 },
    scene: { introSec: 3, itemSec: 4, outroSec: 3 },
  };
}

/** Max items kept by selectNewItems in these tests. */
const MAX_ITEMS = 2;

/** Builds a test item; `publishedAt` drives the freshness. */
function item(id: string, publishedAt: string): RssItem {
  return {
    id,
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    summary: `Summary ${id}`,
    source: 'example.com',
    publishedAt,
  };
}

describe('dedup', () => {
  let cfg: GlobalConfig;
  let db: Database.Database;

  beforeEach(() => {
    cfg = makeTestConfig();
    db = openDb(cfg);
  });

  afterEach(() => {
    closeDb(db);
    // Remove the temporary directory (database + WAL/SHM files).
    fs.rmSync(cfg.projectRoot, { recursive: true, force: true });
  });

  it('creates the database file on open', () => {
    expect(fs.existsSync(cfg.dbPath)).toBe(true);
  });

  it('returns the new items sorted by freshness and truncated to maxItems', () => {
    const items: RssItem[] = [
      item('a', '2026-06-01T08:00:00.000Z'),
      item('b', '2026-06-03T08:00:00.000Z'), // the freshest
      item('c', '2026-06-02T08:00:00.000Z'),
    ];

    const kept = selectNewItems(db, items, MAX_ITEMS);

    // maxItems = 2: we keep the two freshest, in descending order.
    expect(kept.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('returns [] on the 2nd call (items already marked)', () => {
    const items: RssItem[] = [
      item('a', '2026-06-01T08:00:00.000Z'),
      item('b', '2026-06-03T08:00:00.000Z'),
    ];

    const first = selectNewItems(db, items, MAX_ITEMS);
    expect(first.map((i) => i.id)).toEqual(['b', 'a']);

    // 2nd pass with the same items: everything has already been seen.
    const second = selectNewItems(db, items, MAX_ITEMS);
    expect(second).toEqual([]);
  });

  it('marks nothing when opts.mark = false', () => {
    const items: RssItem[] = [
      item('a', '2026-06-01T08:00:00.000Z'),
      item('b', '2026-06-03T08:00:00.000Z'),
    ];

    const first = selectNewItems(db, items, MAX_ITEMS, { mark: false });
    expect(first.map((i) => i.id)).toEqual(['b', 'a']);

    // Since nothing was marked, a second call returns the items again.
    const second = selectNewItems(db, items, MAX_ITEMS, { mark: false });
    expect(second.map((i) => i.id)).toEqual(['b', 'a']);

    // And a marking call afterwards still works normally.
    const third = selectNewItems(db, items, MAX_ITEMS);
    expect(third.map((i) => i.id)).toEqual(['b', 'a']);
    const fourth = selectNewItems(db, items, MAX_ITEMS);
    expect(fourth).toEqual([]);
  });
});
