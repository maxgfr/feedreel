import Database from 'better-sqlite3';
import path from 'node:path';
import type { CategoryConfig, GlobalConfig, RssItem } from '../types';
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
      id TEXT NOT NULL,
      category TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      PRIMARY KEY (category, id)
    )`,
  );
  return db;
}

/**
 * Selects the items never seen before for the category.
 *
 * - Discards `(category, id)` pairs already present in the database.
 * - Sorts by `publishedAt` DESCENDING (freshest first).
 * - Truncates to `category.maxItems`.
 * - If `opts.mark !== false`, marks the kept ids (`INSERT OR IGNORE`).
 *
 * Returns the kept items.
 */
export function selectNewItems(
  db: Database.Database,
  category: CategoryConfig,
  items: RssItem[],
  opts: { mark?: boolean } = {},
): RssItem[] {
  const seenStmt = db.prepare<[string, string], { id: string }>(
    'SELECT id FROM seen_items WHERE category = ? AND id = ?',
  );

  // Filter: keep only the items missing from the database for this category.
  const fresh = items.filter(
    (item) => seenStmt.get(category.id, item.id) === undefined,
  );

  // Sort by descending freshness (ISO 8601 date -> safe lexicographic comparison).
  fresh.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));

  // Truncate to the category's maximum number of items.
  const kept = fresh.slice(0, category.maxItems);

  // Marking (enabled by default): we only record the items actually kept.
  // NB: the orchestrator instead calls with { mark: false } then markSeen() AFTER
  // the category fully succeeds, so that a downstream failure does not "consume" the items.
  if (opts.mark !== false) {
    markSeen(db, category, kept);
  }

  log.info(`${category.id}: ${kept.length}/${items.length} item(s) kept`);
  return kept;
}

/**
 * Permanently marks items as seen for the category (`INSERT OR IGNORE`).
 * Call once the category has been processed successfully (idempotent).
 */
export function markSeen(
  db: Database.Database,
  category: CategoryConfig,
  items: RssItem[],
): void {
  if (items.length === 0) return;
  const insertStmt = db.prepare<[string, string, string]>(
    'INSERT OR IGNORE INTO seen_items (id, category, first_seen_at) VALUES (?, ?, ?)',
  );
  const now = new Date().toISOString();
  const insertMany = db.transaction((rows: RssItem[]) => {
    for (const row of rows) {
      insertStmt.run(row.id, category.id, now);
    }
  });
  insertMany(items);
}

/** Closes the database cleanly. */
export function closeDb(db: Database.Database): void {
  db.close();
}
