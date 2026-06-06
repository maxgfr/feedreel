/**
 * Tests for the captions module — WITHOUT network or `claude` call.
 *
 * Covers:
 *   - VideoMetaSchema: accepts a valid object / rejects an invalid object;
 *   - parseCaptionsJson: truncation of title>100 and description>5000, clamp >15
 *     hashtags, adding the missing `#`, ignoring a non-requested platform;
 *   - buildCaptionsPrompt: contains language.name (FR and EN) and only mentions
 *     the requested platforms;
 *   - generateCaptions: "file" mode without a file => null (no network).
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  CategoryConfig,
  GlobalConfig,
  LanguageConfig,
  VideoScriptInput,
} from '../types';
import type { PlatformId } from './types';
import type { PublishConfig } from '../../config/publish';
import {
  PLATFORM_LIMITS,
  VideoMetaSchema,
  buildCaptionsPrompt,
  parseCaptionsJson,
  generateCaptions,
} from './captions';

/** Fake category (no network I/O). */
const category: CategoryConfig = {
  id: 'rust',
  label: 'Rust',
  emoji: '🦀',
  accentColor: '#ff7043',
  maxItems: 5,
  feeds: ['https://example.test/feed.xml'],
};

/** Test languages (FR by default + EN). */
const langFr: LanguageConfig = {
  code: 'fr',
  name: 'français',
  uiLabel: 'VEILLE',
  dateLocale: 'fr-FR',
  tts: { engine: 'kokoro', voice: 'ff_siwis' },
};
const langEn: LanguageConfig = {
  code: 'en',
  name: 'English',
  uiLabel: 'TECH WATCH',
  dateLocale: 'en-US',
  tts: { engine: 'kokoro', voice: 'af_heart' },
};

const date = '2026-06-05';

/** Minimal video script for the prompt context. */
const script: VideoScriptInput = {
  category: 'rust',
  date,
  title: "Today's Rust news",
  segments: [
    { type: 'intro', narration: "Here's what's on the agenda today." },
    {
      type: 'item',
      headline: 'Rust 1.99',
      body: 'Stable async traits.',
      narration: 'Rust 1.99 stabilizes async traits.',
      url: 'https://blog.rust-lang.org/1-99',
      source: 'blog.rust-lang.org',
    },
  ],
};

/** Minimal PublishConfig (no i18n override by default). */
function makePublish(i18n: PublishConfig['i18n'] = {}): PublishConfig {
  return {
    enabled: false,
    defaultPrivacy: 'private',
    captions: { mode: 'auto' },
    platforms: {
      youtube: { enabled: true, categoryId: '28' },
      tiktok: { enabled: true, mode: 'inbox' },
      instagram: { enabled: true },
    },
    hosting: { provider: 'r2', bucket: '', publicBaseUrl: '' },
    i18n,
  };
}

