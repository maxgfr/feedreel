/**
 * Unit tests for fetchRss: no real network dependency.
 *  - `normalizeRssItems` is tested as a pure function against a fixture.
 *  - `fetchFeeds` is tested with a mocked `global.fetch` (rejection) to verify
 *    that a failing feed does not crash the run.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlobalConfig } from '../types';
import { fetchFeeds, normalizeRssItems } from './fetchRss';

/** Parsed feed object (rss-parser shape) used as a fixture. */
const parsedFeedFixture = {
  title: 'Krebs on Security',
  link: 'https://krebsonsecurity.com/',
  items: [
    {
      guid: 'guid-001',
      link: 'https://krebsonsecurity.com/2026/06/article-a/',
      title: 'Critical vulnerability discovered',
      contentSnippet:
        '<p>A <strong>critical</strong> vulnerability that it&#39;s&nbsp;been found ' +
        'in a widely deployed component. '.repeat(20),
      isoDate: '2026-06-04T09:30:00.000Z',
      pubDate: 'Wed, 04 Jun 2026 09:30:00 GMT',
    },
    {
      // No guid: the id must fall back to the link.
      link: 'https://www.bleepingcomputer.com/news/article-b/',
      title: 'Security update',
      content: '<div>HTML <em>summary</em> to clean.</div>',
      pubDate: 'Wed, 04 Jun 2026 08:00:00 GMT',
    },
    {
      // Duplicate of the first item (same guid): must be eliminated.
      guid: 'guid-001',
      link: 'https://krebsonsecurity.com/2026/06/article-a-bis/',
      title: 'Duplicate',
      contentSnippet: 'Duplicate to ignore.',
      isoDate: '2026-06-04T10:00:00.000Z',
    },
    {
      // Neither guid nor link: item discarded (no stable identifier).
      title: 'Without identifier',
      contentSnippet: 'To discard.',
    },
  ],
};

describe('normalizeRssItems', () => {
  it('normalizes a parsed feed: HTML stripped, truncation, domain, ISO date, id, dedup', () => {
    const items = normalizeRssItems(parsedFeedFixture);

    // De-duplication by id + rejection of the item without identifier: 2 items remaining.
    expect(items).toHaveLength(2);

    const [first, second] = items;
    if (!first || !second) throw new Error('missing items');

    // id = guid when present.
    expect(first.id).toBe('guid-001');
    // url = link.
    expect(first.url).toBe('https://krebsonsecurity.com/2026/06/article-a/');
    // source = domain without www.
    expect(first.source).toBe('krebsonsecurity.com');
    // HTML stripped: no more tags in the summary.
    expect(first.summary).not.toMatch(/<[^>]+>/);
    expect(first.summary).toContain('critical');
    // HTML entities decoded by stripHtml.
    expect(first.summary).toContain("it's");
    // Truncation to 280 characters (+ possible ellipsis).
    expect(first.summary.length).toBeLessThanOrEqual(281);
    expect(first.summary.endsWith('…')).toBe(true);
    // Date converted to ISO 8601.
    expect(first.publishedAt).toBe('2026-06-04T09:30:00.000Z');

    // Second item: id = link (no guid), date derived from pubDate.
    expect(second.id).toBe('https://www.bleepingcomputer.com/news/article-b/');
    expect(second.source).toBe('bleepingcomputer.com');
    expect(second.summary).toBe('HTML summary to clean.');
    expect(second.publishedAt).toBe(new Date('Wed, 04 Jun 2026 08:00:00 GMT').toISOString());
  });

  it('falls back publishedAt to the epoch floor when the date is missing or invalid', () => {
    // An unreadable date must NOT be treated as "the freshest" (otherwise it would
    // disrupt the freshness sort of the dedup): we rank it last.
    const items = normalizeRssItems({
      items: [{ guid: 'x', link: 'https://example.com/a', title: 'T', pubDate: 'not-a-date' }],
    });
    expect(items).toHaveLength(1);
    const item = items[0];
    if (!item) throw new Error('missing item');
    expect(item.publishedAt).toBe(new Date(0).toISOString());
  });

  it('returns an empty array for an unusable input', () => {
    expect(normalizeRssItems(null)).toEqual([]);
    expect(normalizeRssItems({})).toEqual([]);
    expect(normalizeRssItems({ items: 'not-an-array' })).toEqual([]);
  });
});

/** Minimal config for `fetchFeeds` (only feedTimeoutMs matters here). */
const cfg: GlobalConfig = {
  projectRoot: '/tmp/project',
  outputDir: '/tmp/project/output',
  cacheDir: '/tmp/project/cache',
  dbPath: '/tmp/project/feedreel.db',
  fps: 30,
  width: 1080,
  height: 1920,
  feedTimeoutMs: 50,
  language: {
    name: 'English',
    uiLabel: 'NEWS',
    dateLocale: 'en-US',
    topLabel: 'Top',
    subscribeLabel: 'Subscribe',
    joinLabel: 'Join the debate',
    sourcesLabel: 'Sources',
  },
  video: { label: 'Daily News', emoji: '📰', accentColor: '#4ea8ff', maxItems: 6, subscribeText: 'Subscribe' },
  feeds: [],
  music: { dir: 'assets/music', fadeSec: 1.5, volume: 1 },
  scene: { introSec: 3, itemSec: 4, outroSec: 3 },
};

describe('fetchFeeds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fail when a feed rejects (fetch in error)', async () => {
    // global.fetch mocked: always rejected. No real network.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network unavailable'))),
    );

    const items = await fetchFeeds(['https://feed-a.test/rss', 'https://feed-b.test/rss'], cfg);
    // All feeds failed: no items, but no exception.
    expect(items).toEqual([]);
  });

  it('returns an empty array with no feeds (no network call)', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('must not be called')));
    vi.stubGlobal('fetch', fetchSpy);

    const items = await fetchFeeds([], cfg);
    expect(items).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
