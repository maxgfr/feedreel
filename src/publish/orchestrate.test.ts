import { describe, it, expect } from 'vitest';
import type { PublishConfig } from '../../config/publish';
import type { Privacy } from './types';
import { parsePlatforms, enabledPlatforms, resolvePrivacy } from './orchestrate';

/**
 * Builds a test PublishConfig, overridable field by field.
 * No network, no file: we instantiate the validated structure directly.
 */
function makePublishConfig(over: Partial<PublishConfig> = {}): PublishConfig {
  const base: PublishConfig = {
    enabled: false,
    defaultPrivacy: 'private',
    captions: { mode: 'auto' },
    platforms: {
      youtube: { enabled: true, categoryId: '28' },
      tiktok: { enabled: true, mode: 'inbox' },
      instagram: { enabled: true },
    },
    hosting: { provider: 'r2', bucket: '', publicBaseUrl: '' },
    i18n: {},
  };
  return { ...base, ...over } as PublishConfig;
}

describe('parsePlatforms', () => {
  it('resolves short aliases to canonical identifiers', () => {
    expect(parsePlatforms('yt')).toEqual(['youtube']);
    expect(parsePlatforms('tt')).toEqual(['tiktok']);
    expect(parsePlatforms('ig')).toEqual(['instagram']);
  });

  it('resolves full names', () => {
    expect(parsePlatforms('youtube,instagram')).toEqual(['youtube', 'instagram']);
  });

  it('splits on commas, ignores whitespace and case', () => {
    expect(parsePlatforms(' YT , Tt ')).toEqual(['youtube', 'tiktok']);
  });

  it('undefined or empty string → all platforms', () => {
    expect(parsePlatforms(undefined)).toEqual(['youtube', 'tiktok', 'instagram']);
    expect(parsePlatforms('')).toEqual(['youtube', 'tiktok', 'instagram']);
    expect(parsePlatforms('   ')).toEqual(['youtube', 'tiktok', 'instagram']);
  });

  it('ignores unknown tokens', () => {
    expect(parsePlatforms('yt,facebook,ig')).toEqual(['youtube', 'instagram']);
    expect(parsePlatforms('unknown')).toEqual([]);
  });

  it('deduplicates and preserves canonical order', () => {
    expect(parsePlatforms('tt,yt,tiktok,youtube')).toEqual(['youtube', 'tiktok']);
    expect(parsePlatforms('ig,ig,instagram')).toEqual(['instagram']);
  });
});

describe('enabledPlatforms', () => {
  it('filters by each platform enabled flag', () => {
    const cfg = makePublishConfig({
      platforms: {
        youtube: { enabled: true, categoryId: '28' },
        tiktok: { enabled: false, mode: 'inbox' },
        instagram: { enabled: true },
      },
    });
    expect(enabledPlatforms(cfg)).toEqual(['youtube', 'instagram']);
  });

  it('intersects the requested platforms with the enabled ones', () => {
    const cfg = makePublishConfig({
      platforms: {
        youtube: { enabled: true, categoryId: '28' },
        tiktok: { enabled: true, mode: 'inbox' },
        instagram: { enabled: false },
      },
    });
    expect(enabledPlatforms(cfg, ['youtube', 'instagram'])).toEqual(['youtube']);
    expect(enabledPlatforms(cfg, ['tiktok'])).toEqual(['tiktok']);
  });

  it('without an explicit request, considers all platforms', () => {
    const cfg = makePublishConfig({
      platforms: {
        youtube: { enabled: false, categoryId: '28' },
        tiktok: { enabled: false, mode: 'inbox' },
        instagram: { enabled: false },
      },
    });
    expect(enabledPlatforms(cfg)).toEqual([]);
  });
});

describe('resolvePrivacy', () => {
  it('prioritizes the explicit override', () => {
    const cfg = makePublishConfig({
      defaultPrivacy: 'private',
      i18n: { fr: { privacy: 'unlisted' } },
    });
    const override: Privacy = 'public';
    expect(resolvePrivacy(cfg, 'fr', override)).toBe('public');
  });

  it('otherwise, the language i18n override', () => {
    const cfg = makePublishConfig({
      defaultPrivacy: 'private',
      i18n: { fr: { privacy: 'unlisted' } },
    });
    expect(resolvePrivacy(cfg, 'fr')).toBe('unlisted');
  });

  it('otherwise, the configuration default privacy', () => {
    const cfg = makePublishConfig({
      defaultPrivacy: 'public',
      i18n: { fr: { baseHashtags: ['#x'] } },
    });
    expect(resolvePrivacy(cfg, 'fr')).toBe('public');
    // Language without an i18n override → default as well.
    expect(resolvePrivacy(cfg, 'en')).toBe('public');
  });
});
