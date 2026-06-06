import { z } from 'zod';
import type { AppConfig } from '../src/types';

/**
 * Zod schemas validating the editable configuration (config/feedreel.yaml).
 * Any structural error is reported clearly at load time.
 */

const TtsSchema = z.object({
  engine: z.string().min(1),
  voice: z.string().min(1),
});

// `code` is not listed: it is derived from the KEY of the `languages` map (e.g. fr, en).
const LanguageSchema = z.object({
  name: z.string().min(1),
  uiLabel: z.string().min(1),
  dateLocale: z.string().min(1),
  tts: TtsSchema,
});

const CategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  emoji: z.string().min(1),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'hex color expected (e.g. #ff5577)'),
  maxItems: z.number().int().positive(),
  feeds: z.array(z.string().url()).default([]),
  aggregate: z.boolean().optional(),
  language: z.string().optional(),
});

const AudioSchema = z
  .object({
    mode: z.enum(['music', 'voice']).default('music'),
    music: z
      .object({
        track: z.string().optional(),
        dir: z.string().default('assets/music'),
        fadeSec: z.number().nonnegative().default(1.5),
        volume: z.number().positive().max(4).default(1),
      })
      .default({ dir: 'assets/music', fadeSec: 1.5, volume: 1 }),
    scene: z
      .object({
        introSec: z.number().positive().default(3),
        itemSec: z.number().positive().default(4),
      })
      .default({ introSec: 3, itemSec: 4 }),
  })
  .default({
    mode: 'music',
    music: { dir: 'assets/music', fadeSec: 1.5 },
    scene: { introSec: 3, itemSec: 4 },
  });

export const AppConfigSchema = z.object({
  format: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
  }),
  defaultLanguage: z.string().min(1),
  languages: z.record(z.string(), LanguageSchema),
  categories: z.array(CategorySchema).min(1),
  audio: AudioSchema,
});

/**
 * Validates a raw object (from the YAML) and returns it typed. Also checks consistency:
 * `defaultLanguage` and each category's `language` must exist in `languages`.
 */
export function validateAppConfig(raw: unknown): AppConfig {
  const parsed = AppConfigSchema.parse(raw);
  // Injects `code` into each language from the map key.
  const languages = Object.fromEntries(
    Object.entries(parsed.languages).map(([code, lang]) => [code, { code, ...lang }]),
  );
  const cfg: AppConfig = { ...parsed, languages };
  if (!cfg.languages[cfg.defaultLanguage]) {
    throw new Error(
      `Config: defaultLanguage "${cfg.defaultLanguage}" missing from languages (${Object.keys(cfg.languages).join(', ')}).`,
    );
  }
  for (const cat of cfg.categories) {
    if (cat.language && !cfg.languages[cat.language]) {
      throw new Error(
        `Config: category "${cat.id}" references an unknown language "${cat.language}".`,
      );
    }
  }
  return cfg;
}
