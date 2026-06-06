/**
 * "Music" mode (no voice-over): fixed scene durations + royalty-free background track.
 *
 * Replaces the TTS step when `cfg.audio.mode === 'music'`. Scene durations come
 * from `cfg.audio.scene` (intro/item); a track is picked from
 * `cfg.audio.music.dir`, then fitted (loop/trim + fade) to the total video duration.
 */
import fs from 'node:fs';
import path from 'node:path';

import type {
  CategoryConfig,
  GlobalConfig,
  RenderedSegment,
  VideoScript,
  VideoScriptInput,
} from '../types';
import { paths, resolveLanguage } from '../../config';
import { execOrThrow } from '../exec';
import { ensureDir } from '../util';
import { createLogger } from '../log';
import { framesForDuration } from './tts';

const logger = createLogger('music');

/** Audio extensions recognized for background tracks. */
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.opus']);

/**
 * Picks a track from the directory, DETERMINISTICALLY based on `seed`
 * (e.g. date+category): variety from one day/category to the next, yet reproducible.
 * Returns the absolute path, or null if no track is available.
 */
export function pickTrack(dir: string, seed: string): string | null {
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
      .sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return path.join(dir, files[h % files.length]!);
}

/**
 * Fits a track to `totalSec`: loops if too short, trims if too long,
 * and applies a fade in/out. Writes a WAV to `outFile`.
 */
export async function fitMusic(
  track: string,
  totalSec: number,
  outFile: string,
  fadeSec: number,
  volume = 1,
): Promise<void> {
  ensureDir(path.dirname(outFile));
  const fade = Math.max(0, Math.min(fadeSec, totalSec / 2));
  const fadeOutStart = Math.max(0, totalSec - fade).toFixed(3);
  const filters = `volume=${volume},afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOutStart}:d=${fade}`;
  await execOrThrow('ffmpeg', [
    '-y',
    '-stream_loop',
    '-1', // loop the track indefinitely…
    '-i',
    track,
    '-vn', // ignore any cover art (image stream) in the MP3
    '-t',
    totalSec.toFixed(3), // …then trim to the total duration
    '-af',
    filters,
    '-ar',
    '44100',
    '-ac',
    '2',
    outFile,
  ]);
}

/**
 * Assembles the video in music mode: fixed scene durations + fitted background track.
 * Returns the `VideoScript` ready for Remotion (without voice).
 */
export async function assembleMusicVideo(args: {
  script: VideoScriptInput;
  category: CategoryConfig;
  cfg: GlobalConfig;
  date: string;
}): Promise<VideoScript> {
  const { script, category, cfg, date } = args;
  const p = paths(cfg, date, category.id);
  ensureDir(p.audioDir);

  const { introSec, itemSec } = cfg.audio.scene;

  // Fixed durations per segment type.
  const segments: RenderedSegment[] = script.segments.map((seg) => {
    const durationSec = seg.type === 'intro' ? introSec : itemSec;
    return {
      ...seg,
      audioPath: '',
      durationSec,
      durationFrames: framesForDuration(durationSec, cfg.fps),
    };
  });

  const totalSec = segments.reduce((s, seg) => s + seg.durationSec, 0);

  // Background track: use the configured fixed track if present, otherwise pick from the directory.
  const fixed = cfg.audio.music.track;
  const track =
    fixed && fs.existsSync(fixed) ? fixed : pickTrack(cfg.audio.music.dir, `${date}:${category.id}`);
  let audioFile = '';
  if (track) {
    audioFile = p.audioFile;
    await fitMusic(track, totalSec, audioFile, cfg.audio.music.fadeSec, cfg.audio.music.volume);
    logger.info(
      `track "${path.basename(track)}" fitted to ${totalSec.toFixed(1)}s for "${category.id}"`,
    );
  } else {
    logger.warn(
      `no track in ${cfg.audio.music.dir}: video "${category.id}" will have no music. Run the setup or drop an audio file.`,
    );
  }

  const language = resolveLanguage(cfg, category);
  return {
    category: script.category,
    date: script.date,
    title: script.title,
    segments,
    audioFile,
    emoji: category.emoji,
    label: category.label,
    accentColor: category.accentColor,
    langCode: language.code,
    uiLabel: language.uiLabel,
    dateLocale: language.dateLocale,
    fps: cfg.fps,
    width: cfg.width,
    height: cfg.height,
  };
}
