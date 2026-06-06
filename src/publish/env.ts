/**
 * Loads publishing secrets from `.env` (gitignored) and resolves credentials
 * WITH a per-language fallback (multilingual scalability).
 *
 * `dotenv` is imported LAZILY: the local-first core never loads it.
 * Secrets NEVER flow through the logs.
 */
import { createLogger } from '../log';

const log = createLogger('publish:env');

let loaded = false;

/**
 * Loads `.env` exactly once (idempotent). Call before reading any credential.
 * If `dotenv` is missing, we silently fall back to the variables already
 * present in the process environment.
 */
export async function loadEnv(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const dotenv = await import('dotenv');
    // `quiet: true` suppresses dotenv v17's info banner (clean CLI output).
    dotenv.config({ quiet: true });
  } catch (e) {
    log.warn(
      `dotenv unavailable (${String(e)}) — using the process environment variables only.`,
    );
  }
}

/**
 * Resolves an environment variable, giving PRIORITY to the per-language variant:
 *   1. `${name}_${LANG}`  (LANG in UPPERCASE, e.g. YT_REFRESH_TOKEN_EN)
 *   2. fallback to `${name}` (e.g. YT_REFRESH_TOKEN)
 *
 * Lets you publish FR and EN to different accounts/channels — or the same one —
 * without changing the code. An empty value is treated as absent.
 */
export function credForLang(name: string, language: string): string | undefined {
  const suffixed = process.env[`${name}_${language.toUpperCase()}`];
  if (suffixed !== undefined && suffixed.trim() !== '') return suffixed;
  const base = process.env[name];
  return base !== undefined && base.trim() !== '' ? base : undefined;
}

/** True if ALL variables (with the language fallback) are present and non-empty. */
export function hasCreds(names: string[], language: string): boolean {
  return names.every((n) => credForLang(n, language) !== undefined);
}

/**
 * Reads a plain variable (no language fallback); an empty value = absent.
 * Handy for shared hosting settings (e.g. R2_ACCOUNT_ID).
 */
export function env(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v : undefined;
}
