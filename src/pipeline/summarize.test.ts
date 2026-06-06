/**
 * Tests for the "summarize" step — WITHOUT network.
 *
 * Covers: parseScriptJson (success with stray text / schema failure),
 * buildPrompt (presence of key instructions and item titles),
 * generateScript in `file` mode (writing a temporary scriptFile then re-reading it).
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CategoryConfig, GlobalConfig, RssItem } from '../types';
import { paths } from '../../config/index';
import { ensureDir } from '../util';
import {
  buildPrompt,
  parseScriptJson,
  generateScript,
  VideoScriptSchema,
} from './summarize';

/** Mock category for the tests (no network I/O). */
const category: CategoryConfig = {
  id: 'rust',
  label: 'Rust',
  emoji: '🦀',
  accentColor: '#ff7043',
  maxItems: 5,
  feeds: ['https://example.test/feed.xml'],
};

/** Two RSS items whose titles must appear in the prompt. */
const items: RssItem[] = [
  {
    id: 'item-1',
    category: 'rust',
    title: 'Rust 1.99 released with stable async traits',
    url: 'https://blog.rust-lang.org/1-99',
    summary: 'Asynchronous traits are now stable.',
    source: 'blog.rust-lang.org',
    publishedAt: '2026-06-05T08:00:00.000Z',
  },
  {
    id: 'item-2',
    category: 'rust',
    title: 'This Week in Rust issue 600',
    url: 'https://this-week-in-rust.org/600',
    summary: 'Weekly roundup of the Rust ecosystem.',
    source: 'this-week-in-rust.org',
    publishedAt: '2026-06-04T08:00:00.000Z',
  },
];

const date = '2026-06-05';

/** Builds a minimal GlobalConfig pointing to a temporary cacheDir. */
function makeConfig(cacheDir: string): GlobalConfig {
  return {
    projectRoot: cacheDir,
    outputDir: path.join(cacheDir, 'output'),
    cacheDir,
    dbPath: path.join(cacheDir, 'feedreel.db'),
    voice: 'ff_siwis',
    pythonBin: 'python',
    claudeBin: 'claude',
    ttsScript: path.join(cacheDir, 'tts.py'),
    fps: 30,
    width: 1080,
    height: 1920,
    feedTimeoutMs: 12000,
    defaultLanguage: 'fr',
    languages: { fr: { code: 'fr', name: 'français', uiLabel: 'VEILLE', dateLocale: 'fr-FR', tts: { engine: 'kokoro', voice: 'ff_siwis' } } },
    audio: { mode: 'music', music: { dir: 'assets/music', fadeSec: 1.5, volume: 1 }, scene: { introSec: 3, itemSec: 4 } },
  };
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseScriptJson', () => {
  it('(1) accepts valid JSON surrounded by markdown fences and stray text', () => {
    const valid = {
      category: 'rust',
      date,
      title: "Today's Rust news",
      segments: [
        { type: 'intro', narration: 'Hello and welcome to the Rust tech news.' },
        {
          type: 'item',
          headline: 'Rust 1.99',
          body: 'Stable async traits.',
          narration: 'Rust 1.99 stabilizes asynchronous traits.',
          url: 'https://blog.rust-lang.org/1-99',
          source: 'blog.rust-lang.org',
        },
      ],
    };

    const raw = [
      'Here is the requested script:',
      '```json',
      JSON.stringify(valid),
      '```',
      'Hope this works for you.',
    ].join('\n');

    const parsed = parseScriptJson(raw);
    expect(parsed).toEqual(valid);
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]?.type).toBe('intro');
  });

  it('(2) rejects JSON whose schema is violated (missing narration)', () => {
    const invalid = {
      category: 'rust',
      date,
      title: 'Title',
      // item segment without `narration` (required field) → must fail zod validation.
      segments: [{ type: 'item', headline: 'No narration' }],
    };
    const raw = '```json\n' + JSON.stringify(invalid) + '\n```';
    expect(() => parseScriptJson(raw)).toThrow();
  });

  it('rejects an output without a JSON object', () => {
    expect(() => parseScriptJson('no json here')).toThrow();
  });

  it('exposes a zod schema consistent with the contract', () => {
    const r = VideoScriptSchema.safeParse({
      category: 'rust',
      date,
      title: 'T',
      segments: [{ type: 'intro', narration: 'Hi.' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('buildPrompt', () => {
  it('(3) contains the key instructions and the item titles', () => {
    const prompt = buildPrompt(category, items, date);

    // Key instructions.
    expect(prompt).toMatch(/fran[çc]ais/i);
    expect(prompt).toContain('STRICT JSON');
    expect(prompt).toContain(String(category.maxItems)); // maxItems
    expect(prompt).toContain('headline');
    expect(prompt).toContain('narration');
    expect(prompt).toContain("type:'intro'");

    // Item titles present in the list.
    for (const it of items) {
      expect(prompt).toContain(it.title);
      expect(prompt).toContain(it.url);
      expect(prompt).toContain(it.source);
    }

    // Category identity + date.
    expect(prompt).toContain(category.label);
    expect(prompt).toContain(date);
  });
});

describe('generateScript', () => {
  it('(4) "file" mode: re-reads a previously written temporary scriptFile', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-summarize-'));
    tmpDirs.push(cacheDir);
    const cfg = makeConfig(cacheDir);

    const expected = {
      category: 'rust',
      date,
      title: 'Rust tech news for June 5',
      segments: [
        { type: 'intro' as const, narration: "On today's agenda." },
        {
          type: 'item' as const,
          headline: 'Rust 1.99',
          body: 'Stable async traits.',
          narration: 'Rust 1.99 stabilizes async traits.',
          url: 'https://blog.rust-lang.org/1-99',
          source: 'blog.rust-lang.org',
        },
      ],
    };

    // Writes the scriptFile at the path expected by generateScript.
    const scriptFile = paths(cfg, date, category.id).scriptFile;
    ensureDir(path.dirname(scriptFile));
    fs.writeFileSync(scriptFile, JSON.stringify(expected), 'utf8');

    const result = await generateScript({
      category,
      items,
      cfg,
      date,
      mode: 'file',
    });

    expect(result).toEqual(expected);
  });

  it('returns null if items is empty (category skipped)', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-summarize-'));
    tmpDirs.push(cacheDir);
    const cfg = makeConfig(cacheDir);

    const result = await generateScript({
      category,
      items: [],
      cfg,
      date,
      mode: 'file',
    });
    expect(result).toBeNull();
  });

  it('"file" mode without scriptFile: returns null (no network)', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-summarize-'));
    tmpDirs.push(cacheDir);
    const cfg = makeConfig(cacheDir);

    const result = await generateScript({
      category,
      items,
      cfg,
      date,
      mode: 'file',
    });
    expect(result).toBeNull();
  });
});
