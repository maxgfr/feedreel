/**
 * TikTok adapter (Content Posting API) — src/publish/.
 *
 * Publishes a video via the official TikTok API using native `fetch`, with NO
 * dependencies. Two modes:
 *   - `inbox` (default): drops a DRAFT into the creator's inbox (no app audit
 *     required);
 *   - `direct`: publishes directly (public post; requires a TikTok-side audit).
 *
 * The mode is driven by `publish.platforms.tiktok.mode`. The `direct` privacy
 * level is mapped via `tiktokPrivacy`.
 *
 * No heavy dependency is imported: only `node:fs` (reading the MP4) and the
 * global `fetch` are used, and only outside `dryRun`.
 */
import fs from 'node:fs';
import type { Privacy } from './types';
import type {
  PlatformAdapter,
  PlatformMeta,
  PublishContext,
  PublishResult,
} from './types';
import type { PublishConfig } from '../../config/publish';
import { resolveTikTokToken, tiktokHasAuth } from './tokens';
import { truncate } from '../util';
import { createLogger } from '../log';

const log = createLogger('publish:tiktok');

/** Character limit for a TikTok caption (title + hashtags). */
const TIKTOK_CAPTION_MAX = 2200;

/** Chunking threshold: above 64 MB, the upload is split into several chunks. */
const SINGLE_CHUNK_LIMIT = 64 * 1024 * 1024;

/** Chunk size for large files (10 MB). */
const MULTI_CHUNK_SIZE = 10 * 1024 * 1024;

/** Initialization endpoint for `inbox` mode (draft, no audit). */
const INIT_INBOX_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';

/** Initialization endpoint for `direct` mode (public post). */
const INIT_DIRECT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';

/**
 * Builds the TikTok caption: title followed by hashtags separated by spaces,
 * truncated to 2200 characters. PURE (no side effects).
 */
export function buildTikTokCaption(meta: PlatformMeta): string {
  const caption = [meta.title, ...meta.hashtags].join(' ');
  return truncate(caption, TIKTOK_CAPTION_MAX);
}

/**
 * Maps the internal privacy level to the level expected by the TikTok API.
 * PURE: `public` → "PUBLIC_TO_EVERYONE"; otherwise → "SELF_ONLY".
 */
export function tiktokPrivacy(p: Privacy): string {
  return p === 'public' ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY';
}

/**
 * Computes the chunking plan for a file for the TikTok upload. PURE.
 *   - file ≤ 64 MB (or empty): a single chunk;
 *   - otherwise: 10 MB chunks, with the last one possibly smaller.
 */
export function chunkPlan(fileSize: number): {
  chunkSize: number;
  totalChunkCount: number;
} {
  if (fileSize <= SINGLE_CHUNK_LIMIT) {
    return { chunkSize: fileSize, totalChunkCount: 1 };
  }
  const totalChunkCount = Math.ceil(fileSize / MULTI_CHUNK_SIZE);
  return { chunkSize: MULTI_CHUNK_SIZE, totalChunkCount };
}

/** Expected shape of the TikTok init response (useful fields). */
interface TikTokInitResponse {
  data?: {
    publish_id?: string;
    upload_url?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * TikTok adapter. Configured if the platform is enabled and the access token
 * (with per-language fallback) is present.
 */
export const tiktokAdapter: PlatformAdapter = {
  id: 'tiktok',

  isConfigured(language: string, publish: PublishConfig): boolean {
    // Configured if a static token OR refresh credentials are present.
    return publish.platforms.tiktok.enabled && tiktokHasAuth(language);
  },

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const base: Pick<PublishResult, 'platform' | 'category'> = {
      platform: 'tiktok',
      category: ctx.category.id,
    };

    // In `dryRun`, no network call: we simply report the intent.
    if (ctx.dryRun) {
      log.info(`dry-run: no TikTok publication for ${ctx.category.id}`);
      return { ...base, status: 'dry-run' };
    }

    try {
      // Fresh token (auto refresh if configured, otherwise static token from .env).
      const token = await resolveTikTokToken(ctx.cfg, ctx.language);
      if (token === undefined) {
        return {
          ...base,
          status: 'error',
          error: 'No TikTok token available for language ' + ctx.language,
        };
      }

      // Read the final MP4 and compute the chunking plan.
      const fileBuffer = fs.readFileSync(ctx.videoPath);
      const videoSize = fileBuffer.length;
      const plan = chunkPlan(videoSize);

      const direct = ctx.publish.platforms.tiktok.mode === 'direct';
      const initUrl = direct ? INIT_DIRECT_URL : INIT_INBOX_URL;

      // Init body: `post_info` is only needed in direct mode, but we always
      // send it (the inbox API ignores it gracefully).
      const body = {
        post_info: {
          title: buildTikTokCaption(ctx.meta),
          privacy_level: tiktokPrivacy(ctx.privacy),
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunkCount,
        },
      };

      const initRes = await fetch(initUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!initRes.ok) {
        const text = await initRes.text();
        return {
          ...base,
          status: 'error',
          error: `TikTok init HTTP ${initRes.status}: ${text}`,
        };
      }

      const initJson = (await initRes.json()) as TikTokInitResponse;
      const uploadUrl = initJson.data?.upload_url;
      const publishId = initJson.data?.publish_id;
      if (uploadUrl === undefined || publishId === undefined) {
        const errMsg = initJson.error?.message ?? 'incomplete response';
        return {
          ...base,
          status: 'error',
          error: `TikTok init without upload_url/publish_id: ${errMsg}`,
        };
      }

      // Sequential upload of the chunks via PUT to `upload_url`.
      for (let index = 0; index < plan.totalChunkCount; index += 1) {
        const start = index * plan.chunkSize;
        const end = Math.min(start + plan.chunkSize, videoSize) - 1;
        const chunk = fileBuffer.subarray(start, end + 1);
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${videoSize}`,
            'Content-Type': 'video/mp4',
          },
          body: chunk,
        });
        if (!uploadRes.ok) {
          const text = await uploadRes.text();
          return {
            ...base,
            status: 'error',
            error: `TikTok upload chunk ${index + 1}/${plan.totalChunkCount} HTTP ${uploadRes.status}: ${text}`,
          };
        }
      }

      log.info(
        `TikTok video uploaded (${direct ? 'direct' : 'inbox'}) for ${ctx.category.id}: ${publishId}`,
      );
      return { ...base, status: 'ok', videoId: publishId, url: '' };
    } catch (e) {
      return { ...base, status: 'error', error: String(e) };
    }
  },
};
