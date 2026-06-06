import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { AppConfig, CategoryConfig, LanguageConfig } from '../src/types';
import { validateAppConfig } from './schema';

/** Project root (this file lives in <root>/config/). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let cached: AppConfig | null = null;

/** Path to the config file (overridable via FEEDREEL_CONFIG). */
export function configPath(): string {
  const p = process.env.FEEDREEL_CONFIG ?? path.join(ROOT, 'config', 'feedreel.yaml');
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

/**
 * Loads and validates the editable configuration (YAML), with caching.
 * Throws a clear error if the file is missing or invalid.
 */
export function loadAppConfig(): AppConfig {
  if (cached) return cached;
  const file = configPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `Configuration not found: ${file}. Create config/feedreel.yaml or set FEEDREEL_CONFIG.`,
    );
  }
  cached = validateAppConfig(parseYaml(raw));
  return cached;
}

/** Resets the cache (useful for tests). */
export function resetAppConfigCache(): void {
  cached = null;
}

/**
 * Resolves a category's language configuration: its `language` if defined,
 * otherwise the default language. Always defined (validated at load time).
 */
export function languageOf(
  app: AppConfig,
  category: Pick<CategoryConfig, 'language'>,
): LanguageConfig {
  const code = category.language ?? app.defaultLanguage;
  const lang = app.languages[code] ?? app.languages[app.defaultLanguage];
  if (!lang) {
    throw new Error(`Language "${code}" not found in the configuration.`);
  }
  return lang;
}
