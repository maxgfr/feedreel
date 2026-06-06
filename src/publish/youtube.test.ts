/**
 * Tests for the YouTube Shorts adapter.
 *
 * NO network calls: we test the pure function `buildYouTubeRequestBody`,
 * configuration detection (`isConfigured`) and the `dry-run` mode.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildYouTubeRequestBody, youtubeAdapter } from './youtube';
import type { PublishConfig } from '../../config/publish';
import type { PlatformMeta, PublishContext } from './types';
import type { CategoryConfig, GlobalConfig } from '../types';

/** Minimal publish config (YouTube enabled) for the tests. */
function makePublishConfig(overrides: Partial<PublishConfig> = {}): PublishConfig {
  return {
    enabled: true,
    defaultPrivacy: 'private',
    captions: { mode: 'auto' },
    platforms: {
      youtube: { enabled: true, categoryId: '28' },
      tiktok: { enabled: true, mode: 'inbox' },
      instagram: { enabled: true },
    },
    hosting: { provider: 'r2', bucket: '', publicBaseUrl: '' },
    i18n: {},
    ...overrides,
  } as PublishConfig;
}

/** Default platform metadata. */
function makeMeta(overrides: Partial<PlatformMeta> = {}): PlatformMeta {
  return {
    title: "Today's tech news: AI, cloud and security",
    description: 'The daily tech news roundup.',
    hashtags: ['#tech', '#technews', '#ai', '#cloud', '#dev', '#news', '#fr', '#daily'],
    ...overrides,
  };
}

const FAKE_CATEGORY = { id: 'ai' } as CategoryConfig;

describe('buildYouTubeRequestBody', () => {
  it('truncates the title to 100 characters', () => {
    const longTitle = 'A'.repeat(200);
    const body = buildYouTubeRequestBody(
      makeMeta({ title: longTitle }),
      'public',
      '28',
      'fr',
    );
    expect(body.snippet.title.length).toBeLessThanOrEqual(100);
  });

  it('guarantees the presence of #Shorts (in the title when possible)', () => {
    const body = buildYouTubeRequestBody(makeMeta(), 'public', '28', 'fr');
    expect(body.snippet.title).toContain('#Shorts');
  });

  it('places #Shorts in the description when the title is too long', () => {
    // Title exactly at 100 → #Shorts no longer fits in the title.
    const longTitle = 'B'.repeat(100);
    const body = buildYouTubeRequestBody(
      makeMeta({ title: longTitle }),
      'public',
      '28',
      'fr',
    );
    const hasShorts =
      body.snippet.title.includes('#Shorts') ||
      body.snippet.description.includes('#Shorts');
    expect(hasShorts).toBe(true);
    // Since it does not fit in the title, it must be in the description.
    expect(body.snippet.description).toContain('#Shorts');
  });

  it('limits the description to 5000 characters', () => {
    const body = buildYouTubeRequestBody(
      makeMeta({ description: 'X'.repeat(8000) }),
      'public',
      '28',
      'fr',
    );
    expect(body.snippet.description.length).toBeLessThanOrEqual(5000);
  });

  it('includes the hashtags in the description', () => {
    const body = buildYouTubeRequestBody(makeMeta(), 'public', '28', 'fr');
    expect(body.snippet.description).toContain('#tech');
    expect(body.snippet.description).toContain('#technews');
  });

  it('derives tags without # and caps the sum of lengths at 500', () => {
    // 30 hashtags of 40 characters → 1200 characters total, must be truncated.
    const hashtags = Array.from({ length: 30 }, (_, i) => `#${'t'.repeat(38)}${i}`);
    const body = buildYouTubeRequestBody(
      makeMeta({ hashtags }),
      'public',
      '28',
      'fr',
    );
    const sum = body.snippet.tags.reduce((acc, t) => acc + t.length, 0);
    expect(sum).toBeLessThanOrEqual(500);
    // No tag must start with #.
    for (const t of body.snippet.tags) {
      expect(t.startsWith('#')).toBe(false);
    }
  });

  it('reflects the requested privacy', () => {
    for (const privacy of ['private', 'unlisted', 'public'] as const) {
      const body = buildYouTubeRequestBody(makeMeta(), privacy, '28', 'fr');
      expect(body.snippet === undefined).toBe(false);
      expect(body.status.privacyStatus).toBe(privacy);
    }
  });

  it('sets selfDeclaredMadeForKids to false', () => {
    const body = buildYouTubeRequestBody(makeMeta(), 'public', '28', 'fr');
    expect(body.status.selfDeclaredMadeForKids).toBe(false);
  });

  it('fills in categoryId and defaultLanguage', () => {
    const body = buildYouTubeRequestBody(makeMeta(), 'public', '17', 'en');
    expect(body.snippet.categoryId).toBe('17');
    expect(body.snippet.defaultLanguage).toBe('en');
  });
});

describe('youtubeAdapter.isConfigured', () => {
  const YT_VARS = [
    'YT_CLIENT_ID',
    'YT_CLIENT_SECRET',
    'YT_REFRESH_TOKEN',
    'YT_CLIENT_ID_FR',
    'YT_CLIENT_SECRET_FR',
    'YT_REFRESH_TOKEN_FR',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of YT_VARS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of YT_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('exposes id = "youtube"', () => {
    expect(youtubeAdapter.id).toBe('youtube');
  });

  it('returns false when the env variables are missing', () => {
    expect(youtubeAdapter.isConfigured('fr', makePublishConfig())).toBe(false);
  });

  it('returns true when the three credentials are present', () => {
    process.env.YT_CLIENT_ID = 'id';
    process.env.YT_CLIENT_SECRET = 'secret';
    process.env.YT_REFRESH_TOKEN = 'token';
    expect(youtubeAdapter.isConfigured('fr', makePublishConfig())).toBe(true);
  });

  it('returns false when a single credential is missing', () => {
    process.env.YT_CLIENT_ID = 'id';
    process.env.YT_CLIENT_SECRET = 'secret';
    // YT_REFRESH_TOKEN missing.
    expect(youtubeAdapter.isConfigured('fr', makePublishConfig())).toBe(false);
  });

  it('returns false when the platform is disabled even with creds', () => {
    process.env.YT_CLIENT_ID = 'id';
    process.env.YT_CLIENT_SECRET = 'secret';
    process.env.YT_REFRESH_TOKEN = 'token';
    const cfg = makePublishConfig({
      platforms: {
        youtube: { enabled: false, categoryId: '28' },
        tiktok: { enabled: true, mode: 'inbox' },
        instagram: { enabled: true },
      },
    });
    expect(youtubeAdapter.isConfigured('fr', cfg)).toBe(false);
  });
});

describe('youtubeAdapter.publish (dry-run)', () => {
  it('does NO network and returns the dry-run status', async () => {
    const ctx: PublishContext = {
      platform: 'youtube',
      videoPath: '/inexistant/video.mp4',
      meta: makeMeta(),
      language: 'fr',
      privacy: 'private',
      dryRun: true,
      cfg: {} as GlobalConfig,
      publish: makePublishConfig(),
      date: '2026-06-06',
      category: FAKE_CATEGORY,
    };
    const res = await youtubeAdapter.publish(ctx);
    expect(res.status).toBe('dry-run');
    expect(res.platform).toBe('youtube');
    expect(res.category).toBe('ai');
    expect(res.videoId).toBeUndefined();
  });
});
