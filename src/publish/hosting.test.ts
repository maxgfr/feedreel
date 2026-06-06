/**
 * Tests for src/publish/hosting.ts — NO network.
 *
 * We validate:
 *   - objectKeyFor: pure and deterministic;
 *   - isHostingConfigured: true/false based on process.env (R2 and S3), with
 *     bucket / publicBaseUrl falling back to the config OR the environment.
 *
 * `uploadPublic` is NOT executed here (it would trigger a real network call via the
 * AWS SDK): we limit ourselves to configuration detection and the object key.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isHostingConfigured, objectKeyFor } from './hosting';
import type { PublishConfig } from '../../config/publish';

/** Environment variables manipulated by these tests (restored after each one). */
const ENV_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_BASE_URL',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_PUBLIC_BASE_URL',
] as const;

/** Builds a minimal PublishConfig for a given provider (targeted hosting fields). */
function makeConfig(
  provider: 'r2' | 's3',
  hosting: { bucket?: string; publicBaseUrl?: string } = {},
): PublishConfig {
  return {
    enabled: false,
    defaultPrivacy: 'private',
    captions: { mode: 'auto' },
    platforms: {
      youtube: { enabled: true, categoryId: '28' },
      tiktok: { enabled: true, mode: 'inbox' },
      instagram: { enabled: true },
    },
    hosting: {
      provider,
      bucket: hosting.bucket ?? '',
      publicBaseUrl: hosting.publicBaseUrl ?? '',
    },
    i18n: {},
  };
}

describe('objectKeyFor', () => {
  it('is deterministic and follows the pattern feedreel/<date>/<cat>/<file>', () => {
    expect(objectKeyFor('2026-06-06', 'ai', 'ai.mp4')).toBe('feedreel/2026-06-06/ai/ai.mp4');
  });

  it('always produces the same key for the same inputs (purity)', () => {
    const a = objectKeyFor('2026-01-01', 'dev', 'dev.mp4');
    const b = objectKeyFor('2026-01-01', 'dev', 'dev.mp4');
    expect(a).toBe(b);
  });

  it('distinguishes different categories and dates', () => {
    expect(objectKeyFor('2026-06-06', 'ai', 'x.mp4')).not.toBe(
      objectKeyFor('2026-06-06', 'dev', 'x.mp4'),
    );
    expect(objectKeyFor('2026-06-06', 'ai', 'x.mp4')).not.toBe(
      objectKeyFor('2026-06-07', 'ai', 'x.mp4'),
    );
  });
});

describe('isHostingConfigured', () => {
  /** Backup of the original values, restored in afterEach. */
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('R2: false when no secret/bucket/url', () => {
    expect(isHostingConfigured(makeConfig('r2'))).toBe(false);
  });

  it('R2: false when secrets are present but bucket/url are missing', () => {
    process.env.R2_ACCOUNT_ID = 'acc';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    expect(isHostingConfigured(makeConfig('r2'))).toBe(false);
  });

  it('R2: true with secrets + bucket/url via the config', () => {
    process.env.R2_ACCOUNT_ID = 'acc';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    const cfg = makeConfig('r2', {
      bucket: 'feedreel-bucket',
      publicBaseUrl: 'https://cdn.example.com',
    });
    expect(isHostingConfigured(cfg)).toBe(true);
  });

  it('R2: true with bucket/url falling back to the environment', () => {
    process.env.R2_ACCOUNT_ID = 'acc';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'feedreel-bucket';
    process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.com';
    expect(isHostingConfigured(makeConfig('r2'))).toBe(true);
  });

  it('R2: an empty value is treated as absent', () => {
    process.env.R2_ACCOUNT_ID = '';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'feedreel-bucket';
    process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.com';
    expect(isHostingConfigured(makeConfig('r2'))).toBe(false);
  });

  it('R2: S3 secrets are not enough for the r2 provider', () => {
    process.env.S3_REGION = 'eu-west-3';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.S3_BUCKET = 'feedreel-bucket';
    process.env.S3_PUBLIC_BASE_URL = 'https://cdn.example.com';
    expect(isHostingConfigured(makeConfig('r2'))).toBe(false);
  });

  it('S3: false when no secret/bucket/url', () => {
    expect(isHostingConfigured(makeConfig('s3'))).toBe(false);
  });

  it('S3: false when secrets are present but bucket/url are missing', () => {
    process.env.S3_REGION = 'eu-west-3';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    expect(isHostingConfigured(makeConfig('s3'))).toBe(false);
  });

  it('S3: true with secrets + bucket/url via the config', () => {
    process.env.S3_REGION = 'eu-west-3';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    const cfg = makeConfig('s3', {
      bucket: 'feedreel-bucket',
      publicBaseUrl: 'https://cdn.example.com',
    });
    expect(isHostingConfigured(cfg)).toBe(true);
  });

  it('S3: true with bucket/url falling back to the environment', () => {
    process.env.S3_REGION = 'eu-west-3';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.S3_BUCKET = 'feedreel-bucket';
    process.env.S3_PUBLIC_BASE_URL = 'https://cdn.example.com';
    expect(isHostingConfigured(makeConfig('s3'))).toBe(true);
  });
});
