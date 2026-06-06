import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { GlobalConfig } from '../src/types';
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
 * Global configuration resolved from the environment, with default values.
 * All relative paths are resolved from the project root.
 */
export function loadConfig(): GlobalConfig {
  const app = loadAppConfig();
  return {
    projectRoot: PROJECT_ROOT,
    outputDir: resolveFromRoot(process.env.FEEDREEL_OUTPUT_DIR ?? 'output'),
    cacheDir: resolveFromRoot(process.env.FEEDREEL_CACHE_DIR ?? 'cache'),
    dbPath: resolveFromRoot(process.env.FEEDREEL_DB_PATH ?? 'feedreel.db'),
    fps: envInt('FEEDREEL_FPS', app.format.fps),
    width: envInt('FEEDREEL_WIDTH', app.format.width),
    height: envInt('FEEDREEL_HEIGHT', app.format.height),
    feedTimeoutMs: envInt('FEEDREEL_FEED_TIMEOUT_MS', 12000),
    language: app.language,
    video: app.video,
    feeds: app.feeds,
    music: {
      // Fixed track overridable via env (FEEDREEL_MUSIC_TRACK), otherwise config.
      track: (() => {
        const t = process.env.FEEDREEL_MUSIC_TRACK ?? app.music.track;
        return t ? resolveFromRoot(t) : undefined;
      })(),
      dir: resolveFromRoot(app.music.dir),
      fadeSec: app.music.fadeSec,
      volume: app.music.volume,
    },
    scene: app.scene,
  };
}

/** Derived paths for a given date (one video per date). */
export function paths(cfg: GlobalConfig, date: string) {
  return {
    itemsFile: path.join(cfg.cacheDir, 'items', `${date}.json`),
    scriptFile: path.join(cfg.cacheDir, 'scripts', `${date}.json`),
    audioFile: path.join(cfg.cacheDir, 'audio', `${date}.wav`),
    outputDir: cfg.outputDir,
    outputFile: path.join(cfg.outputDir, `${date}.mp4`),
    textFile: path.join(cfg.outputDir, `${date}.txt`),
  };
}
