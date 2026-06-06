/**
 * Social network publishing configuration (config/publish.yaml).
 *
 * OPTIONAL file: if it is absent, default values apply
 * (`enabled: false` → the daily job does not publish, but the explicit
 * `feedreel publish` command remains usable). Validated by zod, like the main config.
 *
 * No sensitive values here: secrets (OAuth tokens) live in `.env`
 * (see src/publish/env.ts). This file only drives non-secret choices
 * (active platforms, default privacy, hosting, i18n overrides).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** Project root (this file lives in <root>/config/). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Visibility of a publication (aligned with `Privacy` from src/publish/types.ts). */
const PrivacySchema = z.enum(['private', 'unlisted', 'public']);

/**
 * Per-language overrides (all optional): fine-tuning of publishing
 * for a given language without touching the code. By default, Claude generates everything
 * from the category's language; these fields are only used for calibration.
 */
const I18nOverrideSchema = z
  .object({
    baseHashtags: z.array(z.string()).optional(),
    privacy: PrivacySchema.optional(),
    youtube: z.object({ categoryId: z.string().optional() }).optional(),
  })
  .strict();

/** Full schema of config/publish.yaml — everything is defaulted (optional file). */
export const PublishConfigSchema = z
  .object({
    /** Master switch for the AUTOMATIC publish step (daily job). */
    enabled: z.boolean().default(false),
    /** Default privacy of publications. */
    defaultPrivacy: PrivacySchema.default('private'),
    /** Caption generation: `auto` (claude -p) or `file` (handoff skill). */
    captions: z
      .object({ mode: z.enum(['auto', 'file']).default('auto') })
      .default({ mode: 'auto' }),
    /** Per-platform activation and options. */
    platforms: z
      .object({
        youtube: z
          .object({
            enabled: z.boolean().default(true),
            /** YouTube categoryId (28 = Science & Technology). */
            categoryId: z.string().default('28'),
          })
          .default({ enabled: true, categoryId: '28' }),
        tiktok: z
          .object({
            enabled: z.boolean().default(true),
            /** `inbox` (draft, no audit) or `direct` (public post, audit required). */
            mode: z.enum(['inbox', 'direct']).default('inbox'),
          })
          .default({ enabled: true, mode: 'inbox' }),
        instagram: z
          .object({ enabled: z.boolean().default(true) })
          .default({ enabled: true }),
      })
      .default({
        youtube: { enabled: true, categoryId: '28' },
        tiktok: { enabled: true, mode: 'inbox' },
        instagram: { enabled: true },
      }),
    /** Temporary public HTTPS hosting (required by Instagram). */
    hosting: z
      .object({
        provider: z.enum(['r2', 's3']).default('r2'),
        /** Bucket name (may also come from the env R2_BUCKET / S3_BUCKET). */
        bucket: z.string().default(''),
        /** Public base URL of the bucket (may come from the env *_PUBLIC_BASE_URL). */
        publicBaseUrl: z.string().default(''),
      })
      .default({ provider: 'r2', bucket: '', publicBaseUrl: '' }),
    /** Optional overrides per language code (e.g. fr, en). */
    i18n: z.record(z.string(), I18nOverrideSchema).default({}),
  })
  .default({});

/** Resolved publishing configuration. */
export type PublishConfig = z.infer<typeof PublishConfigSchema>;

/** Path of the publish config file (overridable via FEEDREEL_PUBLISH_CONFIG). */
export function publishConfigPath(): string {
  const p =
    process.env.FEEDREEL_PUBLISH_CONFIG ?? path.join(ROOT, 'config', 'publish.yaml');
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

let cached: PublishConfig | null = null;

/**
 * Loads and validates config/publish.yaml (with caching). Absent file → defaults
 * (automatic publishing disabled). Throws a clear error if the present YAML
 * is invalid.
 */
export function loadPublishConfig(): PublishConfig {
  if (cached) return cached;
  const file = publishConfigPath();
  let raw: string | null;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    raw = null; // optional file
  }
  const parsed = raw === null ? {} : (parseYaml(raw) ?? {});
  cached = PublishConfigSchema.parse(parsed);
  return cached;
}

/** Resets the cache (useful for tests). */
export function resetPublishConfigCache(): void {
  cached = null;
}
