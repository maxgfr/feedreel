import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { AppConfig } from '../src/types';
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
      `Configuration not found: ${file}. Copy config/feedreel.example.yaml to config/feedreel.yaml or set FEEDREEL_CONFIG.`,
    );
  }
  cached = validateAppConfig(parseYaml(raw));
  return cached;
}

/** Resets the cache (useful for tests). */
export function resetAppConfigCache(): void {
  cached = null;
}
