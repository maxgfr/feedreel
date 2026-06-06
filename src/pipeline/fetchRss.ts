/**
 * Fetching and normalization of a category's RSS/Atom feeds (FR-1).
 *
 * Two responsibilities:
 *  - `normalizeRssItems`: a PURE function that turns a parsed feed object
 *    (output of rss-parser) into an array of normalized, de-duplicated `RssItem`.
 *  - `fetchCategory`: a network side effect that downloads all of the category's
 *    feeds in parallel, parses each one, then aggregates the normalized items.
 *    A failing feed is silently ignored (warn log, we keep going).
 */

import Parser from 'rss-parser';
import type { CategoryConfig, GlobalConfig, RssItem } from '../types';
import { domainOf, stripHtml, truncate } from '../util';
import { createLogger } from '../log';

const logger = createLogger('fetchRss');

/** Maximum length of the normalized summary (see contract §FR-1). */
const SUMMARY_MAX = 280;

/** Minimal (and lenient) shape of a feed entry as produced by rss-parser. */
interface RawFeedItem {
  guid?: unknown;
  link?: unknown;
  title?: unknown;
  contentSnippet?: unknown;
  content?: unknown;
  summary?: unknown;
  isoDate?: unknown;
  pubDate?: unknown;
}

/** Returns the value if it is a non-empty string, otherwise `undefined`. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Date floor for items without a usable date (ranks them LAST). */
const DATE_FLOOR = new Date(0).toISOString();

/**
 * Converts a date (isoDate then pubDate) into an ISO 8601 string.
 * Falls back to a FLOOR (epoch) if nothing usable: an item without a date must
 * not be wrongly treated as "the freshest" (which would disrupt the freshness
 * sort of the dedup and the 'global' aggregation). It is therefore ranked last.
 */
function toIsoDate(isoDate?: string, pubDate?: string): string {
  const candidate = isoDate ?? pubDate;
  if (candidate) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return DATE_FLOOR;
}

/**
 * Normalizes the entries of ONE already-parsed feed into `RssItem` (PURE, no network).
 *
 * Rules:
 *  - `id` = guid otherwise link; an entry without guid or link is discarded.
 *  - `url` = link (otherwise, failing that, the guid); `source` = domain of the url.
 *  - `summary` = `truncate(stripHtml(contentSnippet|content|summary), 280)`.
 *  - `publishedAt` = ISO 8601 from isoDate|pubDate (fallback: now).
 *  - de-duplication by `id` (first occurrence kept).
 *
 * @param parsed Object returned by `Parser.parseString` (typed `unknown` per contract).
 * @param categoryId Identifier of the category, copied into each item.
 */
export function normalizeRssItems(parsed: unknown, categoryId: string): RssItem[] {
  const rawItems = extractItems(parsed);
  const result: RssItem[] = [];
  const seen = new Set<string>();

  for (const raw of rawItems) {
    const guid = asString(raw.guid);
    const link = asString(raw.link);
    const id = guid ?? link;
    // Without a stable identifier we can neither de-duplicate nor track the item.
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const url = link ?? guid ?? '';
    const rawSummary = asString(raw.contentSnippet) ?? asString(raw.content) ?? asString(raw.summary) ?? '';

    result.push({
      id,
      category: categoryId,
      title: asString(raw.title) ?? '',
      url,
      summary: truncate(stripHtml(rawSummary), SUMMARY_MAX),
      source: domainOf(url),
      publishedAt: toIsoDate(asString(raw.isoDate), asString(raw.pubDate)),
    });
  }

  return result;
}

/** Extracts the `items` array from a parsed feed object, defensively. */
function extractItems(parsed: unknown): RawFeedItem[] {
  if (parsed && typeof parsed === 'object' && 'items' in parsed) {
    const items = (parsed as { items?: unknown }).items;
    if (Array.isArray(items)) return items as RawFeedItem[];
  }
  return [];
}

/**
 * Downloads a feed (fetch bounded by AbortController + `cfg.feedTimeoutMs`),
 * parses it via rss-parser, and returns its normalized items.
 * Any error (timeout, non-OK HTTP, parse) is propagated to the caller
 * (caught higher up by `Promise.allSettled`).
 */
async function fetchFeed(
  feedUrl: string,
  categoryId: string,
  cfg: GlobalConfig,
): Promise<RssItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.feedTimeoutMs);
  try {
    const response = await fetch(feedUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const xml = await response.text();
    const parsed = await new Parser().parseString(xml);
    return normalizeRssItems(parsed, categoryId);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches ALL of the category's feeds in parallel (`Promise.allSettled`).
 * A failing feed is silently ignored (warn log, we keep going).
 * The items from successful feeds are aggregated then de-duplicated by `id`
 * at the category scope (the same article may appear in 2 feeds).
 */
export async function fetchCategory(
  category: CategoryConfig,
  cfg: GlobalConfig,
): Promise<RssItem[]> {
  const settled = await Promise.allSettled(
    category.feeds.map((feedUrl) => fetchFeed(feedUrl, category.id, cfg)),
  );

  const merged: RssItem[] = [];
  const seen = new Set<string>();

  settled.forEach((outcome, index) => {
    const feedUrl = category.feeds[index] ?? '<unknown>';
    if (outcome.status === 'rejected') {
      logger.warn(`Feed ignored (${feedUrl}): ${String(outcome.reason)}`);
      return;
    }
    for (const item of outcome.value) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  });

  return merged;
}
