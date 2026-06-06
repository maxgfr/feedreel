import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CategoryConfig, GlobalConfig, LanguageConfig } from '../src/types';
import { loadAppConfig } from './load';

/** Project root (this file lives in <root>/config/). */
export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Global configuration resolved from the environment, with default values (PRD §13).
 * All relative paths are resolved from the project root.
 */
export function loadConfig(): GlobalConfig {
  const cacheDir = resolveFromRoot(process.env.FEEDREEL_CACHE_DIR ?? 'cache');
  const app = loadAppConfig();
  return {
    projectRoot: PROJECT_ROOT,
    outputDir: resolveFromRoot(process.env.FEEDREEL_OUTPUT_DIR ?? 'output'),
    cacheDir,
    dbPath: resolveFromRoot(process.env.FEEDREEL_DB_PATH ?? 'feedreel.db'),
    // Default voice: the one for the default language (overridable via env, e.g. tests).
    voice: process.env.FEEDREEL_VOICE ?? app.languages[app.defaultLanguage]?.tts.voice ?? 'ff_siwis',
    // Default: Python from the dedicated TTS venv (created by scripts/setup.sh via uv).
    pythonBin: resolveFromRoot(process.env.FEEDREEL_PYTHON ?? '.venv/bin/python'),
    claudeBin: process.env.FEEDREEL_CLAUDE_BIN ?? 'claude',
    ttsScript: resolveFromRoot(process.env.FEEDREEL_TTS_SCRIPT ?? 'scripts/tts.py'),
    // Format: from the YAML, overridable via env.
    fps: envInt('FEEDREEL_FPS', app.format.fps),
    width: envInt('FEEDREEL_WIDTH', app.format.width),
    height: envInt('FEEDREEL_HEIGHT', app.format.height),
    feedTimeoutMs: envInt('FEEDREEL_FEED_TIMEOUT_MS', 12000),
    defaultLanguage: app.defaultLanguage,
    languages: app.languages,
    audio: {
      // Mode overridable via env (FEEDREEL_AUDIO_MODE=music|voice).
      mode: (process.env.FEEDREEL_AUDIO_MODE as 'music' | 'voice') || app.audio.mode,
      music: {
        // Fixed track overridable via env (FEEDREEL_MUSIC_TRACK), otherwise config.
        track: (() => {
          const t = process.env.FEEDREEL_MUSIC_TRACK ?? app.audio.music.track;
          return t ? resolveFromRoot(t) : undefined;
        })(),
        dir: resolveFromRoot(app.audio.music.dir),
        fadeSec: app.audio.music.fadeSec,
        volume: app.audio.music.volume,
      },
      scene: app.audio.scene,
    },
  };
}

/** Resolves a category's language configuration (its `language` or the default language). */
export function resolveLanguage(cfg: GlobalConfig, category: Pick<CategoryConfig, 'language'>): LanguageConfig {
  const code = category.language ?? cfg.defaultLanguage;
  const lang = cfg.languages[code] ?? cfg.languages[cfg.defaultLanguage];
  if (!lang) throw new Error(`Language "${code}" not found.`);
  return lang;
}

/** Derived paths for a given date + category. */
export function paths(cfg: GlobalConfig, date: string, categoryId: string) {
  return {
    itemsFile: path.join(cfg.cacheDir, 'items', date, `${categoryId}.json`),
    scriptFile: path.join(cfg.cacheDir, 'scripts', date, `${categoryId}.json`),
    metadataFile: path.join(cfg.cacheDir, 'metadata', date, `${categoryId}.json`),
    audioDir: path.join(cfg.cacheDir, 'audio', date, categoryId),
    audioFile: path.join(cfg.cacheDir, 'audio', date, categoryId, 'voice.wav'),
    outputDir: path.join(cfg.outputDir, date),
    outputFile: path.join(cfg.outputDir, date, `${categoryId}.mp4`),
  };
}
