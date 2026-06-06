/**
 * Shared data contracts of the feedreel pipeline.
 * This file is the source of truth; all modules import from here.
 *
 * The pipeline produces ONE video per run from a single editable config
 * (config/feedreel.yaml): no categories, no voice — music only.
 */

/** Language identity of the video (drives the labels and the date format). */
export interface LanguageConfig {
  /** Language name (for documentation only, e.g. "English"). */
  name: string;
  /** Label prefix displayed in the video header (e.g. "FOOTBALL"). */
  uiLabel: string;
  /** Intl locale to format the date (e.g. "en-US"). */
  dateLocale: string;
}

/** Editorial identity of the video. */
export interface VideoConfig {
  /** Label displayed in the header (e.g. "Football"). */
  label: string;
  /** Header emoji. */
  emoji: string;
  /** Accent color (hex, e.g. "#22c55e"). */
  accentColor: string;
  /** Maximum number of items kept for the video. */
  maxItems: number;
  /** Call-to-action shown on the closing "subscribe" scene. */
  subscribeText: string;
}

/** Background-music settings (the only soundtrack — no voice-over). */
export interface MusicConfig {
  /**
   * Fixed track for every video (path relative to the root or absolute).
   * If defined and present, it takes precedence over `dir`; otherwise a track
   * is picked deterministically from `dir`.
   */
  track?: string;
  /** Tracks directory (used if `track` is not defined). */
  dir: string;
  /** Fade-in/fade-out duration (s). */
  fadeSec: number;
  /** Music volume (0–1, 1 = original volume). */
  volume: number;
}

/** Fixed scene durations (s). */
export interface SceneConfig {
  introSec: number;
  itemSec: number;
  /** Closing "subscribe" scene duration. */
  outroSec: number;
}

/**
 * Application configuration loaded from the editable file (config/feedreel.yaml):
 * video format, language, editorial identity, feeds, music, scene durations.
 */
export interface AppConfig {
  format: { width: number; height: number; fps: number };
  language: LanguageConfig;
  video: VideoConfig;
  feeds: string[];
  music: MusicConfig;
  scene: SceneConfig;
}

/** Global configuration, resolved from the environment (config/index.ts). */
export interface GlobalConfig {
  /** Project root (absolute). */
  projectRoot: string;
  /** Output directory for the videos. */
  outputDir: string;
  /** Cache directory (items + scripts + audio). */
  cacheDir: string;
  /** Path of the deduplication SQLite database. */
  dbPath: string;
  /** Frames per second. */
  fps: number;
  /** Video width (px). */
  width: number;
  /** Video height (px). */
  height: number;
  /** Timeout per RSS feed (ms). */
  feedTimeoutMs: number;
  /** Language identity (from the config). */
  language: LanguageConfig;
  /** Editorial identity (from the config). */
  video: VideoConfig;
  /** RSS/Atom feeds (from the config). */
  feeds: string[];
  /** Background-music settings (from the config). */
  music: MusicConfig;
  /** Scene durations (from the config). */
  scene: SceneConfig;
}

/** Normalized RSS item. */
export interface RssItem {
  /** guid or URL — deduplication key. */
  id: string;
  title: string;
  url: string;
  /** Cleaned summary (HTML removed) and truncated. */
  summary: string;
  /** Source domain (e.g. "bbc.co.uk"). */
  source: string;
  /** ISO 8601 publication date. */
  publishedAt: string;
}

/** A segment type in the rendered video. */
export type SegmentType = 'intro' | 'item' | 'outro';

/**
 * Script segment as written by the skill (before rendering).
 * `intro` uses `hook`; `item` uses `headline`/`body`/`url`/`source`.
 * All fields are optional (the scenes render defensively when one is missing).
 */
export interface ScriptSegmentInput {
  type: 'intro' | 'item';
  /** Intro only: 1–2 punchy on-screen sentences. */
  hook?: string;
  /** Item only: displayed title (≤ ~60 characters). */
  headline?: string;
  /** Item only: displayed detail (≤ ~140 characters). */
  body?: string;
  url?: string;
  source?: string;
}

/**
 * Video script as written by the skill (strict JSON, validated by zod).
 * `title` is on-screen; `description` + `hashtags` are for the social caption.
 */
export interface VideoScriptInput {
  date: string;
  title: string;
  description: string;
  hashtags: string[];
  segments: ScriptSegmentInput[];
}

/** Segment enriched with its fixed duration (and possibly the synthetic outro). */
export interface RenderedSegment {
  type: SegmentType;
  hook?: string;
  headline?: string;
  body?: string;
  url?: string;
  source?: string;
  durationSec: number;
  durationFrames: number;
}

/**
 * Resolved video script: props passed to the Remotion composition.
 * Includes the visual identity and the format.
 */
export interface VideoScript {
  date: string;
  title: string;
  segments: RenderedSegment[];
  /** Single background-music track for the whole video ('' if none). */
  audioFile: string;
  // Visual identity (from the config).
  emoji: string;
  label: string;
  accentColor: string;
  /** Header label prefix (e.g. "FOOTBALL"). */
  uiLabel: string;
  /** Intl locale to format the date (e.g. "en-US"). */
  dateLocale: string;
  /** Closing "subscribe" call-to-action. */
  subscribeText: string;
  // Format.
  fps: number;
  width: number;
  height: number;
}
