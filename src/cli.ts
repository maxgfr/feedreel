/**
 * feedreel command-line interface (commander).
 *
 * Commands:
 *   prepare [--date] [--category]                  fetch + dedup, writes items, summary
 *   run     [--date] [--category] [--no-render] [--mode file|auto]   full pipeline
 *   build   <category> [--date] [--no-render] [--mode]               run a single category
 *   fetch   <category>                              debug: fetchCategory + print the items
 *
 * Exit codes:
 *   - 0 even if some categories fail;
 *   - 1 if ALL categories fail (or on a fatal error).
 */
import { Command } from 'commander';
import type { RssItem } from './types';
import { loadConfig, paths } from '../config/index';
import { CATEGORIES, getCategory } from '../config/categories';
import { today } from './util';
import { log } from './log';
import { fetchCategory } from './pipeline/fetchRss';
import { openDb, closeDb } from './pipeline/dedup';
import { run, prepareCategory, type CategoryResult } from './pipeline/orchestrate';
import type { SummarizeMode } from './pipeline/summarize';
import { loadPublishConfig } from '../config/publish';
import {
  generateAllCaptions,
  publish as publishVideos,
  parsePlatforms,
  type CaptionResult,
} from './publish/orchestrate';
import type { Privacy, PublishResult } from './publish/types';

/** Validates and normalizes the `--mode` option (defaults to 'auto'). */
function parseMode(value: string | undefined): SummarizeMode {
  if (value === undefined) return 'auto';
  if (value === 'file' || value === 'auto') return value;
  throw new Error(`Invalid mode: "${value}". Expected: file | auto.`);
}

/** Prints a summary table of the results per category. */
function printSummary(results: CategoryResult[]): void {
  const rows = results.map((r) => ({
    category: r.category,
    status: r.status,
    output: r.outputFile ?? r.error ?? '',
  }));
  // eslint-disable-next-line no-console
  console.table(rows);
}

/** True if the whole run failed (at least one category AND all in error). */
function allFailed(results: CategoryResult[]): boolean {
  return results.length > 0 && results.every((r) => r.status === 'error');
}

/** Validates the `--privacy` option (leaves `undefined` = config default). */
function parsePrivacy(value: string | undefined): Privacy | undefined {
  if (value === undefined) return undefined;
  if (value === 'private' || value === 'unlisted' || value === 'public') return value;
  throw new Error(`Invalid privacy: "${value}". Expected: private | unlisted | public.`);
}

/** Prints a summary of the captions generated per category. */
function printCaptionSummary(results: CaptionResult[]): void {
  const rows = results.map((r) => ({
    category: r.category,
    status: r.status,
    file: r.file ?? r.error ?? '',
  }));
  // eslint-disable-next-line no-console
  console.table(rows);
}

/** Prints a summary of the publications per (category × platform). */
function printPublishSummary(results: PublishResult[]): void {
  const rows = results.map((r) => ({
    category: r.category,
    platform: r.platform,
    status: r.status,
    detail: r.url ?? r.error ?? r.videoId ?? '',
  }));
  // eslint-disable-next-line no-console
  console.table(rows);
}

/** True if the whole pass failed (at least one result AND all in error). */
function allPublishFailed(results: PublishResult[]): boolean {
  return results.length > 0 && results.every((r) => r.status === 'error');
}

/**
 * `prepare` command: fetches + deduplicates the items and writes the JSON cache,
 * without generating a script or a video. Useful to inspect what will be processed.
 */
async function cmdPrepare(opts: { date?: string; category?: string }): Promise<number> {
  const cfg = loadConfig();
  const date = opts.date ?? today();
  const categories = opts.category ? [getCategory(opts.category)] : CATEGORIES;
  const db = openDb(cfg);
  const rows: Array<{ category: string; items: number; file: string }> = [];

  try {
    for (const category of categories) {
      if (category.aggregate) {
        // The aggregated category has no feed of its own: nothing to prepare here.
        rows.push({ category: category.id, items: 0, file: '(aggregated — skipped)' });
        continue;
      }
      const items = await prepareCategory({ category, cfg, date, db });
      const { itemsFile } = paths(cfg, date, category.id);
      rows.push({ category: category.id, items: items.length, file: itemsFile });
    }
  } finally {
    closeDb(db);
  }

  // eslint-disable-next-line no-console
  console.table(rows);
  return 0;
}

