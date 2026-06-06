/**
 * TTS step of the pipeline: voice synthesis of the narrations (via scripts/tts.py),
 * duration measurement and concatenation into a single audio track.
 *
 * The Python wrapper `scripts/tts.py` EXISTS and is validated: we call it in batch
 * mode (JSON manifest); we do not rewrite it.
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
import { exec, execOrThrow } from '../exec';
import { ensureDir } from '../util';
import { createLogger } from '../log';

const logger = createLogger('tts');

/**
 * Resolves the Python binary and wrapper to use based on the language's TTS engine.
 * Each engine has its own dedicated venv (kokoro/piper/xtts); the wrapper exposes the
 * SAME manifest → JSON {results:[{out,duration,sample_rate}]} contract.
 */
function engineRunner(cfg: GlobalConfig, engine: string): { python: string; script: string } {
  const root = cfg.projectRoot;
  switch (engine) {
    case 'kokoro':
      return { python: cfg.pythonBin, script: cfg.ttsScript };
    case 'piper':
      return { python: path.join(root, '.venv-piper/bin/python'), script: path.join(root, 'scripts/tts_piper.py') };
    case 'xtts':
      return { python: path.join(root, '.venv-xtts/bin/python'), script: path.join(root, 'scripts/tts_xtts.py') };
    default:
      throw new Error(`Unknown TTS engine: "${engine}" (kokoro | piper | xtts).`);
  }
}

/** Format of the results printed on stdout by tts.py. */
interface TtsResult {
  out: string;
  duration: number;
  sample_rate: number;
}

/**
 * Number of frames covering a given audio duration (PURE).
 * Always ≥ 1 frame, even for a tiny duration (near-empty segment).
 */
export function framesForDuration(durationSec: number, fps: number): number {
  return Math.max(1, Math.ceil(durationSec * fps));
}

/**
 * Duration of a media file in seconds via `ffprobe` (fallback when tts.py
 * did not return a duration for a given segment).
 */
export async function probeDurationSec(file: string): Promise<number> {
  const res = await exec('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const value = Number.parseFloat(res.stdout.trim());
  return Number.isFinite(value) ? value : 0;
}

/** Builds the WAV path of a segment, ordered and zero-padded. */
function segmentOutPath(audioDir: string, index: number): string {
  return path.join(audioDir, `seg-${String(index).padStart(2, '0')}.wav`);
}

/**
 * Synthesizes the voice of all segments, measures their durations, concatenates the
 * WAVs into a single track and returns the enriched `VideoScript` ready for Remotion.
 */
export async function synthesizeVideo(args: {
  script: VideoScriptInput;
  category: CategoryConfig;
  cfg: GlobalConfig;
  date: string;
}): Promise<VideoScript> {
  const { script, category, cfg, date } = args;
  const p = paths(cfg, date, category.id);
  ensureDir(p.audioDir);

  // Category language → voice, engine and language code.
  const language = resolveLanguage(cfg, category);
  const runner = engineRunner(cfg, language.tts.engine);

  // Batch manifest: one WAV per segment, ordered paths under audioDir.
  const manifestSegments = script.segments.map((seg, i) => ({
    text: seg.narration,
    out: segmentOutPath(p.audioDir, i),
  }));
  const manifest = {
    voice: language.tts.voice,
    language: language.code,
    sample_rate: 24000,
    segments: manifestSegments,
  };
  const manifestPath = path.join(p.audioDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  logger.info(
    `synthesizing ${manifestSegments.length} segment(s) for "${category.id}" (${date}, ${language.code}/${language.tts.engine}:${language.tts.voice})`,
  );

  // Call the engine's Python wrapper in batch mode (model loaded only once).
  const res = await exec(runner.python, [runner.script, '--manifest', manifestPath], {
    timeoutMs: 600000,
  });
  if (res.code !== 0) {
    throw new Error(
      `TTS failure (${res.code}): ${runner.python} ${runner.script}\n${res.stderr || res.stdout}`,
    );
  }

  // Index the results BY `out` path (tts.py skips empty texts).
  const byOut = new Map<string, TtsResult>();
  const parsed = JSON.parse(res.stdout) as { results?: TtsResult[] };
  for (const r of parsed.results ?? []) {
    byOut.set(r.out, r);
  }

  // Enrich each segment in the script's order.
  const segments: RenderedSegment[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i]!;
    const out = manifestSegments[i]!.out;
    const result = byOut.get(out);
    const durationSec = result ? result.duration : await probeDurationSec(out);
    segments.push({
      ...seg,
      audioPath: out,
      durationSec,
      durationFrames: framesForDuration(durationSec, cfg.fps),
    });
  }

  // Concatenate the existing WAVs via ffmpeg's concat demuxer.
  const existing = segments.map((s) => s.audioPath).filter((f) => fs.existsSync(f));
  if (existing.length > 0) {
    const listPath = path.join(p.audioDir, 'concat.txt');
    const listBody = existing
      .map((f) => `file '${path.resolve(f)}'`)
      .join('\n');
    fs.writeFileSync(listPath, listBody + '\n', 'utf-8');
    await execOrThrow('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      p.audioFile,
    ]);
  }

  return {
    category: script.category,
    date: script.date,
    title: script.title,
    segments,
    audioFile: p.audioFile,
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
