import { z } from 'zod';
import type { AppConfig } from '../src/types';

/**
 * Zod schema validating the editable configuration (config/feedreel.yaml).
 * Describes ONE video: format, language, editorial identity, feeds, music, scenes.
 * Any structural error is reported clearly at load time.
 */

const LanguageSchema = z.object({
  name: z.string().min(1),
  uiLabel: z.string().min(1),
  dateLocale: z.string().min(1),
  // Editorial scope read by the skill: "int" = international (worldwide),
  // otherwise a country/region to focus on. Defaults to "int".
  region: z.string().min(1).default('int'),
  // On-screen UI labels — localize these so the video is fully language-generic.
  // Defaults keep English working when the keys are absent from the YAML.
  topLabel: z.string().min(1).default('Top'),
  subscribeLabel: z.string().min(1).default('Subscribe'),
  joinLabel: z.string().min(1).default('Join the debate'),
  sourcesLabel: z.string().min(1).default('Sources'),
});

const VideoSchema = z.object({
  label: z.string().min(1),
  emoji: z.string().min(1),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'hex color expected (e.g. #22c55e)'),
  maxItems: z.number().int().positive(),
  subscribeText: z.string().min(1),
});

const MusicSchema = z
  .object({
    track: z.string().optional(),
    dir: z.string().default('assets/music'),
    fadeSec: z.number().nonnegative().default(1.5),
    volume: z.number().positive().max(4).default(1),
  })
  .default({ dir: 'assets/music', fadeSec: 1.5, volume: 1 });

const SceneSchema = z
  .object({
    introSec: z.number().positive().default(3),
    itemSec: z.number().positive().default(4),
    outroSec: z.number().positive().default(3),
  })
  .default({ introSec: 3, itemSec: 4, outroSec: 3 });

export const AppConfigSchema = z.object({
  format: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
  }),
  language: LanguageSchema,
  video: VideoSchema,
  feeds: z.array(z.string().url()).min(1),
  music: MusicSchema,
  scene: SceneSchema,
});

/** Validates a raw object (from the YAML) and returns it typed. */
export function validateAppConfig(raw: unknown): AppConfig {
  return AppConfigSchema.parse(raw);
}