/**
 * `run` command: runs the full pipeline (all categories or a single one via
 * --category). Exits 1 only if ALL categories fail.
 */
async function cmdRun(opts: {
  date?: string;
  category?: string;
  render?: boolean;
  mode?: string;
  publish?: boolean;
}): Promise<number> {
  const results = await run({
    date: opts.date,
    categoryId: opts.category,
    render: opts.render,
    mode: parseMode(opts.mode),
  });
  printSummary(results);
  const code = allFailed(results) ? 1 : 0;

  // OPTIONAL publishing step (--publish), gated by the master `enabled` switch in
  // config/publish.yaml: automatic publishing only happens when enabled.
  // Best-effort: a publishing failure does NOT invalidate a successful render (the
  // exit code stays the one of the render) — the error is only logged.
  if (opts.publish) {
    try {
      const pub = loadPublishConfig();
      if (!pub.enabled) {
        log.info(
          'Social publishing disabled (config/publish.yaml: enabled=false) — step skipped.',
        );
      } else {
        log.info('Social publishing (after render)…');
        const pubResults = await publishVideos({ date: opts.date, categoryId: opts.category });
        printPublishSummary(pubResults);
      }
    } catch (e) {
      log.error(`Publishing step skipped (error): ${String(e)}`);
    }
  }
  return code;
}

/**
 * `captions` command: generates (Claude) the titles/descriptions/hashtags per
 * platform, in the language of each category → cache/metadata/<date>/<cat>.json.
 * No publishing, no secret required.
 */
async function cmdCaptions(opts: {
  date?: string;
  category?: string;
  mode?: string;
  platforms?: string;
}): Promise<number> {
  const results = await generateAllCaptions({
    date: opts.date,
    categoryId: opts.category,
    mode: opts.mode === undefined ? undefined : parseMode(opts.mode),
    platforms: parsePlatforms(opts.platforms),
  });
  printCaptionSummary(results);
  return results.length > 0 && results.every((r) => r.status === 'error') ? 1 : 0;
}

/**
 * `publish` command: publishes the rendered videos to the active platforms
 * (opt-in, fault-tolerant, idempotent). `--dry-run` performs NO network call.
 */
async function cmdPublish(opts: {
  date?: string;
  category?: string;
  platforms?: string;
  dryRun?: boolean;
  privacy?: string;
  force?: boolean;
}): Promise<number> {
  const results = await publishVideos({
    date: opts.date,
    categoryId: opts.category,
    platforms: parsePlatforms(opts.platforms),
    dryRun: opts.dryRun,
    privacy: parsePrivacy(opts.privacy),
    force: opts.force,
  });
  printPublishSummary(results);
  return allPublishFailed(results) ? 1 : 0;
}

/**
 * `build <category>` command: runs the pipeline for a single category.
 * Exits 1 if that category fails.
 */
async function cmdBuild(
  category: string,
  opts: { date?: string; render?: boolean; mode?: string },
): Promise<number> {
  const results = await run({
    date: opts.date,
    categoryId: category,
    render: opts.render,
    mode: parseMode(opts.mode),
  });
  printSummary(results);
  return allFailed(results) ? 1 : 0;
}

/**
 * `fetch <category>` command: debug — fetches a category's feeds and prints the
 * normalized items, without dedup or writing (read-only).
 */
async function cmdFetch(category: string): Promise<number> {
  const cfg = loadConfig();
  const cat = getCategory(category);
  const items: RssItem[] = await fetchCategory(cat, cfg);
  // eslint-disable-next-line no-console
  console.log(`${items.length} item(s) for "${cat.id}":`);
  for (const it of items) {
    // eslint-disable-next-line no-console
    console.log(`- [${it.publishedAt}] ${it.source} — ${it.title}\n  ${it.url}`);
  }
  return 0;
}