/** Minimal GlobalConfig pointing at a temporary cacheDir. */
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
    languages: { fr: langFr, en: langEn },
    audio: {
      mode: 'music',
      music: { dir: 'assets/music', fadeSec: 1.5, volume: 1 },
      scene: { introSec: 3, itemSec: 4 },
    },
  };
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('VideoMetaSchema', () => {
  it('accepts a valid object', () => {
    const r = VideoMetaSchema.safeParse({
      language: 'fr',
      youtube: { title: 'Titre', description: 'Desc', hashtags: ['#rust'] },
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid object (empty title)', () => {
    const r = VideoMetaSchema.safeParse({
      language: 'fr',
      youtube: { title: '', description: 'Desc', hashtags: [] },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid object (missing language)', () => {
    const r = VideoMetaSchema.safeParse({
      youtube: { title: 'T', description: 'D', hashtags: [] },
    });
    expect(r.success).toBe(false);
  });
});

describe('parseCaptionsJson', () => {
  it('truncates a title > 100 and a description > 5000 (YouTube)', () => {
    const longTitle = 'A'.repeat(250);
    const longDesc = 'B'.repeat(6000);
    const raw = JSON.stringify({
      language: 'fr',
      youtube: { title: longTitle, description: longDesc, hashtags: ['#rust'] },
    });

    const meta = parseCaptionsJson(raw, ['youtube'], 'fr');
    expect(meta.youtube).toBeDefined();
    // util.truncate keeps at most `max` characters of content then appends an
    // ellipsis character "…": so we tolerate max + 1 and check the ellipsis.
    expect(meta.youtube!.title.length).toBeLessThanOrEqual(
      PLATFORM_LIMITS.youtube.title + 1,
    );
    expect(meta.youtube!.title.endsWith('…')).toBe(true);
    expect(meta.youtube!.description.length).toBeLessThanOrEqual(
      PLATFORM_LIMITS.youtube.caption + 1,
    );
    expect(meta.youtube!.description.endsWith('…')).toBe(true);
  });

  it('clamps > 15 hashtags and adds the missing # (YouTube)', () => {
    // 20 hashtags, some without #.
    const tags = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? `tag${i}` : `#tag${i}`,
    );
    const raw = JSON.stringify({
      language: 'fr',
      youtube: { title: 'T', description: 'D', hashtags: tags },
    });

    const meta = parseCaptionsJson(raw, ['youtube'], 'fr');
    const yt = meta.youtube!;
    // Clamp to the YouTube maximum.
    expect(yt.hashtags.length).toBeLessThanOrEqual(
      PLATFORM_LIMITS.youtube.maxHashtags,
    );
    // All prefixed with #.
    for (const tag of yt.hashtags) {
      expect(tag.startsWith('#')).toBe(true);
      expect(tag).not.toMatch(/\s/);
    }
    // #Shorts guaranteed for YouTube.
    expect(yt.hashtags).toContain('#Shorts');
  });

  it('deduplicates hashtags (case-insensitive)', () => {
    const raw = JSON.stringify({
      language: 'fr',
      tiktok: {
        title: 'T',
        description: 'D',
        hashtags: ['#rust', '#Rust', 'rust', '#tech'],
      },
    });
    const meta = parseCaptionsJson(raw, ['tiktok'], 'fr');
    const lower = meta.tiktok!.hashtags.map((t) => t.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('ignores a non-requested platform', () => {
    const raw = JSON.stringify({
      language: 'fr',
      youtube: { title: 'T', description: 'D', hashtags: ['#rust'] },
      tiktok: { title: 'T2', description: 'D2', hashtags: ['#rust'] },
    });
    // We only request youtube: tiktok must be absent from the result.
    const meta = parseCaptionsJson(raw, ['youtube'], 'fr');
    expect(meta.youtube).toBeDefined();
    expect(meta.tiktok).toBeUndefined();
  });

  it('forces the provided language field', () => {
    const raw = JSON.stringify({
      language: 'xx',
      instagram: { title: 'T', description: 'D', hashtags: ['#rust'] },
    });
    const meta = parseCaptionsJson(raw, ['instagram'], 'en');
    expect(meta.language).toBe('en');
  });

  it('tolerates markdown fences and stray text', () => {
    const obj = {
      language: 'fr',
      youtube: { title: 'T', description: 'D', hashtags: ['#rust'] },
    };
    const raw = ['Here:', '```json', JSON.stringify(obj), '```', 'end.'].join('\n');
    const meta = parseCaptionsJson(raw, ['youtube'], 'fr');
    expect(meta.youtube?.title).toBe('T');
  });

  it('throws if no JSON object is detected', () => {
    expect(() => parseCaptionsJson('aucun json', ['youtube'], 'fr')).toThrow();
  });

  it('throws if the schema is violated (missing hashtags)', () => {
    const raw = JSON.stringify({
      language: 'fr',
      youtube: { title: 'T', description: 'D' },
    });
    expect(() => parseCaptionsJson(raw, ['youtube'], 'fr')).toThrow();
  });
});

describe('buildCaptionsPrompt', () => {
  const platforms: PlatformId[] = ['youtube', 'tiktok'];

  it('contains language.name in FR', () => {
    const prompt = buildCaptionsPrompt({
      category,
      script,
      date,
      language: langFr,
      platforms,
      publish: makePublish(),
    });
    expect(prompt).toContain('français');
    expect(prompt).toContain('STRICT JSON');
    expect(prompt).toContain(script.title);
    expect(prompt).toContain('#Shorts');
  });

  it('contains language.name in EN', () => {
    const prompt = buildCaptionsPrompt({
      category,
      script,
      date,
      language: langEn,
      platforms,
      publish: makePublish(),
    });
    expect(prompt).toContain('English');
  });

  it('only mentions the requested platforms', () => {
    const prompt = buildCaptionsPrompt({
      category,
      script,
      date,
      language: langFr,
      platforms: ['youtube'],
      publish: makePublish(),
    });
    expect(prompt).toContain('"youtube"');
    expect(prompt).not.toContain('"tiktok"');
    expect(prompt).not.toContain('"instagram"');
  });

  it('includes the i18n baseHashtags when configured', () => {
    const prompt = buildCaptionsPrompt({
      category,
      script,
      date,
      language: langFr,
      platforms,
      publish: makePublish({ fr: { baseHashtags: ['#technews', '#tech'] } }),
    });
    expect(prompt).toContain('#technews');
    expect(prompt).toContain('#tech');
  });

  it('includes the source links as context', () => {
    const prompt = buildCaptionsPrompt({
      category,
      script,
      date,
      language: langFr,
      platforms,
      publish: makePublish(),
    });
    expect(prompt).toContain('https://blog.rust-lang.org/1-99');
  });
});

describe('generateCaptions', () => {
  it('"file" mode without metadataFile: returns null (no network)', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-captions-'));
    tmpDirs.push(cacheDir);
    const cfg = makeConfig(cacheDir);

    const result = await generateCaptions({
      script,
      category,
      cfg,
      publish: makePublish(),
      date,
      mode: 'file',
      platforms: ['youtube', 'tiktok'],
    });
    expect(result).toBeNull();
  });

  it('returns null if no platform is requested', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-captions-'));
    tmpDirs.push(cacheDir);
    const cfg = makeConfig(cacheDir);

    const result = await generateCaptions({
      script,
      category,
      cfg,
      publish: makePublish(),
      date,
      mode: 'auto',
      platforms: [],
    });
    expect(result).toBeNull();
  });
});
