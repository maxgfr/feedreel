import { describe, expect, it } from 'vitest';
import { parseScriptJson, buildCaption } from './script';
import type { VideoScriptInput } from '../types';

const validScript: VideoScriptInput = {
  date: '2026-06-06',
  title: 'Title',
  description: 'A short caption.',
  hashtags: ['#football', '#news'],
  segments: [
    { type: 'intro', hook: 'The big stories today.' },
    {
      type: 'item',
      headline: 'Late winner',
      body: 'A stoppage-time goal.',
      url: 'https://bbc.co.uk/a',
      source: 'bbc.co.uk',
    },
  ],
};

describe('parseScriptJson', () => {
  it('parses a valid script object', () => {
    const parsed = parseScriptJson(JSON.stringify(validScript));
    expect(parsed.title).toBe('Title');
    expect(parsed.segments).toHaveLength(2);
  });

  it('tolerates markdown fences and surrounding text', () => {
    const raw = 'Here you go:\n```json\n' + JSON.stringify(validScript) + '\n```\nDone.';
    const parsed = parseScriptJson(raw);
    expect(parsed.hashtags).toEqual(['#football', '#news']);
  });

  it('rejects empty input', () => {
    expect(() => parseScriptJson('   ')).toThrow();
  });

  it('rejects JSON that does not match the schema', () => {
    // Missing `title`.
    const bad = JSON.stringify({ date: '2026-06-06', description: '', hashtags: [], segments: [] });
    expect(() => parseScriptJson(bad)).toThrow();
  });

  it('rejects an unknown segment type', () => {
    const bad = JSON.stringify({
      ...validScript,
      segments: [{ type: 'outro', hook: 'no' }],
    });
    expect(() => parseScriptJson(bad)).toThrow();
  });
});

describe('buildCaption', () => {
  it('assembles title, description, hashtags and sources', () => {
    const caption = buildCaption(validScript);
    expect(caption).toContain('Title');
    expect(caption).toContain('A short caption.');
    expect(caption).toContain('#football #news');
    expect(caption).toContain('Sources:');
    expect(caption).toContain('- bbc.co.uk : https://bbc.co.uk/a');
    expect(caption.endsWith('\n')).toBe(true);
  });

  it('omits empty sections (no hashtags, no sources)', () => {
    const caption = buildCaption({
      date: '2026-06-06',
      title: 'T',
      description: 'D',
      hashtags: [],
      segments: [{ type: 'intro', hook: 'hi' }],
    });
    expect(caption).toBe('T\n\nD\n');
  });
});
