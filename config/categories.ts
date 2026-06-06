import type { CategoryConfig } from '../src/types';
import { loadAppConfig } from './load';

/**
 * Video categories + RSS feeds, loaded from the editable config (config/feedreel.yaml).
 * Edit this YAML file to add/remove feeds or categories without touching the code.
 */
export const CATEGORIES: CategoryConfig[] = loadAppConfig().categories;

/** Retrieves a category by id (throws if missing). */
export function getCategory(id: string): CategoryConfig {
  const found = CATEGORIES.find((c) => c.id === id);
  if (!found) {
    const known = CATEGORIES.map((c) => c.id).join(', ');
    throw new Error(`Unknown category: "${id}". Known: ${known}`);
  }
  return found;
}
