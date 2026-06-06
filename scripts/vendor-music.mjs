#!/usr/bin/env node
/**
 * Downloads CC0 music tracks (public domain, NO attribution required)
 * into assets/music/, for the "music" audio mode (background track of the videos).
 *
 * Source: https://github.com/SoundSafari/CC0-1.0-Music (CC0-1.0 license).
 * Idempotent: does not re-download a file that is already present.
 * Drop your own .mp3/.wav files into assets/music/ to use them instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MUSIC_DIR = path.join(ROOT, 'assets', 'music');
const BASE = 'https://raw.githubusercontent.com/SoundSafari/CC0-1.0-Music/main/chosic.com';

// Curated selection (tech / electro / chill vibe), all CC0-1.0.
const TRACKS = [
  { src: 'Alpha_Hydrae_-_02_-_Chill_Out_Secret_Mission(chosic.com).mp3', out: 'alpha-hydrae-chill-out.mp3' },
  { src: 'Alpha_Hydrae_-_09_-_Tired_to_be_wild(chosic.com).mp3', out: 'alpha-hydrae-tired-to-be-wild.mp3' },
  { src: 'Anonymous420_-_02_-_First_step_for_your_first_tech(chosic.com).mp3', out: 'anonymous420-first-tech.mp3' },
  { src: 'Bauchamp_-_148_jucky(chosic.com).mp3', out: 'bauchamp-jucky.mp3' },
];

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10_000) throw new Error(`file too small (${buf.length} bytes), likely an error`);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });

  // License note next to the tracks.
  fs.writeFileSync(
    path.join(MUSIC_DIR, 'LICENSE.txt'),
    [
      'Music tracks — CC0 1.0 license (public domain, no attribution required).',
      'Source: https://github.com/SoundSafari/CC0-1.0-Music',
      '',
      'You may freely replace/add your own tracks (.mp3, .wav, .m4a, .ogg)',
      'in this folder; the pipeline picks one per video.',
      '',
    ].join('\n'),
    'utf8',
  );

  let ok = 0;
  for (const t of TRACKS) {
    const dest = path.join(MUSIC_DIR, t.out);
    if (fs.existsSync(dest)) {
      console.log(`= already present: ${t.out}`);
      ok++;
      continue;
    }
    const url = `${BASE}/${encodeURIComponent(t.src)}`;
    try {
      const size = await download(url, dest);
      console.log(`✓ ${t.out} (${(size / 1e6).toFixed(1)} MB)`);
      ok++;
    } catch (e) {
      console.warn(`✗ failed ${t.out}: ${String(e)}`);
    }
  }
  console.log(`CC0 music: ${ok}/${TRACKS.length} track(s) ready in ${MUSIC_DIR}`);
  if (ok === 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
