/**
 * Remotion video rendering + audio muxing (the final stage of the pipeline).
 *
 * Two responsibilities:
 *  - `bundleRemotion`: bundles the Remotion project ONCE (module-level cache)
 *    and returns the `serveUrl` reusable across all renders of the run.
 *  - `renderVideo`: selects the `FeedReelVideo` composition, renders an H.264 video
 *    WITHOUT audio to a temporary file, then muxes the AAC audio track via ffmpeg
 *    (conditional muxing: if audio is absent, the silent video is simply copied).
 */

import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia, openBrowser } from '@remotion/renderer';
import type { GlobalConfig, VideoScript } from '../types';
import { paths } from '../../config/index';
import { ensureDir } from '../util';
import { execOrThrow } from '../exec';
import { log } from '../log';

const logger = log.child('render');

/** Bundle promise shared across all calls (a single bundle per process). */
let bundlePromise: Promise<string> | null = null;

/** Headless Chromium instance shared across all renders of the run. */
type Browser = Awaited<ReturnType<typeof openBrowser>>;
let browserPromise: Promise<Browser> | null = null;

/**
 * Bundles the Remotion project and returns the `serveUrl`.
 * The bundle is cached at module level: the first call builds it,
 * subsequent ones reuse the same promise (hence the same serveUrl).
 * On FAILURE, the cache is reset so that a later call can retry
 * (otherwise a single transient failure would doom the whole run).
 */
export async function bundleRemotion(cfg: GlobalConfig): Promise<string> {
  if (bundlePromise === null) {
    bundlePromise = bundle({
      entryPoint: path.join(cfg.projectRoot, 'src/remotion/index.ts'),
      publicDir: path.join(cfg.projectRoot, 'public'),
    }).catch((e) => {
      bundlePromise = null;
      throw e;
    });
  }
  return bundlePromise;
}

/**
 * Returns a shared headless Chromium instance (opened once per process).
 * Reset if opening fails, to allow a retry.
 */
async function getBrowser(): Promise<Browser> {
  if (browserPromise === null) {
    browserPromise = openBrowser('chrome').catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

/** Closes the shared Chromium instance (call at the end of the run, idempotent). */
export async function closeBrowser(): Promise<void> {
  if (browserPromise === null) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close({ silent: true });
  } catch {
    /* already closed or never opened: ignored. */
  }
}

/**
 * Renders the video and returns the path to the final MP4.
 *
 * Steps:
 *  1. bundle (cached) → serveUrl
 *  2. `selectComposition` id `FeedReelVideo` with the script as `inputProps`
 *  3. `renderMedia` H.264 WITHOUT audio (`muted`) to a temporary file
 *  4. ffmpeg muxing: copy video + encode AAC audio to `outputFile`
 *     (conditional: if audio is absent, the silent video is simply remuxed).
 */
export async function renderVideo(args: {
  script: VideoScript;
  cfg: GlobalConfig;
  date: string;
}): Promise<string> {
  const { script, cfg, date } = args;
  const p = paths(cfg, date);

  // `inputProps` expects a Record<string, unknown>: the VideoScript is a flat serializable object.
  const inputProps = script as unknown as Record<string, unknown>;

  const serveUrl = await bundleRemotion(cfg);
  const browser = await getBrowser();
  logger.info('Bundle ready, selecting the FeedReelVideo composition.');

  const composition = await selectComposition({
    serveUrl,
    id: 'FeedReelVideo',
    inputProps,
    puppeteerInstance: browser,
  });

  // Temporary silent video next to the cached audio.
  const silentVideo = path.join(cfg.cacheDir, 'audio', `${date}-silent.mp4`);
  ensureDir(path.dirname(silentVideo));

  try {
    logger.info(`Rendering silent video → ${silentVideo}`);
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: silentVideo,
      inputProps,
      muted: true,
      concurrency: 2,
      puppeteerInstance: browser,
    });

    ensureDir(p.outputDir);

    const hasAudio =
      typeof script.audioFile === 'string' &&
      script.audioFile.length > 0 &&
      fs.existsSync(script.audioFile);

    if (hasAudio) {
      // Muxing: video copied as-is + audio track re-encoded to AAC.
      logger.info(`Muxing AAC audio → ${p.outputFile}`);
      await execOrThrow('ffmpeg', [
        '-y',
        '-i',
        silentVideo,
        '-i',
        script.audioFile,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        p.outputFile,
      ]);
    } else {
      // No audio: simply remux the silent video to the final output.
      logger.warn(`Audio missing, output without audio track → ${p.outputFile}`);
      await execOrThrow('ffmpeg', ['-y', '-i', silentVideo, '-c:v', 'copy', p.outputFile]);
    }
  } finally {
    // Clean up the silent intermediate (avoids disk accumulation).
    fs.rmSync(silentVideo, { force: true });
  }

  return p.outputFile;
}
