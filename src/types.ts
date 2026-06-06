/**
 * Shared data contracts of the feedreel pipeline.
 * This file is the source of truth; all modules import from here.
 */

/** Configuration of a video category (centralized in the editable config). */
export interface CategoryConfig {
  /** Stable slug identifier (used as file key and output name). */
  id: string;
  /** Label displayed in the video (e.g. "Security"). */
  label: string;
  /** Header emoji. */
  emoji: string;
  /** Accent color (hex, e.g. "#ff5577"). */
  accentColor: string;
  /** Maximum number of items kept for the video. */
  maxItems: number;
  /** RSS/Atom feeds of the category. Empty if `aggregate`. */
  feeds: string[];
  /**
   * If true: aggregated category (e.g. "Global"). Has no feed of its own; built
   * from the top item of each other category.
   */
  aggregate?: boolean;
  /**
   * Language code of the category (e.g. "fr", "en"). If absent: `defaultLanguage`
   * from the configuration. Drives the TTS voice, the Claude prompt, the labels and the date.
   */
  language?: string;
}

/**
 * Configuration of a language: drives the writing (Claude), the speech synthesis,
 * the UI labels and the date format. Enables multilingual support.
 */
export interface LanguageConfig {
  /** Short BCP-47 code (e.g. "fr", "en"). */
  code: string;
  /** Name of the language for the instructions given to Claude (e.g. "français", "English"). */
  name: string;
  /** Label prefix displayed in the video header (e.g. "VEILLE", "TECH WATCH"). */
  uiLabel: string;
  /** Intl locale to format the date (e.g. "fr-FR", "en-US"). */
  dateLocale: string;
  /** TTS settings for this language. */
  tts: TtsConfig;
}

/** TTS backend and voice for a language. */
export interface TtsConfig {
  /** Engine: "kokoro" (kokoro-mlx), "piper", "xtts"… (extensible). */
  engine: string;
  /** Engine-specific voice identifier (e.g. "ff_siwis", "fr_FR-tom-medium"). */
  voice: string;
}

/**
 * Audio configuration: drives the soundtrack of the videos.
 *  - `mode: 'music'` (default): no voice-over, royalty-free background music;
 *    the scene durations are fixed (see `scene`).
 *  - `mode: 'voice'`: TTS voice-over (the scene durations follow the synthesized audio).
 */
export interface AudioConfig {
  mode: 'music' | 'voice';
  /** Music mode settings. */
  music: {
    /**
     * Fixed track to use for ALL videos (path relative to the root or absolute).
     * If defined and present, it takes precedence over `dir`. Otherwise, a track from `dir` is picked.
     */
    track?: string;
    /** Tracks directory (used if `track` is not defined; the pipeline picks one from it). */
    dir: string;
    /** Fade-in/fade-out duration (s). */
    fadeSec: number;
    /** Music volume (0–1, 1 = original volume). */
    volume: number;
  };
  /** Fixed scene durations in music mode (s). */
  scene: {
    introSec: number;
    itemSec: number;
  };
}

/**
 * Application configuration loaded from the editable file (config/feedreel.yaml):
 * video format, languages, categories, audio. Single editable source without touching the code.
 */
export interface AppConfig {
  format: { width: number; height: number; fps: number };
  defaultLanguage: string;
  languages: Record<string, LanguageConfig>;
  categories: CategoryConfig[];
  audio: AudioConfig;
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
  /** Kokoro voice (default ff_siwis). */
  voice: string;
  /** Python binary of the TTS venv. */
  pythonBin: string;
  /** Claude CLI binary (autonomous mode). */
  claudeBin: string;
  /** Path of the Python TTS wrapper. */
  ttsScript: string;
  /** Frames per second. */
  fps: number;
  /** Video width (px). */
  width: number;
  /** Video height (px). */
  height: number;
  /** Timeout per RSS feed (ms). */
  feedTimeoutMs: number;
  /** Default language code (from the config). */
  defaultLanguage: string;
  /** Available languages (from the config). */
  languages: Record<string, LanguageConfig>;
  /** Audio configuration (music vs voice), from the config. */
  audio: AudioConfig;
}

/** Normalized RSS item (FR-1). */
export interface RssItem {
  /** guid or URL — deduplication key. */
  id: string;
  /** category id. */
  category: string;
  title: string;
  url: string;
  /** Cleaned summary (HTML removed) and truncated. */
  summary: string;
  /** Source domain (e.g. "krebsonsecurity.com"). */
  source: string;
  /** ISO 8601 publication date. */
  publishedAt: string;
}

/** Script segment as produced by Claude (before TTS). */
export interface ScriptSegmentInput {
  type: 'intro' | 'item';
  /** ≤ ~60 characters, displayed (item only, optional for intro). */
  headline?: string;
  /** ≤ ~140 characters, displayed. */
  body?: string;
  /** 1–3 natural spoken sentences (always present). */
  narration: string;
  url?: string;
  source?: string;
}

/** Video script as produced by Claude (strict JSON output, §11). */
export interface VideoScriptInput {
  category: string;
  date: string;
  title: string;
  segments: ScriptSegmentInput[];
}

/** Segment enriched by the TTS (audio path + durations). */
export interface RenderedSegment extends ScriptSegmentInput {
  audioPath: string;
  durationSec: number;
  durationFrames: number;
}

/**
 * Resolved video script: props passed to the Remotion composition.
 * Includes the visual identity of the category and the format.
 */
export interface VideoScript {
  category: string;
  date: string;
  title: string;
  segments: RenderedSegment[];
  /** Concatenated audio file (1 track for the whole video). */
  audioFile: string;
  // Category identity (copied from CategoryConfig for composition autonomy).
  emoji: string;
  label: string;
  accentColor: string;
  // Language (for the labels and the date format of the composition).
  /** Language code (e.g. "fr", "en"). */
  langCode: string;
  /** Header label prefix (e.g. "VEILLE", "TECH WATCH"). */
  uiLabel: string;
  /** Intl locale to format the date (e.g. "fr-FR"). */
  dateLocale: string;
  // Format.
  fps: number;
  width: number;
  height: number;
}
