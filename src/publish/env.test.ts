/**
 * Tests for per-language credential resolution — NO network.
 *
 * Covers:
 *  - credForLang: priority of the `NAME_<LANG>` variant (UPPERCASE) over `NAME`,
 *    fallback to `NAME` when the per-language variant is absent,
 *    an empty value (or one made only of spaces) treated as absent => undefined.
 *  - hasCreds: true only if ALL variables (with language fallback) are present.
 *
 * We manipulate `process.env` directly in `beforeEach`, then RESTORE the
 * original state in `afterEach` (save/restore of the touched keys), so as not
 * to pollute the other tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { credForLang, hasCreds } from './env';

/** Environment keys manipulated by these tests (to save/restore). */
const TOUCHED_KEYS = [
  'YT_REFRESH_TOKEN',
  'YT_REFRESH_TOKEN_EN',
  'YT_REFRESH_TOKEN_FR',
  'YT_CLIENT_ID',
  'YT_CLIENT_ID_EN',
  'YT_CLIENT_SECRET',
] as const;

/** Snapshot of the original values (undefined = key absent before the test). */
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  // Save the initial state, then clear each key to start from a clean base.
  saved = {};
  for (const key of TOUCHED_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  // Restore the initial state exactly: put back the saved values,
  // and delete the keys that did not exist before the test.
  for (const key of TOUCHED_KEYS) {
    const original = saved[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('credForLang', () => {
  it('(1) gives priority to the NAME_<LANG> variant (UPPERCASE) over NAME', () => {
    process.env.YT_REFRESH_TOKEN = 'token-base';
    process.env.YT_REFRESH_TOKEN_EN = 'token-en';

    // The language is passed in lowercase: resolution must uppercase it.
    expect(credForLang('YT_REFRESH_TOKEN', 'en')).toBe('token-en');
    // Another language with no dedicated variant falls back to the base.
    expect(credForLang('YT_REFRESH_TOKEN', 'fr')).toBe('token-base');
  });

  it('(2) falls back to NAME when the per-language variant is absent', () => {
    process.env.YT_REFRESH_TOKEN = 'token-base';
    // No NAME_<LANG> variant defined.
    expect(credForLang('YT_REFRESH_TOKEN', 'en')).toBe('token-base');
    expect(credForLang('YT_REFRESH_TOKEN', 'fr')).toBe('token-base');
  });

  it('(3) treats an empty or whitespace-only value as absent => undefined', () => {
    // Empty per-language variant: must be ignored and fall back to the absent base.
    process.env.YT_REFRESH_TOKEN_EN = '';
    expect(credForLang('YT_REFRESH_TOKEN', 'en')).toBeUndefined();

    // Per-language variant made only of spaces: also ignored,
    // and the base is empty too => undefined.
    process.env.YT_REFRESH_TOKEN_EN = '   ';
    process.env.YT_REFRESH_TOKEN = '';
    expect(credForLang('YT_REFRESH_TOKEN', 'en')).toBeUndefined();

    // Empty per-language variant but a populated base => fall back to the base.
    process.env.YT_REFRESH_TOKEN_EN = '';
    process.env.YT_REFRESH_TOKEN = 'token-base';
    expect(credForLang('YT_REFRESH_TOKEN', 'en')).toBe('token-base');
  });

  it('returns undefined when neither the variant nor the base is defined', () => {
    expect(credForLang('YT_REFRESH_TOKEN', 'en')).toBeUndefined();
  });
});

describe('hasCreds', () => {
  it('(4) is true only if ALL variables are present', () => {
    process.env.YT_CLIENT_ID = 'id-base';
    process.env.YT_CLIENT_SECRET = 'secret-base';
    expect(hasCreds(['YT_CLIENT_ID', 'YT_CLIENT_SECRET'], 'fr')).toBe(true);
  });

  it('is false if at least one variable is missing', () => {
    process.env.YT_CLIENT_ID = 'id-base';
    // YT_CLIENT_SECRET absent.
    expect(hasCreds(['YT_CLIENT_ID', 'YT_CLIENT_SECRET'], 'fr')).toBe(false);
  });

  it('is false if a variable is empty (treated as absent)', () => {
    process.env.YT_CLIENT_ID = 'id-base';
    process.env.YT_CLIENT_SECRET = '';
    expect(hasCreds(['YT_CLIENT_ID', 'YT_CLIENT_SECRET'], 'fr')).toBe(false);
  });

  it('takes the per-language fallback into account when deciding presence', () => {
    // YT_CLIENT_ID available only via the EN variant;
    // YT_CLIENT_SECRET available via the base.
    process.env.YT_CLIENT_ID_EN = 'id-en';
    process.env.YT_CLIENT_SECRET = 'secret-base';
    expect(hasCreds(['YT_CLIENT_ID', 'YT_CLIENT_SECRET'], 'en')).toBe(true);
    // In FR, the EN variant is not seen and the YT_CLIENT_ID base is missing.
    expect(hasCreds(['YT_CLIENT_ID', 'YT_CLIENT_SECRET'], 'fr')).toBe(false);
  });

  it('is true for an empty list (no constraint)', () => {
    expect(hasCreds([], 'fr')).toBe(true);
  });
});
