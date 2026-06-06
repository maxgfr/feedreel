/**
 * Shared contracts for the social publishing module (src/publish/).
 *
 * This file is the SOURCE OF TRUTH for the publish types; all adapters and the
 * orchestrator import from here. Aligned with the spirit of src/types.ts (core).
 */
import type { CategoryConfig, GlobalConfig } from '../types';
import type { PublishConfig } from '../../config/publish';

/** Target platform. */
export type PlatformId = 'youtube' | 'tiktok' | 'instagram';

/** Visibility of a publication. */
export type Privacy = 'private' | 'unlisted' | 'public';

/** Outcome of processing a (category × platform). */
export type PublishStatus = 'ok' | 'skipped' | 'error' | 'dry-run';

/** Editorial metadata resolved for ONE platform. */
export interface PlatformMeta {
  /** Title (per-platform limits respected). */
  title: string;
  /** Description / caption (per-platform limits respected). */
  description: string;
  /** Normalized hashtags (with `#`, no spaces), 8–15 depending on platform. */
  hashtags: string[];
}

/**
 * Metadata for a video, per platform, in the category's language.
 * Serialized to cache/metadata/<date>/<cat>.json.
 */
export interface VideoMeta {
  /** The category's language code (e.g. "fr", "en"). */
  language: string;
  youtube?: PlatformMeta;
  tiktok?: PlatformMeta;
  instagram?: PlatformMeta;
}

/** Context passed to an adapter to publish a video on a platform. */
export interface PublishContext {
  platform: PlatformId;
  /** Path to the final MP4 (output/<date>/<cat>.mp4). */
  videoPath: string;
  /** Captions resolved for THIS platform. */
  meta: PlatformMeta;
  /** The category's language (for credential resolution and overrides). */
  language: string;
  /** Requested visibility. */
  privacy: Privacy;
  /** If true: makes NO network call, returns `dry-run`. */
  dryRun: boolean;
  cfg: GlobalConfig;
  publish: PublishConfig;
  date: string;
  category: CategoryConfig;
}

/** Publish result for a (category × platform). */
export interface PublishResult {
  platform: PlatformId;
  category: string;
  status: PublishStatus;
  /** Media identifier returned by the platform (if published). */
  videoId?: string;
  /** Public/management URL (if available). */
  url?: string;
  /** Error message (if status `error`). */
  error?: string;
}

/** Common interface for platform adapters. */
export interface PlatformAdapter {
  id: PlatformId;
  /**
   * True if the required credentials are present for this language
   * (`credForLang` resolution). Otherwise the platform is SKIPPED (not an error).
   */
  isConfigured(language: string, publish: PublishConfig): boolean;
  /** Publishes the video. Must respect `ctx.dryRun` (no network if true). */
  publish(ctx: PublishContext): Promise<PublishResult>;
}
