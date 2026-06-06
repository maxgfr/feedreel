import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GlobalConfig } from '../types';
import {
  isExpired,
  expiryFromNow,
  readTokenStore,
  writeStoredToken,
  tokenStorePath,
  resolveTikTokToken,
  resolveInstagramToken,
  tiktokHasAuth,
} from './tokens';

/** Builds a minimal cfg with a temporary cacheDir. */
function tmpCfg(): { cfg: GlobalConfig; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-tokens-'));
  return { cfg: { cacheDir: dir } as unknown as GlobalConfig, dir };
}

/** Environment keys manipulated by the tests (restored after each case). */
const ENV_KEYS = [
  'TIKTOK_ACCESS_TOKEN',
  'TIKTOK_CLIENT_KEY',
  'TIKTOK_CLIENT_SECRET',
  'TIKTOK_REFRESH_TOKEN',
  'IG_ACCESS_TOKEN',
  'FB_APP_ID',
  'FB_APP_SECRET',
];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe('isExpired', () => {
  const NOW = Date.parse('2026-06-06T12:00:00.000Z');

  it('undefined → false (no info = valid)', () => {
    expect(isExpired(undefined, 300_000, NOW)).toBe(false);
  });

  it('distant expiry → false', () => {
    const exp = new Date(NOW + 3600_000).toISOString();
    expect(isExpired(exp, 300_000, NOW)).toBe(false);
  });

  it('imminent expiry (within the margin) → true', () => {
    const exp = new Date(NOW + 60_000).toISOString();
    expect(isExpired(exp, 300_000, NOW)).toBe(true);
  });

  it('already expired → true', () => {
    const exp = new Date(NOW - 1).toISOString();
    expect(isExpired(exp, 300_000, NOW)).toBe(true);
  });

  it('invalid value → false', () => {
    expect(isExpired('not-a-date', 300_000, NOW)).toBe(false);
  });
});

describe('expiryFromNow', () => {
  it('converts seconds into ISO from nowMs', () => {
    const now = Date.parse('2026-06-06T12:00:00.000Z');
    expect(expiryFromNow(3600, now)).toBe('2026-06-06T13:00:00.000Z');
  });
});

describe('token store', () => {
  it('writes then reads back (atomic roundtrip)', () => {
    const { cfg } = tmpCfg();
    expect(readTokenStore(cfg)).toEqual({});
    writeStoredToken(cfg, 'tiktok:fr', { accessToken: 'A', refreshToken: 'R', expiresAt: 'X' });
    expect(fs.existsSync(tokenStorePath(cfg))).toBe(true);
    expect(readTokenStore(cfg)['tiktok:fr']).toEqual({
      accessToken: 'A',
      refreshToken: 'R',
      expiresAt: 'X',
    });
  });

  it('merges without overwriting the other keys', () => {
    const { cfg } = tmpCfg();
    writeStoredToken(cfg, 'tiktok:fr', { accessToken: 'A' });
    writeStoredToken(cfg, 'instagram:fr', { accessToken: 'B' });
    const store = readTokenStore(cfg);
    expect(store['tiktok:fr']?.accessToken).toBe('A');
    expect(store['instagram:fr']?.accessToken).toBe('B');
  });
});

describe('tiktokHasAuth', () => {
  it('true with a static token', () => {
    process.env.TIKTOK_ACCESS_TOKEN = 'tok';
    expect(tiktokHasAuth('fr')).toBe(true);
  });
  it('true with the refresh credentials', () => {
    process.env.TIKTOK_CLIENT_KEY = 'k';
    process.env.TIKTOK_CLIENT_SECRET = 's';
    process.env.TIKTOK_REFRESH_TOKEN = 'r';
    expect(tiktokHasAuth('fr')).toBe(true);
  });
  it('false with nothing', () => {
    expect(tiktokHasAuth('fr')).toBe(false);
  });
});

describe('resolveTikTokToken', () => {
  it('reuses the store token while it is still valid (no network)', async () => {
    const { cfg } = tmpCfg();
    writeStoredToken(cfg, 'tiktok:fr', {
      accessToken: 'fresh',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await resolveTikTokToken(cfg, 'fr')).toBe('fresh');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes via refresh token and persists the new token', async () => {
    const { cfg } = tmpCfg();
    process.env.TIKTOK_CLIENT_KEY = 'k';
    process.env.TIKTOK_CLIENT_SECRET = 's';
    process.env.TIKTOK_REFRESH_TOKEN = 'r0';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new', refresh_token: 'r1', expires_in: 86400 }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await resolveTikTokToken(cfg, 'fr')).toBe('new');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stored = readTokenStore(cfg)['tiktok:fr'];
    expect(stored?.accessToken).toBe('new');
    expect(stored?.refreshToken).toBe('r1');
    expect(stored?.expiresAt).toBeTruthy();
  });

  it('falls back to the static token without refresh credentials', async () => {
    const { cfg } = tmpCfg();
    process.env.TIKTOK_ACCESS_TOKEN = 'static';
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await resolveTikTokToken(cfg, 'fr')).toBe('static');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resolveInstagramToken', () => {
  it('returns the static token without app creds (no network)', async () => {
    const { cfg } = tmpCfg();
    process.env.IG_ACCESS_TOKEN = 'igtok';
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await resolveInstagramToken(cfg, 'fr')).toBe('igtok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes the long-lived token with FB_APP_ID/SECRET and persists', async () => {
    const { cfg } = tmpCfg();
    process.env.IG_ACCESS_TOKEN = 'old';
    process.env.FB_APP_ID = 'app';
    process.env.FB_APP_SECRET = 'secret';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'refreshed', expires_in: 5184000 }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await resolveInstagramToken(cfg, 'fr')).toBe('refreshed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readTokenStore(cfg)['instagram:fr']?.accessToken).toBe('refreshed');
  });

  it('undefined when no token is available', async () => {
    const { cfg } = tmpCfg();
    expect(await resolveInstagramToken(cfg, 'fr')).toBeUndefined();
  });
});
