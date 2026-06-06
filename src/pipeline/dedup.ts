import Database from 'better-sqlite3';
import path from 'node:path';
import type { GlobalConfig, RssItem } from '../types';
import { ensureDir } from '../util';
import { createLogger } from '../log';

const log = createLogger('dedup');

/**
 * Opens (and initializes) the SQLite deduplication database.
 * Creates the parent directory and the `seen_items` table if needed.
 */
export function openDb(cfg: GlobalConfig): Database.Database {
  // Make sure the database folder exists (the database itself may not exist yet).
  ensureDir(path.dirname(cfg.dbPath));
  const db = new Database(cfg.dbPath);
  // WAL: better performance for the pipeline's sequential read/write workload.
  db.pragma('journal_mode = WAL');
  db.exec(
    `CREATE TABLE IF NOT EXISTS seen_items (
      id TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL
    )`,
  );
  return db;
}

/**
 * Selects the items never seen before.
 *
 * - Discards ids already present in the database.
 * - Sorts by `publishedAt` DESCENDING (freshest first).
 * - Truncates to `maxItems`.
 * - If `opts.mark !== false`, marks the kept ids (`INSERT OR IGNORE`).
 *
 * Returns the kept items.
 */
export function selectNewItems(
  db: Database.Database,
  items: RssItem[],
  maxItems: number,
  opts: { mark?: boolean } = {},
): RssItem[] {
  const seenStmt = db.prepare<[string], { id: string }>('SELECT id FROM seen_items WHERE id = ?');

  // Keep only the items missing from the database.
  const fresh = items.filter((item) => seenStmt.get(item.id) === undefined);

  // Sort by descending freshness (ISO 8601 date -> safe lexicographic comparison).
  fresh.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));

  // Truncate to the maximum number of items.
  const kept = fresh.slice(0, maxItems);

  // Marking (enabled by default): we only record the items actually kept.
  // NB: the orchestrator instead calls with { mark: false } then markSeen() AFTER
  // the video fully succeeds, so a downstream failure does not "consume" the items.
  if (opts.mark !== false) {
    markSeen(db, kept);
  }

  log.info(`${kept.length}/${items.length} item(s) kept`);
  return kept;
}

/**
 * Permanently marks items as seen (`INSERT OR IGNORE`).
 * Call once the video has been produced successfully (idempotent).
 */
export function markSeen(db: Database.Database, items: RssItem[]): void {
  if (items.length === 0) return;
  const insertStmt = db.prepare<[string, string]>(
    'INSERT OR IGNORE INTO seen_items (id, first_seen_at) VALUES (?, ?)',
  );
  const now = new Date().toISOString();
  const insertMany = db.transaction((rows: RssItem[]) => {
    for (const row of rows) {
      insertStmt.run(row.id, now);
    }
  });
  insertMany(items);
}

/** Closes the database cleanly. */
export function closeDb(db: Database.Database): void {
  db.close();
}
