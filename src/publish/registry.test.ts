import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { GlobalConfig } from '../types';
import {
  closeRegistryDb,
  isPublished,
  listPublished,
  openRegistryDb,
  recordPublished,
} from './registry';

/** Minimal test config: in-memory SQLite database, no file on disk. */
function makeTestConfig(): GlobalConfig {
  return { dbPath: ':memory:' } as unknown as GlobalConfig;
}

describe('publish/registry', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openRegistryDb(makeTestConfig());
  });

  afterEach(() => {
    closeRegistryDb(db);
  });

  it('records a publication then isPublished returns true', () => {
    const key = { date: '2026-06-06', category: 'rust', platform: 'youtube' as const };
    expect(isPublished(db, key)).toBe(false);

    recordPublished(db, { ...key, videoId: 'abc123', url: 'https://youtu.be/abc123' });

    expect(isPublished(db, key)).toBe(true);
  });

  it('returns false for a missing key', () => {
    recordPublished(db, { date: '2026-06-06', category: 'rust', platform: 'youtube' });

    // Same date/category but different platform: not published.
    expect(isPublished(db, { date: '2026-06-06', category: 'rust', platform: 'tiktok' })).toBe(false);
    // Different date: not published.
    expect(isPublished(db, { date: '2026-06-05', category: 'rust', platform: 'youtube' })).toBe(false);
    // Different category: not published.
    expect(isPublished(db, { date: '2026-06-06', category: 'global', platform: 'youtube' })).toBe(false);
  });

  it('keeps videoId and url in listPublished', () => {
    recordPublished(db, {
      date: '2026-06-06',
      category: 'rust',
      platform: 'youtube',
      videoId: 'vid42',
      url: 'https://youtu.be/vid42',
    });

    const rows = listPublished(db);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.videoId).toBe('vid42');
    expect(row?.url).toBe('https://youtu.be/vid42');
    expect(row?.platform).toBe('youtube');
    // ISO 8601 timestamp present.
    expect(row?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('listPublished filters by date', () => {
    recordPublished(db, { date: '2026-06-06', category: 'rust', platform: 'youtube' });
    recordPublished(db, { date: '2026-06-06', category: 'global', platform: 'tiktok' });
    recordPublished(db, { date: '2026-06-05', category: 'rust', platform: 'youtube' });

    const rows = listPublished(db, { date: '2026-06-06' });
    expect(rows.map((r) => `${r.date}/${r.category}/${r.platform}`)).toEqual([
      '2026-06-06/global/tiktok',
      '2026-06-06/rust/youtube',
    ]);
  });

  it('listPublished filters by category', () => {
    recordPublished(db, { date: '2026-06-06', category: 'rust', platform: 'youtube' });
    recordPublished(db, { date: '2026-06-06', category: 'rust', platform: 'tiktok' });
    recordPublished(db, { date: '2026-06-06', category: 'global', platform: 'youtube' });

    const rows = listPublished(db, { category: 'rust' });
    expect(rows.map((r) => r.platform)).toEqual(['tiktok', 'youtube']);
  });

  it('listPublished filters by date AND category combined', () => {
    recordPublished(db, { date: '2026-06-06', category: 'rust', platform: 'youtube' });
    recordPublished(db, { date: '2026-06-06', category: 'rust', platform: 'tiktok' });
    recordPublished(db, { date: '2026-06-05', category: 'rust', platform: 'youtube' });
    recordPublished(db, { date: '2026-06-06', category: 'global', platform: 'youtube' });

    const rows = listPublished(db, { date: '2026-06-06', category: 'rust' });
    expect(rows.map((r) => r.platform)).toEqual(['tiktok', 'youtube']);
  });

  it('a double record (same PK) does not create a duplicate', () => {
    const key = { date: '2026-06-06', category: 'rust', platform: 'youtube' as const };

    recordPublished(db, { ...key, videoId: 'first', url: 'https://youtu.be/first' });
    recordPublished(db, { ...key, videoId: 'second', url: 'https://youtu.be/second' });

    const rows = listPublished(db);
    expect(rows).toHaveLength(1);
    // INSERT OR REPLACE: the last write wins.
    expect(rows[0]?.videoId).toBe('second');
    expect(rows[0]?.url).toBe('https://youtu.be/second');
  });
});
