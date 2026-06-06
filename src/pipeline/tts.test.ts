/**
 * Tests for the TTS step — WITHOUT python or ffmpeg.
 * We mock `../exec` to intercept the calls and inspect the generated manifest.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryConfig, GlobalConfig, VideoScriptInput } from '../types';
import { paths } from '../../config';

// Mock the execution module: no real subprocess (python/ffmpeg/ffprobe).
const execMock = vi.fn();
const execOrThrowMock = vi.fn();
vi.mock('../exec', () => ({
  exec: (...a: unknown[]) => execMock(...a),
  execOrThrow: (...a: unknown[]) => execOrThrowMock(...a),
}));

import { framesForDuration, synthesizeVideo } from './tts';

describe('framesForDuration (PURE)', () => {
  it('rounds up to the next frame: 2.325s @30fps -> 70', () => {
    // 2.325 * 30 = 69.75 -> ceil -> 70
    expect(framesForDuration(2.325, 30)).toBe(70);
  });

  it('guarantees at least 1 frame for a tiny duration: 0.01s -> 1', () => {
    expect(framesForDuration(0.01, 30)).toBe(1);
  });

  it('returns 1 frame for a zero duration', () => {
    expect(framesForDuration(0, 30)).toBe(1);
  });
});

describe('synthesizeVideo — manifest construction', () => {
  let tmpDir: string;
  let cfg: GlobalConfig;

  const category: CategoryConfig = {
    id: 'ia',
    label: 'IA',
    emoji: '🧠',
    accentColor: '#a974ff',
    maxItems: 5,
    feeds: [],
  };

  const script: VideoScriptInput = {
    category: 'ia',
    date: '2026-06-05',
    title: 'AI Tech News',
    segments: [
      { type: 'intro', narration: 'Hello and welcome.' },
      {
        type: 'item',
        headline: 'Headline 1',
        body: 'Body 1',
        narration: 'First story of the day.',
        url: 'https://example.com/1',
        source: 'example.com',
      },
      {
        type: 'item',
        headline: 'Headline 2',
        body: 'Body 2',
        narration: 'Second story of the day.',
        url: 'https://example.com/2',
        source: 'example.com',
      },
    ],
  };

  beforeEach(() => {
    execMock.mockReset();
    execOrThrowMock.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-tts-'));
    cfg = {
      projectRoot: tmpDir,
      outputDir: path.join(tmpDir, 'output'),
      cacheDir: path.join(tmpDir, 'cache'),
      dbPath: path.join(tmpDir, 'feedreel.db'),
      voice: 'ff_siwis',
      pythonBin: '/fake/python',
      claudeBin: 'claude',
      ttsScript: '/fake/tts.py',
      fps: 30,
      width: 1080,
      height: 1920,
      feedTimeoutMs: 12000,
      defaultLanguage: 'fr',
      languages: { fr: { code: 'fr', name: 'français', uiLabel: 'VEILLE', dateLocale: 'fr-FR', tts: { engine: 'kokoro', voice: 'ff_siwis' } } },
      audio: { mode: 'music', music: { dir: 'assets/music', fadeSec: 1.5, volume: 1 }, scene: { introSec: 3, itemSec: 4 } },
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a manifest with segments {text: narration, out} ordered under audioDir', async () => {
    const audioDir = paths(cfg, script.date, category.id).audioDir;

    // exec (= python call): we create NO WAV (so ffmpeg will not be called).
    execMock.mockResolvedValue({ code: 0, stdout: JSON.stringify({ results: [] }), stderr: '' });

    await synthesizeVideo({ script, category, cfg, date: script.date });

    const manifestPath = path.join(audioDir, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.voice).toBe('ff_siwis');
    expect(manifest.language).toBe('fr');
    expect(manifest.sample_rate).toBe(24000);

    // Order + narration -> text mapping, and out paths ordered under audioDir.
    expect(manifest.segments).toEqual([
      { text: 'Hello and welcome.', out: path.join(audioDir, 'seg-00.wav') },
      { text: 'First story of the day.', out: path.join(audioDir, 'seg-01.wav') },
      { text: 'Second story of the day.', out: path.join(audioDir, 'seg-02.wav') },
    ]);
  });

  it('calls python in batch mode (--manifest) with pythonBin and ttsScript', async () => {
    const audioDir = paths(cfg, script.date, category.id).audioDir;
    // Durations provided by tts.py -> no ffprobe fallback; no WAV -> no ffmpeg.
    const results = [0, 1, 2].map((i) => ({
      out: path.join(audioDir, `seg-0${i}.wav`),
      duration: 1,
      sample_rate: 24000,
    }));
    execMock.mockResolvedValue({ code: 0, stdout: JSON.stringify({ results }), stderr: '' });

    await synthesizeVideo({ script, category, cfg, date: script.date });

    // Only the python call happens (no WAV created -> no ffmpeg, no ffprobe).
    expect(execMock).toHaveBeenCalledTimes(1);
    const [cmd, callArgs, opts] = execMock.mock.calls[0]!;
    expect(cmd).toBe('/fake/python');
    expect(callArgs).toEqual(['/fake/tts.py', '--manifest', path.join(audioDir, 'manifest.json')]);
    expect(opts).toEqual({ timeoutMs: 600000 });
  });

  it('matches the results BY out path and enriches each segment', async () => {
    const audioDir = paths(cfg, script.date, category.id).audioDir;
    const out0 = path.join(audioDir, 'seg-00.wav');
    const out1 = path.join(audioDir, 'seg-01.wav');
    const out2 = path.join(audioDir, 'seg-02.wav');

    // Results DELIBERATELY out of order: matching is done by `out`.
    execMock.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        results: [
          { out: out2, duration: 1.5, sample_rate: 24000 },
          { out: out0, duration: 2.325, sample_rate: 24000 },
          { out: out1, duration: 0.01, sample_rate: 24000 },
        ],
      }),
      stderr: '',
    });
    execOrThrowMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    // Create the WAVs to trigger the ffmpeg concat.
    fs.mkdirSync(audioDir, { recursive: true });
    for (const f of [out0, out1, out2]) fs.writeFileSync(f, 'RIFF');

    const vs = await synthesizeVideo({ script, category, cfg, date: script.date });

    expect(vs.segments[0]!.durationSec).toBe(2.325);
    expect(vs.segments[0]!.durationFrames).toBe(70);
    expect(vs.segments[0]!.audioPath).toBe(out0);
    expect(vs.segments[1]!.durationSec).toBe(0.01);
    expect(vs.segments[1]!.durationFrames).toBe(1);
    expect(vs.segments[2]!.durationSec).toBe(1.5);

    // ffmpeg concat via concat demuxer, list file with absolute paths.
    expect(execOrThrowMock).toHaveBeenCalledTimes(1);
    const [ffCmd, ffArgs] = execOrThrowMock.mock.calls[0]!;
    expect(ffCmd).toBe('ffmpeg');
    expect(ffArgs).toContain('concat');
    expect(ffArgs).toContain('-safe');
    const listPath = path.join(audioDir, 'concat.txt');
    expect(fs.existsSync(listPath)).toBe(true);
    expect(fs.readFileSync(listPath, 'utf-8')).toContain(`file '${path.resolve(out0)}'`);
  });

  it('returns a VideoScript with category identity and format from cfg', async () => {
    execMock.mockResolvedValue({ code: 0, stdout: JSON.stringify({ results: [] }), stderr: '' });

    const vs = await synthesizeVideo({ script, category, cfg, date: script.date });

    expect(vs.title).toBe('AI Tech News');
    expect(vs.emoji).toBe('🧠');
    expect(vs.label).toBe('IA');
    expect(vs.accentColor).toBe('#a974ff');
    expect(vs.fps).toBe(30);
    expect(vs.width).toBe(1080);
    expect(vs.height).toBe(1920);
    expect(vs.audioFile).toBe(paths(cfg, script.date, category.id).audioFile);
  });
});
