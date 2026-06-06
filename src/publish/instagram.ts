/**
 * Instagram Reels adapter via the Graph API (Meta).
 *
 * Two-step publishing + temporary public hosting:
 *   1. Host the video on a public HTTPS URL (R2/S3 via `./hosting`).
 *   2. POST /{ig-user}/media (media_type=REELS, video_url) → a `creation_id`.
 *   3. Poll GET /{creation_id}?fields=status_code until `FINISHED`.
 *   4. POST /{ig-user}/media_publish (creation_id) → published media id.
 *   5. Clean up the temporary hosting (always, via `finally`).
 *
 * Native `fetch` (Node 20+). The access token is NEVER logged.
 * Honors `ctx.dryRun`: no network call, returns the `dry-run` status.
 */
import type {
  PlatformAdapter,
  PlatformMeta,
  PublishContext,
  PublishResult,
} from './types';
import type { PublishConfig } from '../../config/publish';
import { loadEnv, credForLang, hasCreds } from './env';
import { resolveInstagramToken } from './tokens';
import { isHostingConfigured, uploadPublic } from './hosting';
import { truncate } from '../util';
import { createLogger } from '../log';

const log = createLogger('publish:instagram');

/** Meta Graph API base (pinned version). */
const GRAPH = 'https://graph.facebook.com/v21.0';

/** Instagram caption limit (characters). */
const CAPTION_MAX = 2200;

/** Maximum number of hashtags accepted by Instagram. */
const HASHTAGS_MAX = 30;

/** Maximum number of status polls before giving up. */
const POLL_MAX = 30;

/** Delay between two status polls (ms). */
const POLL_INTERVAL_MS = 3000;

/** Small async pause (without `setInterval`). */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds the Instagram caption (PURE FUNCTION).
 *
 * Format: title + double line break + description + double line break +
 * hashtags (capped at 30, joined by a space). The whole thing is cleanly
 * truncated to 2200 characters.
 */
export function buildInstagramCaption(meta: PlatformMeta): string {
  const tags = meta.hashtags.slice(0, HASHTAGS_MAX).join(' ');
  const caption = `${meta.title}\n\n${meta.description}\n\n${tags}`;
  return truncate(caption, CAPTION_MAX);
}

/** Instagram Reels adapter. */
export const instagramAdapter: PlatformAdapter = {
  id: 'instagram',

  isConfigured(language: string, publish: PublishConfig): boolean {
    return (
      publish.platforms.instagram.enabled &&
      hasCreds(['IG_USER_ID', 'IG_ACCESS_TOKEN'], language) &&
      isHostingConfigured(publish)
    );
  },

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const base: Pick<PublishResult, 'platform' | 'category'> = {
      platform: 'instagram',
      category: ctx.category.id,
    };

    // Simulation mode: no network call.
    if (ctx.dryRun) {
      log.info(`dry-run — Instagram Reel for ${ctx.category.id} not published.`);
      return { ...base, status: 'dry-run' };
    }

    await loadEnv();
    const igUser = credForLang('IG_USER_ID', ctx.language);
    // Long-lived token refreshed automatically if FB_APP_ID/SECRET are provided,
    // otherwise the static IG_ACCESS_TOKEN (~60 days, to renew by hand).
    const token = await resolveInstagramToken(ctx.cfg, ctx.language);
    if (!igUser || !token) {
      return {
        ...base,
        status: 'error',
        error: 'Missing Instagram credentials (IG_USER_ID / IG_ACCESS_TOKEN).',
      };
    }

    // Host the video on a temporary public URL (required by the Graph API).
    const hosted = await uploadPublic({
      videoPath: ctx.videoPath,
      date: ctx.date,
      category: ctx.category.id,
      publish: ctx.publish,
    });

    try {
      const caption = buildInstagramCaption(ctx.meta);

      // 1) Create the media container (REELS) from the hosted URL.
      const createParams = new URLSearchParams({
        media_type: 'REELS',
        video_url: hosted.url,
        caption,
        access_token: token,
      });
      const createRes = await fetch(`${GRAPH}/${igUser}/media`, {
        method: 'POST',
        body: createParams,
      });
      const created = (await createRes.json()) as {
        id?: string;
        error?: { message?: string };
      };
      if (!createRes.ok || !created.id) {
        const reason = created.error?.message ?? `HTTP ${createRes.status}`;
        return { ...base, status: 'error', error: `Container creation failed: ${reason}` };
      }
      const creationId = created.id;

      // 2) Poll the encoding status until FINISHED (or bounded give-up).
      let finished = false;
      for (let attempt = 0; attempt < POLL_MAX; attempt++) {
        const statusParams = new URLSearchParams({
          fields: 'status_code',
          access_token: token,
        });
        const statusRes = await fetch(`${GRAPH}/${creationId}?${statusParams.toString()}`);
        const status = (await statusRes.json()) as {
          status_code?: string;
          error?: { message?: string };
        };
        if (status.status_code === 'FINISHED') {
          finished = true;
          break;
        }
        if (status.status_code === 'ERROR') {
          const reason = status.error?.message ?? 'encoding error';
          return { ...base, status: 'error', error: `Instagram encoding failed: ${reason}` };
        }
        await pause(POLL_INTERVAL_MS);
      }
      if (!finished) {
        return {
          ...base,
          status: 'error',
          error: `Container not ready after ${POLL_MAX} polls.`,
        };
      }

      // 3) Actually publish the container.
      const publishParams = new URLSearchParams({
        creation_id: creationId,
        access_token: token,
      });
      const publishRes = await fetch(`${GRAPH}/${igUser}/media_publish`, {
        method: 'POST',
        body: publishParams,
      });
      const published = (await publishRes.json()) as {
        id?: string;
        error?: { message?: string };
      };
      if (!publishRes.ok || !published.id) {
        const reason = published.error?.message ?? `HTTP ${publishRes.status}`;
        return { ...base, status: 'error', error: `Publishing failed: ${reason}` };
      }

      const mediaId = published.id;
      log.info(`Reel published for ${ctx.category.id} (id ${mediaId}).`);
      return {
        ...base,
        status: 'ok',
        videoId: mediaId,
        url: `https://www.instagram.com/reel/${mediaId}`,
      };
    } catch (e) {
      return { ...base, status: 'error', error: String(e) };
    } finally {
      // Clean up the temporary hosting, no matter what.
      await hosted.cleanup();
    }
  },
};
