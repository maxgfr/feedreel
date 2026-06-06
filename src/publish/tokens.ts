/**
 * AUTOMATIC refresh of access tokens (TikTok, Instagram) for long-running,
 * hands-off automation.
 *
 * Why: YouTube renews itself (permanent OAuth refresh token handled by
 * google-auth-library). The TikTok token, however, expires in ~24 h and the
 * Instagram one in ~60 d: without renewal, the daily job would break.
 *
 * How it works (backward-compatible):
 *  - If refresh credentials are provided (key/secret + refresh token), we
 *    exchange a fresh token and PERSIST it in a local gitignored store
 *    (`<cacheDir>/publish/tokens.json`) along with its expiry date.
 *  - Otherwise, we fall back to the STATIC token from `.env` (renewed manually).
 *
 * The store holds secrets: it lives under `cache/` (gitignored) and is NEVER
 * logged.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { GlobalConfig } from '../types';
import { ensureDir } from '../util';
import { credForLang } from './env';
import { createLogger } from '../log';

const log = createLogger('publish:tokens');

/** Persisted token for a (platform × language) pair. */
export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  /** ISO 8601 expiry (absent = unknown / static token). */
  expiresAt?: string;
}

type Store = Record<string, StoredToken>;

/** Path to the token store (under cache/, gitignored). */
export function tokenStorePath(cfg: GlobalConfig): string {
  return path.join(cfg.cacheDir, 'publish', 'tokens.json');
}

/** Reads the store (empty object if absent or unreadable). */
export function readTokenStore(cfg: GlobalConfig): Store {
  // Best-effort cache: without cacheDir (minimal config), we simply have no
  // persisted token — resolution will fall back to environment variables.
  if (!cfg.cacheDir) return {};
  const p = tokenStorePath(cfg);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Store;
  } catch (e) {
    log.warn(`Unreadable token store (${p}): ${String(e)}.`);
    return {};
  }
}

/** Writes (merges) a token into the store, atomically (tmp + rename). */
export function writeStoredToken(cfg: GlobalConfig, key: string, tok: StoredToken): void {
  // Without cacheDir, we don't persist (the refresh stays usable, just uncached).
  if (!cfg.cacheDir) return;
  const p = tokenStorePath(cfg);
  ensureDir(path.dirname(p));
  const store = readTokenStore(cfg);
  store[key] = tok;
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

/**
 * PURE: true if `expiresAt` is in the past or occurs within less than `skewMs`.
 * `undefined`/invalid → `false` (no info → the token is considered valid).
 * `nowMs` is injectable for tests.
 */
export function isExpired(
  expiresAt: string | undefined,
  skewMs = 300_000,
  nowMs: number = Date.now(),
): boolean {
  if (!expiresAt) return false;
  const exp = Date.parse(expiresAt);
  if (Number.isNaN(exp)) return false;
  return exp - nowMs <= skewMs;
}

/** PURE: converts an `expires_in` duration (seconds) into an ISO expiry. */
export function expiryFromNow(expiresInSec: number, nowMs: number = Date.now()): string {
  return new Date(nowMs + expiresInSec * 1000).toISOString();
}

/**
 * Resolves a VALID TikTok access token for the given language.
 *
 * 1. store token still valid → reused;
 * 2. otherwise, if `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` + a refresh token
 *    (store or `TIKTOK_REFRESH_TOKEN`) are present → exchanges a fresh token
 *    (POST /v2/oauth/token/) and persists it;
 * 3. fallback: static `TIKTOK_ACCESS_TOKEN` token (24 h, manual).
 */
export async function resolveTikTokToken(
  cfg: GlobalConfig,
  language: string,
): Promise<string | undefined> {
  const key = `tiktok:${language}`;
  const stored = readTokenStore(cfg)[key];
  if (stored?.accessToken && !isExpired(stored.expiresAt)) return stored.accessToken;

  const clientKey = credForLang('TIKTOK_CLIENT_KEY', language);
  const clientSecret = credForLang('TIKTOK_CLIENT_SECRET', language);
  const refreshToken = stored?.refreshToken ?? credForLang('TIKTOK_REFRESH_TOKEN', language);

  if (clientKey && clientSecret && refreshToken) {
    try {
      const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
      const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        refresh_token?: string;
        error?: string;
        error_description?: string;
      };
      if (res.ok && json.access_token) {
        const tok: StoredToken = {
          accessToken: json.access_token,
          refreshToken: json.refresh_token ?? refreshToken,
          expiresAt: json.expires_in ? expiryFromNow(json.expires_in) : undefined,
        };
        writeStoredToken(cfg, key, tok);
        log.info(`TikTok token refreshed (${language}).`);
        return tok.accessToken;
      }
      log.warn(
        `TikTok refresh failed (${language}): ${json.error_description ?? json.error ?? `HTTP ${res.status}`}.`,
      );
    } catch (e) {
      log.warn(`TikTok refresh unavailable (${language}): ${String(e)}.`);
    }
  }

  // Fallback: static token (or the store one, even expired, as a last resort).
  return stored?.accessToken ?? credForLang('TIKTOK_ACCESS_TOKEN', language);
}

/**
 * Resolves a VALID Instagram access token for the given language.
 *
 * The long-lived token (~60 d) is re-exchanged (`grant_type=fb_exchange_token`)
 * when it nears expiry (7 d margin) OR when its expiry is unknown (first pass),
 * provided that `FB_APP_ID` + `FB_APP_SECRET` are supplied. Otherwise, the static
 * `IG_ACCESS_TOKEN` token is used as is.
 */
export async function resolveInstagramToken(
  cfg: GlobalConfig,
  language: string,
): Promise<string | undefined> {
  const key = `instagram:${language}`;
  const stored = readTokenStore(cfg)[key];
  const current = stored?.accessToken ?? credForLang('IG_ACCESS_TOKEN', language);
  if (!current) return undefined;

  const appId = credForLang('FB_APP_ID', language);
  const appSecret = credForLang('FB_APP_SECRET', language);
  const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
  const needsRefresh = stored?.expiresAt === undefined || isExpired(stored.expiresAt, SEVEN_DAYS);

  if (appId && appSecret && needsRefresh) {
    try {
      const url =
        'https://graph.facebook.com/v21.0/oauth/access_token' +
        `?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&fb_exchange_token=${encodeURIComponent(current)}`;
      const res = await fetch(url);
      const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        error?: { message?: string };
      };
      if (res.ok && json.access_token) {
        writeStoredToken(cfg, key, {
          accessToken: json.access_token,
          expiresAt: json.expires_in ? expiryFromNow(json.expires_in) : undefined,
        });
        log.info(`Instagram token refreshed (${language}).`);
        return json.access_token;
      }
      log.warn(
        `Instagram refresh failed (${language}): ${json.error?.message ?? `HTTP ${res.status}`}.`,
      );
    } catch (e) {
      log.warn(`Instagram refresh unavailable (${language}): ${String(e)}.`);
    }
  }

  return current;
}

/** True if TikTok has a means of authentication (static OR refresh). */
export function tiktokHasAuth(language: string): boolean {
  if (credForLang('TIKTOK_ACCESS_TOKEN', language) !== undefined) return true;
  return (
    credForLang('TIKTOK_CLIENT_KEY', language) !== undefined &&
    credForLang('TIKTOK_CLIENT_SECRET', language) !== undefined &&
    credForLang('TIKTOK_REFRESH_TOKEN', language) !== undefined
  );
}
