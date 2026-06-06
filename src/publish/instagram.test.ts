/**
 * Tests for the Instagram Reels adapter — WITHOUT any real network.
 *
 * Covers:
 *  - `buildInstagramCaption` (PURE): ≤2200 characters, ≤30 hashtags, presence
 *    of the title / description / hashtags, double-line-break format.
 *  - `instagramAdapter.publish`: container → poll → media_publish sequence via
 *    a mocked `globalThis.fetch`, mocked `./hosting`, checks the `ok` status,
 *    the returned id / URL, and the call to `cleanup()`.
 *  - `instagramAdapter.publish` in `dry-run`: no network, `dry-run` status.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CategoryConfig, GlobalConfig } from '../types';
import type { PublishConfig } from '../../config/publish';
import type { PlatformMeta, PublishContext } from './types';

// Hosting mock: no network or disk access.
const cleanup = vi.fn(async () => {});
const uploadPublic = vi.fn(async () => ({
  url: 'https://cdn.example.test/feedreel/2026-06-06/rust.mp4',
  cleanup,
}));
const isHostingConfigured = vi.fn(() => true);

vi.mock('./hosting', () => ({
  uploadPublic: (...args: unknown[]) => uploadPublic(...(args as [])),
  isHostingConfigured: (...args: unknown[]) => isHostingConfigured(...(args as [])),
}));

import { buildInstagramCaption, instagramAdapter } from './instagram';

/** Fake category. */
const category: CategoryConfig = {
  id: 'rust',
  label: 'Rust',
  emoji: '🦀',
  accentColor: '#ff7043',
  maxItems: 5,
  feeds: ['https://example.test/feed.xml'],
};

/** Fake Instagram metadata. */
const meta: PlatformMeta = {
  title: "Today's Rust Tech Watch",
  description: 'On the agenda: stable async traits and ecosystem updates.',
  hashtags: ['#rust', '#dev', '#technews', '#programming', '#reels'],
};

/** Minimal publish config (Instagram enabled). */
const publish = {
  platforms: { instagram: { enabled: true } },
} as unknown as PublishConfig;

/** Minimal publish context. */
function makeCtx(overrides: Partial<PublishContext> = {}): PublishContext {
  return {
    platform: 'instagram',
    videoPath: '/tmp/output/2026-06-06/rust.mp4',
    meta,
    language: 'fr',
    privacy: 'public',
    dryRun: false,
    cfg: {} as unknown as GlobalConfig,
    publish,
    date: '2026-06-06',
    category,
    ...overrides,
  };
}

describe('buildInstagramCaption', () => {
  it('assembles title + description + hashtags and stays ≤ 2200 characters', () => {
    const caption = buildInstagramCaption(meta);
    expect(caption.length).toBeLessThanOrEqual(2200);
    expect(caption).toContain(meta.title);
    expect(caption).toContain(meta.description);
    for (const tag of meta.hashtags) {
      expect(caption).toContain(tag);
    }
    // Double line breaks between blocks.
    expect(caption).toContain('\n\n');
  });

  it('truncates cleanly beyond 2200 characters', () => {
    const long: PlatformMeta = {
      title: 'Titre',
      description: 'x'.repeat(3000),
      hashtags: ['#rust'],
    };
    const caption = buildInstagramCaption(long);
    // `util.truncate` cuts at `max` then appends "…": length ≤ max + 1.
    expect(caption.length).toBeLessThanOrEqual(2201);
    expect(caption.endsWith('…')).toBe(true);
  });

  it('caps hashtags at 30 maximum', () => {
    const many: PlatformMeta = {
      title: 'T',
      description: 'D',
      hashtags: Array.from({ length: 40 }, (_, i) => `#tag${i}`),
    };
    const caption = buildInstagramCaption(many);
    const tagsInCaption = caption.match(/#tag\d+/g) ?? [];
    expect(tagsInCaption.length).toBeLessThanOrEqual(30);
    // The 31st hashtag must not appear.
    expect(caption).not.toContain('#tag30 ');
  });
});

describe('instagramAdapter.isConfigured', () => {
  beforeEach(() => {
    process.env.IG_USER_ID = '123456';
    process.env.IG_ACCESS_TOKEN = 'secret-token';
    isHostingConfigured.mockReturnValue(true);
  });
  afterEach(() => {
    delete process.env.IG_USER_ID;
    delete process.env.IG_ACCESS_TOKEN;
  });

  it('true if enabled, credentials present and hosting configured', () => {
    expect(instagramAdapter.isConfigured('fr', publish)).toBe(true);
  });

  it('false if hosting is not configured', () => {
    isHostingConfigured.mockReturnValue(false);
    expect(instagramAdapter.isConfigured('fr', publish)).toBe(false);
  });

  it('false if credentials are missing', () => {
    delete process.env.IG_USER_ID;
    expect(instagramAdapter.isConfigured('fr', publish)).toBe(false);
  });
});

describe('instagramAdapter.publish', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.IG_USER_ID = '123456';
    process.env.IG_ACCESS_TOKEN = 'secret-token';
    cleanup.mockClear();
    uploadPublic.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.IG_USER_ID;
    delete process.env.IG_ACCESS_TOKEN;
    vi.restoreAllMocks();
  });

  it('follows the container → poll → publish sequence and returns ok + cleanup', async () => {
    // 1) /media → { id }, 2) ?fields=status_code → FINISHED, 3) /media_publish → { id }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'creation-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status_code: 'FINISHED' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'media-42' }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await instagramAdapter.publish(makeCtx());

    expect(result.status).toBe('ok');
    expect(result.videoId).toBe('media-42');
    expect(result.url).toBe('https://www.instagram.com/reel/media-42');
    expect(result.platform).toBe('instagram');
    expect(result.category).toBe('rust');

    // Three network calls in the expected order.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
    const thirdUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(firstUrl).toContain('/123456/media');
    expect(secondUrl).toContain('/creation-1');
    expect(secondUrl).toContain('fields=status_code');
    expect(thirdUrl).toContain('/123456/media_publish');

    // Hosting used then cleaned up.
    expect(uploadPublic).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('dry-run: no network, dry-run status, no hosting', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await instagramAdapter.publish(makeCtx({ dryRun: true }));

    expect(result.status).toBe('dry-run');
    expect(result.platform).toBe('instagram');
    expect(result.category).toBe('rust');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadPublic).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('error on container creation: error status and cleanup called', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'invalid video_url' } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await instagramAdapter.publish(makeCtx());

    expect(result.status).toBe('error');
    expect(result.error).toContain('invalid video_url');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
