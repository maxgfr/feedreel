/**
 * Tests for the TikTok adapter.
 *
 * NO real network call: we test the PURE functions (caption, privacy, chunking
 * plan) and `isConfigured` with the environment cleared then restored.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildTikTokCaption,
  tiktokPrivacy,
  chunkPlan,
  tiktokAdapter,
} from './tiktok';
import type { PlatformMeta } from './types';
import type { PublishConfig } from '../../config/publish';

/** Minimal publish config with TikTok enabled for the `isConfigured` tests. */
function publishCfg(
  overrides?: Partial<PublishConfig['platforms']['tiktok']>,
): PublishConfig {
  return {
    enabled: true,
    defaultPrivacy: 'private',
    captions: { mode: 'auto' },
    platforms: {
      youtube: { enabled: true, categoryId: '28' },
      tiktok: { enabled: true, mode: 'inbox', ...overrides },
      instagram: { enabled: true },
    },
    hosting: { provider: 'r2', bucket: '', publicBaseUrl: '' },
    i18n: {},
  };
}

describe('buildTikTokCaption', () => {
  it('concatenates the title and hashtags separated by spaces', () => {
    const meta: PlatformMeta = {
      title: 'Tech news of the day',
      description: 'desc',
      hashtags: ['#tech', '#technews', '#dev'],
    };
    expect(buildTikTokCaption(meta)).toBe(
      'Tech news of the day #tech #technews #dev',
    );
  });

  it('includes the hashtags in the caption', () => {
    const meta: PlatformMeta = {
      title: 'Title',
      description: '',
      hashtags: ['#ia', '#cloud'],
    };
    const caption = buildTikTokCaption(meta);
    expect(caption).toContain('#ia');
    expect(caption).toContain('#cloud');
  });

  it('truncates the caption to 2200 characters', () => {
    const meta: PlatformMeta = {
      title: 'x'.repeat(3000),
      description: '',
      hashtags: ['#tech'],
    };
    const caption = buildTikTokCaption(meta);
    // `util.truncate` cuts at 2200 then appends the "…" character (so ≤ 2201).
    expect(caption.length).toBeLessThanOrEqual(2201);
    expect(caption.length).toBeLessThan(3000);
    expect(caption.endsWith('…')).toBe(true);
  });
});

describe('tiktokPrivacy', () => {
  it('maps "public" to PUBLIC_TO_EVERYONE', () => {
    expect(tiktokPrivacy('public')).toBe('PUBLIC_TO_EVERYONE');
  });

  it('maps "private" to SELF_ONLY', () => {
    expect(tiktokPrivacy('private')).toBe('SELF_ONLY');
  });

  it('maps "unlisted" to SELF_ONLY', () => {
    expect(tiktokPrivacy('unlisted')).toBe('SELF_ONLY');
  });
});

describe('chunkPlan', () => {
  it('returns a single chunk for a small file', () => {
    const plan = chunkPlan(5 * 1024 * 1024);
    expect(plan).toEqual({ chunkSize: 5 * 1024 * 1024, totalChunkCount: 1 });
  });

  it('returns a single chunk exactly at the 64 MB limit', () => {
    const size = 64 * 1024 * 1024;
    expect(chunkPlan(size)).toEqual({ chunkSize: size, totalChunkCount: 1 });
  });

  it('handles an empty file (a single chunk)', () => {
    expect(chunkPlan(0)).toEqual({ chunkSize: 0, totalChunkCount: 1 });
  });

  it('splits a large file into 10 MB chunks (ceil)', () => {
    const size = 100 * 1024 * 1024; // 100 MB
    const plan = chunkPlan(size);
    expect(plan.chunkSize).toBe(10 * 1024 * 1024);
    expect(plan.totalChunkCount).toBe(Math.ceil(size / (10 * 1024 * 1024)));
    expect(plan.totalChunkCount).toBe(10);
  });

  it('rounds up when the size is not a multiple', () => {
    const size = 65 * 1024 * 1024; // > 64 MB
    const plan = chunkPlan(size);
    expect(plan.chunkSize).toBe(10 * 1024 * 1024);
    expect(plan.totalChunkCount).toBe(7); // ceil(65/10)
  });
});

describe('tiktokAdapter.isConfigured', () => {
  let savedToken: string | undefined;
  let savedTokenFr: string | undefined;

  beforeEach(() => {
    savedToken = process.env.TIKTOK_ACCESS_TOKEN;
    savedTokenFr = process.env.TIKTOK_ACCESS_TOKEN_FR;
    delete process.env.TIKTOK_ACCESS_TOKEN;
    delete process.env.TIKTOK_ACCESS_TOKEN_FR;
  });

  afterEach(() => {
    if (savedToken === undefined) delete process.env.TIKTOK_ACCESS_TOKEN;
    else process.env.TIKTOK_ACCESS_TOKEN = savedToken;
    if (savedTokenFr === undefined) delete process.env.TIKTOK_ACCESS_TOKEN_FR;
    else process.env.TIKTOK_ACCESS_TOKEN_FR = savedTokenFr;
  });

  it('has the id "tiktok"', () => {
    expect(tiktokAdapter.id).toBe('tiktok');
  });

  it('is not configured without a token', () => {
    expect(tiktokAdapter.isConfigured('fr', publishCfg())).toBe(false);
  });

  it('is configured when the token is present and the platform enabled', () => {
    process.env.TIKTOK_ACCESS_TOKEN = 'tok-123';
    expect(tiktokAdapter.isConfigured('fr', publishCfg())).toBe(true);
  });

  it('is not configured if the platform is disabled even with a token', () => {
    process.env.TIKTOK_ACCESS_TOKEN = 'tok-123';
    const cfg = publishCfg();
    cfg.platforms.tiktok.enabled = false;
    expect(tiktokAdapter.isConfigured('fr', cfg)).toBe(false);
  });

  it('uses the language-specific token (fallback)', () => {
    process.env.TIKTOK_ACCESS_TOKEN_FR = 'tok-fr';
    expect(tiktokAdapter.isConfigured('fr', publishCfg())).toBe(true);
    expect(tiktokAdapter.isConfigured('en', publishCfg())).toBe(false);
  });
});

describe('tiktokAdapter.publish', () => {
  it('respects dryRun and makes no network call', async () => {
    const ctx = {
      platform: 'tiktok' as const,
      videoPath: '/nonexistent/video.mp4',
      meta: { title: 'T', description: '', hashtags: ['#a'] },
      language: 'fr',
      privacy: 'private' as const,
      dryRun: true,
      cfg: {} as never,
      publish: publishCfg(),
      date: '2026-06-06',
      category: { id: 'ia' } as never,
    };
    const res = await tiktokAdapter.publish(ctx);
    expect(res.status).toBe('dry-run');
    expect(res.platform).toBe('tiktok');
    expect(res.category).toBe('ia');
  });
});
