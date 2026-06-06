/**
 * Soundtrack assembly (music only — no voice-over).
 *
 * Scene durations are fixed (`cfg.scene`: intro/item/outro). A background track is
 * taken from `cfg.music.track` (or picked from `cfg.music.dir`), then fitted
 * (loop/trim + fade) to the total video duration. A closing "subscribe" outro
 * segment is appended automatically.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { GlobalConfig, RenderedSegment, VideoScript, VideoScriptInput } from '../types';
import { paths } from '../../config';
import { execOrThrow } from '../exec';
import { ensureDir, framesForDuration } from '../util';
import { createLogger } from '../log';

const logger = createLogger('music');

/** Audio extensions recognized for background tracks. */
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.opus']);

/**
 * Picks a track from the directory, DETERMINISTICALLY based on `seed` (e.g. the
 * date): variety from one day to the next, yet reproducible.
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
 * Assembles the soundtrack: fixed scene durations (+ auto outro) and a fitted
 * background track. Returns the `VideoScript` ready for Remotion.
 */
export async function assembleMusicVideo(args: {
  script: VideoScriptInput;
  cfg: GlobalConfig;
  date: string;
}): Promise<VideoScript> {
  const { script, cfg, date } = args;
  const p = paths(cfg, date);
  const { introSec, itemSec, outroSec } = cfg.scene;

  // Fixed durations per segment, then a synthetic "subscribe" outro at the end.
  const segments: RenderedSegment[] = script.segments.map((seg) => {
    const durationSec = seg.type === 'intro' ? introSec : itemSec;
    return { ...seg, durationSec, durationFrames: framesForDuration(durationSec, cfg.fps) };
  });
  segments.push({
    type: 'outro',
    durationSec: outroSec,
    durationFrames: framesForDuration(outroSec, cfg.fps),
  });

  const totalSec = segments.reduce((s, seg) => s + seg.durationSec, 0);

  // Background track: configured fixed track if present, otherwise pick from the dir.
  const fixed = cfg.music.track;
  const track = fixed && fs.existsSync(fixed) ? fixed : pickTrack(cfg.music.dir, date);
  let audioFile = '';
  if (track) {
    audioFile = p.audioFile;
    await fitMusic(track, totalSec, audioFile, cfg.music.fadeSec, cfg.music.volume);
    logger.info(`track "${path.basename(track)}" fitted to ${totalSec.toFixed(1)}s`);
  } else {
    logger.warn(
      `no track in ${cfg.music.dir}: the video will have no music. Run the setup or drop an audio file.`,
    );
  }

  return {
    date: script.date,
    title: script.title,
    segments,
    audioFile,
    emoji: cfg.video.emoji,
    label: cfg.video.label,
    accentColor: cfg.video.accentColor,
    uiLabel: cfg.language.uiLabel,
    dateLocale: cfg.language.dateLocale,
    subscribeText: cfg.video.subscribeText,
    fps: cfg.fps,
    width: cfg.width,
    height: cfg.height,
  };
}