/** Builds the commander program. */
function buildProgram(): Command {
  const program = new Command();
  program
    .name('feedreel')
    .description('Local-first generator of daily tech-watch videos (FR).')
    .showHelpAfterError();

  program
    .command('prepare')
    .description('Fetches and deduplicates the items, writes the JSON cache (no script or video).')
    .option('-d, --date <date>', 'target date (YYYY-MM-DD), defaults to today')
    .option('-c, --category <id>', 'limit to a single category')
    .action(async (opts: { date?: string; category?: string }) => {
      process.exitCode = await cmdPrepare(opts);
    });

  program
    .command('run')
    .description('Runs the full pipeline (all categories or --category).')
    .option('-d, --date <date>', 'target date (YYYY-MM-DD), defaults to today')
    .option('-c, --category <id>', 'limit to a single category')
    .option('--no-render', 'generates the script + audio without rendering the video')
    .option('-m, --mode <mode>', 'script generation mode: file | auto', 'auto')
    .option('--publish', 'publishes the videos after the render (if config/publish.yaml: enabled)')
    .action(
      async (opts: {
        date?: string;
        category?: string;
        render?: boolean;
        mode?: string;
        publish?: boolean;
      }) => {
        process.exitCode = await cmdRun(opts);
      },
    );

  program
    .command('build')
    .description('Runs the pipeline for a single category.')
    .argument('<category>', 'category id')
    .option('-d, --date <date>', 'target date (YYYY-MM-DD), defaults to today')
    .option('--no-render', 'generates the script + audio without rendering the video')
    .option('-m, --mode <mode>', 'script generation mode: file | auto', 'auto')
    .action(
      async (
        category: string,
        opts: { date?: string; render?: boolean; mode?: string },
      ) => {
        process.exitCode = await cmdBuild(category, opts);
      },
    );

  program
    .command('fetch')
    .description('Debug: fetches and prints the normalized items of a category.')
    .argument('<category>', 'category id')
    .action(async (category: string) => {
      process.exitCode = await cmdFetch(category);
    });

  program
    .command('captions')
    .description('Generates the titles/descriptions/hashtags per platform (cache/metadata).')
    .option('-d, --date <date>', 'target date (YYYY-MM-DD), defaults to today')
    .option('-c, --category <id>', 'limit to a single category')
    .option('-m, --mode <mode>', 'mode: file | auto (default: config publish.captions.mode)')
    .option('-p, --platforms <list>', 'targeted platforms (e.g. yt,tt,ig), default: all active ones')
    .action(
      async (opts: { date?: string; category?: string; mode?: string; platforms?: string }) => {
        process.exitCode = await cmdCaptions(opts);
      },
    );

  program
    .command('publish')
    .description('Publishes the rendered videos to the active platforms (opt-in).')
    .option('-d, --date <date>', 'target date (YYYY-MM-DD), defaults to today')
    .option('-c, --category <id>', 'limit to a single category')
    .option('-p, --platforms <list>', 'targeted platforms (e.g. yt,tt,ig), default: all active ones')
    .option('--dry-run', 'prints the planned posts without ANY network call')
    .option('--privacy <level>', 'visibility: private | unlisted | public (default: config)')
    .option('--force', 'republishes even if already published (ignores the idempotency registry)')
    .action(
      async (opts: {
        date?: string;
        category?: string;
        platforms?: string;
        dryRun?: boolean;
        privacy?: string;
        force?: boolean;
      }) => {
        process.exitCode = await cmdPublish(opts);
      },
    );

  return program;
}

/** Entry point: parses the arguments, runs, and handles errors cleanly. */
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (e) {
    log.error(String(e));
    process.exitCode = 1;
  }
}

// Direct launch (tsx src/cli.ts ...).
void main();
