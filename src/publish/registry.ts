import Database from 'better-sqlite3';
import path from 'node:path';
import type { GlobalConfig } from '../types';
import type { PlatformId } from './types';
import { ensureDir } from '../util';
import { createLogger } from '../log';

const log = createLogger('publish:registry');

/**
 * Row of the idempotency registry: one successful publication for
 * a (date, category, platform) triple.
 */
export interface PublishedRow {
  date: string;
  category: string;
  platform: PlatformId;
  videoId: string;
  url: string;
  publishedAt: string;
}

/**
 * Opens (and initializes) the SQLite publication idempotency registry.
 *
 * Reuses the SAME database as deduplication (`cfg.dbPath`) to keep
 * a single local state file. Creates the parent directory and the
 * `published` table if needed.
 */
export function openRegistryDb(cfg: GlobalConfig): Database.Database {
  // Make sure the database folder exists (the database itself may not exist yet).
  ensureDir(path.dirname(cfg.dbPath));
  const db = new Database(cfg.dbPath);
  // WAL: consistent with the rest of the pipeline (sequential read/write).
  db.pragma('journal_mode = WAL');
  db.exec(
    `CREATE TABLE IF NOT EXISTS published (
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      platform TEXT NOT NULL,
      video_id TEXT,
      url TEXT,
      published_at TEXT NOT NULL,
      PRIMARY KEY (date, category, platform)
    )`,
  );
  return db;
}

/**
 * True if a publication has already been recorded for this triple
 * (date × category × platform). Acts as an idempotency safeguard.
 */
export function isPublished(
  db: Database.Database,
  key: { date: string; category: string; platform: PlatformId },
): boolean {
  const stmt = db.prepare<[string, string, string], { 1: number }>(
    'SELECT 1 FROM published WHERE date = ? AND category = ? AND platform = ? LIMIT 1',
  );
  return stmt.get(key.date, key.category, key.platform) !== undefined;
}

/**
 * Records (or replaces) a successful publication.
 *
 * `INSERT OR REPLACE`: a new record for the same triple overwrites
 * the previous one (no duplicate). `published_at` is timestamped
 * at call time (ISO 8601).
 */
export function recordPublished(
  db: Database.Database,
  rec: { date: string; category: string; platform: PlatformId; videoId?: string; url?: string },
): void {
  const stmt = db.prepare<[string, string, string, string, string, string]>(
    `INSERT OR REPLACE INTO published (date, category, platform, video_id, url, published_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const publishedAt = new Date().toISOString();
  stmt.run(rec.date, rec.category, rec.platform, rec.videoId ?? '', rec.url ?? '', publishedAt);
  log.info(`recorded: ${rec.date}/${rec.category}/${rec.platform}`);
}

/**
 * Lists recorded publications, with optional filtering by date
 * and/or category. Stable sort by (date, category, platform).
 */
export function listPublished(
  db: Database.Database,
  opts: { date?: string; category?: string } = {},
): PublishedRow[] {
  // Dynamically build the WHERE clause based on the provided filters.
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts.date !== undefined) {
    clauses.push('date = ?');
    params.push(opts.date);
  }
  if (opts.category !== undefined) {
    clauses.push('category = ?');
    params.push(opts.category);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  interface Raw {
    date: string;
    category: string;
    platform: string;
    video_id: string | null;
    url: string | null;
    published_at: string;
  }

  const stmt = db.prepare<string[], Raw>(
    `SELECT date, category, platform, video_id, url, published_at
     FROM published
     ${where}
     ORDER BY date ASC, category ASC, platform ASC`,
  );
  const rows = stmt.all(...params);

  return rows.map((row) => ({
    date: row.date,
    category: row.category,
    platform: row.platform as PlatformId,
    videoId: row.video_id ?? '',
    url: row.url ?? '',
    publishedAt: row.published_at,
  }));
}

/** Cleanly closes the registry. */
export function closeRegistryDb(db: Database.Database): void {
  db.close();
}
