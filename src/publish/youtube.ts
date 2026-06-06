/**
 * YouTube Shorts adapter (Data API v3 — `videos.insert`, resumable upload).
 *
 * Authentication: OAuth2 with a refresh token (no review ever required to
 * publish to your own channel). Cloud SDKs are imported LAZILY inside `publish`
 * to keep the local-first core lightweight and offline.
 *
 * Golden rule: NEVER log tokens or secrets.
 */
import fs from 'node:fs';
import type { PublishConfig } from '../../config/publish';
import type {
  PlatformAdapter,
  PlatformMeta,
  Privacy,
  PublishContext,
  PublishResult,
} from './types';
import { credForLang, hasCreds, loadEnv } from './env';
import { truncate } from '../util';
import { createLogger } from '../log';

const log = createLogger('publish:youtube');

/** YouTube API limits (characters). */
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;
const TAGS_SUM_MAX = 500;

/** Mandatory marker to be treated as a Short. */
const SHORTS_TAG = '#Shorts';

/**
 * Truncates while GUARANTEEING the final result fits within `max` characters.
 *
 * `util.truncate` appends an "…" when it cuts: the result can then be
 * `max + 1` characters long. Since YouTube API limits are strict, we cap at
 * `max - 1` before truncating so the ellipsis stays under the limit.
 */
function capTo(text: string, max: number): string {
  if (text.length <= max) return text;
  return truncate(text, max - 1);
}

/** `videos.insert` request body (`snippet` + `status` parts). */
export interface YouTubeRequestBody {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    defaultLanguage: string;
  };
  status: {
    privacyStatus: Privacy;
    selfDeclaredMadeForKids: boolean;
  };
}

/**
 * Builds the `videos.insert` request body (PURE FUNCTION, no network).
 *
 * - `title`: truncated to 100 characters, GUARANTEEING the presence of
 *   `#Shorts`. We add it to the title if it fits; otherwise it is guaranteed via
 *   the description.
 * - `description`: description + double newline + hashtags (space-separated),
 *   truncated to 5000 characters. If `#Shorts` could not be placed in the title,
 *   it is prefixed to the description so the video stays a Short.
 * - `tags`: derived from the hashtags (without the `#`), capping the SUM of
 *   their lengths at 500 characters (tags that overflow are dropped).
 * - `selfDeclaredMadeForKids`: always `false`.
 */
export function buildYouTubeRequestBody(
  meta: PlatformMeta,
  privacy: Privacy,
  categoryId: string,
  language: string,
): YouTubeRequestBody {
  // 1) Title: we try to fit the #Shorts marker into it.
  const baseTitle = capTo(meta.title, TITLE_MAX);
  const titleWithTag = `${baseTitle} ${SHORTS_TAG}`;
  const shortsInTitle = titleWithTag.length <= TITLE_MAX;
  const title = shortsInTitle ? titleWithTag : baseTitle;

  // 2) Description: description + hashtags. If #Shorts could not go in the
  //    title, we force it at the head of the description (without duplicating).
  const hashtagsLine = meta.hashtags.join(' ');
  const parts: string[] = [];
  if (!shortsInTitle) parts.push(SHORTS_TAG);
  if (meta.description.trim() !== '') parts.push(meta.description);
  const head = parts.join('\n\n');
  const rawDescription =
    hashtagsLine.trim() === '' ? head : `${head}\n\n${hashtagsLine}`;
  const description = capTo(rawDescription, DESCRIPTION_MAX);

  // 3) Tags derived from hashtags (without #), capped by SUM of lengths <= 500.
  const tags: string[] = [];
  let tagsSum = 0;
  for (const h of meta.hashtags) {
    const tag = h.replace(/^#/, '').trim();
    if (tag === '') continue;
    if (tagsSum + tag.length > TAGS_SUM_MAX) continue;
    tags.push(tag);
    tagsSum += tag.length;
  }

  return {
    snippet: {
      title,
      description,
      tags,
      categoryId,
      defaultLanguage: language,
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: false,
    },
  };
}

/** Resolves the YouTube `categoryId` (i18n override takes priority, else default). */
function resolveCategoryId(publish: PublishConfig, language: string): string {
  return (
    publish.i18n[language]?.youtube?.categoryId ?? publish.platforms.youtube.categoryId
  );
}

/** YouTube Shorts adapter. */
export const youtubeAdapter: PlatformAdapter = {
  id: 'youtube',

  isConfigured(language: string, publish: PublishConfig): boolean {
    return (
      publish.platforms.youtube.enabled &&
      hasCreds(['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN'], language)
    );
  },

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const categoryId = resolveCategoryId(ctx.publish, ctx.language);
    const body = buildYouTubeRequestBody(
      ctx.meta,
      ctx.privacy,
      categoryId,
      ctx.language,
    );

    // Simulation mode: NO network, we only log the metadata.
    if (ctx.dryRun) {
      log.info(
        `[dry-run] ${ctx.category.id} (${ctx.language}) → YouTube ` +
          `"${body.snippet.title}" privacy=${body.status.privacyStatus} ` +
          `categoryId=${categoryId} tags=${body.snippet.tags.length}`,
      );
      return { platform: 'youtube', category: ctx.category.id, status: 'dry-run' };
    }

    try {
      await loadEnv();

      // LAZY imports: cloud SDKs are only loaded to publish.
      const { OAuth2Client } = await import('google-auth-library');
      const { youtube } = await import('@googleapis/youtube');

      const auth = new OAuth2Client(
        credForLang('YT_CLIENT_ID', ctx.language),
        credForLang('YT_CLIENT_SECRET', ctx.language),
      );
      auth.setCredentials({
        refresh_token: credForLang('YT_REFRESH_TOKEN', ctx.language),
      });

      // The `auth` cast works around a declaration conflict: @googleapis/youtube
      // bundles its own copy of OAuth2Client via googleapis-common.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = youtube({ version: 'v3', auth: auth as unknown as any });

      log.info(
        `Sending to YouTube: ${ctx.category.id} (${ctx.language}) ` +
          `"${body.snippet.title}" privacy=${body.status.privacyStatus}`,
      );

      const res = await client.videos.insert({
        part: ['snippet', 'status'],
        requestBody: body,
        media: { body: fs.createReadStream(ctx.videoPath) },
      });

      const id = res.data.id ?? undefined;
      if (id === undefined || id === '') {
        return {
          platform: 'youtube',
          category: ctx.category.id,
          status: 'error',
          error: 'YouTube did not return a video id.',
        };
      }

      const url = `https://youtu.be/${id}`;
      log.info(`Published to YouTube: ${ctx.category.id} → ${url}`);
      return {
        platform: 'youtube',
        category: ctx.category.id,
        status: 'ok',
        videoId: id,
        url,
      };
    } catch (e) {
      // We never log tokens: only the raw error message is surfaced.
      return {
        platform: 'youtube',
        category: ctx.category.id,
        status: 'error',
        error: String(e),
      };
    }
  },
};
