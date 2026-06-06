/**
 * Tests for loading config/publish.yaml — WITHOUT network.
 *
 * Covers:
 *  - loadPublishConfig with an ABSENT file (FEEDREEL_PUBLISH_CONFIG points to
 *    a nonexistent path) => expected default values.
 *  - loadPublishConfig with a PRESENT file (temporary YAML written to disk)
 *    => overrides are honored.
 *
 * The internal cache is reset between each case via resetPublishConfigCache().
 * The FEEDREEL_PUBLISH_CONFIG environment variable is saved then restored
 * in afterEach so as not to pollute the other tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPublishConfig, resetPublishConfigCache } from './publish';

/** Original value of FEEDREEL_PUBLISH_CONFIG (undefined = not set). */
let savedEnv: string | undefined;

/** Temporary directories created, removed at the end of the test. */
const tmpDirs: string[] = [];

beforeEach(() => {
  savedEnv = process.env.FEEDREEL_PUBLISH_CONFIG;
  resetPublishConfigCache();
});

afterEach(() => {
  // Restore the environment.
  if (savedEnv === undefined) delete process.env.FEEDREEL_PUBLISH_CONFIG;
  else process.env.FEEDREEL_PUBLISH_CONFIG = savedEnv;
  // Clean up the temporary files.
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Avoid leaving a polluted cache for the other suites.
  resetPublishConfigCache();
});

describe('loadPublishConfig', () => {
  it('(1) absent file => applies default values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-publish-cfg-'));
    tmpDirs.push(dir);
    // Intentionally nonexistent path.
    process.env.FEEDREEL_PUBLISH_CONFIG = path.join(dir, 'absent.yaml');
    resetPublishConfigCache();

    const cfg = loadPublishConfig();

    expect(cfg.enabled).toBe(false);
    expect(cfg.defaultPrivacy).toBe('private');
    expect(cfg.captions.mode).toBe('auto');
    expect(cfg.platforms.youtube.enabled).toBe(true);
    expect(cfg.platforms.youtube.categoryId).toBe('28');
    expect(cfg.platforms.tiktok.mode).toBe('inbox');
    expect(cfg.hosting.provider).toBe('r2');
    expect(cfg.i18n).toEqual({});
  });

  it('(2) present file => overrides are honored', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedreel-publish-cfg-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'publish.yaml');
    fs.writeFileSync(
      file,
      ['enabled: true', 'defaultPrivacy: public', ''].join('\n'),
      'utf8',
    );
    process.env.FEEDREEL_PUBLISH_CONFIG = file;
    resetPublishConfigCache();

    const cfg = loadPublishConfig();

    // Explicit overrides.
    expect(cfg.enabled).toBe(true);
    expect(cfg.defaultPrivacy).toBe('public');
    // The other fields keep their default values.
    expect(cfg.platforms.youtube.enabled).toBe(true);
    expect(cfg.platforms.youtube.categoryId).toBe('28');
    expect(cfg.platforms.tiktok.mode).toBe('inbox');
    expect(cfg.hosting.provider).toBe('r2');
    expect(cfg.captions.mode).toBe('auto');
    expect(cfg.i18n).toEqual({});
  });
});
