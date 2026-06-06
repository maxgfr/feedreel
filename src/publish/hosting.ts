/**
 * TEMPORARY public HTTPS hosting of the final MP4.
 *
 * Why: Instagram (Graph API) does not accept a binary via direct upload — Meta
 * DOWNLOADS the video from a public URL that we provide. We therefore need to
 * briefly expose the MP4 on an HTTPS URL for the duration of publishing, then
 * delete it (`cleanup`). YouTube and TikTok do not need this (direct binary upload).
 *
 * Default provider: Cloudflare R2 (S3-compatible, no egress fees). S3 is optional.
 * The AWS SDK and heavy `fs` are imported LAZILY (lightweight local-first core).
 *
 * The only OUTBOUND network step of the project, alongside publishing itself: strictly
 * isolated and triggered only by the opt-in publish module.
 */
import type { PublishConfig } from '../../config/publish';
import { env } from './env';
import { createLogger } from '../log';

const log = createLogger('publish:hosting');

/**
 * Temporarily hosted video.
 * `cleanup` deletes the remote object (call it as soon as publishing is done).
 */
export interface HostedFile {
  /** Public HTTPS URL of the MP4 (Meta downloads from here). */
  url: string;
  /** Deletes the remote object. Idempotent on the caller side (call it in `finally`). */
  cleanup: () => Promise<void>;
}

/** Resolved R2 credentials/settings (Cloudflare R2 provider). */
interface R2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

/** Resolved S3 credentials/settings (AWS S3 provider). */
interface S3Settings {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

/**
 * Builds the object key (remote path) — PURE and deterministic.
 * Example: objectKeyFor("2026-06-06", "ai", "ai.mp4") → "feedreel/2026-06-06/ai/ai.mp4".
 *
 * The `feedreel/` prefix groups our objects together; date + category prevent any collision
 * between videos of the same day or of different days.
 */
export function objectKeyFor(date: string, category: string, fileName: string): string {
  return `feedreel/${date}/${category}/${fileName}`;
}

/**
 * True if hosting is configured for the chosen provider (secrets + bucket +
 * public URL present). Otherwise, the orchestrator SKIPS Instagram (not an error).
 *
 * - r2: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *       AND (publish.hosting.bucket || R2_BUCKET)
 *       AND (publish.hosting.publicBaseUrl || R2_PUBLIC_BASE_URL).
 * - s3: S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *       AND (publish.hosting.bucket || S3_BUCKET)
 *       AND (publish.hosting.publicBaseUrl || S3_PUBLIC_BASE_URL).
 */
export function isHostingConfigured(publish: PublishConfig): boolean {
  if (publish.hosting.provider === 's3') {
    return resolveS3(publish) !== undefined;
  }
  return resolveR2(publish) !== undefined;
}

/**
 * Uploads the MP4 and returns its public URL + a deletion function.
 *
 * LAZY import of `@aws-sdk/client-s3`. R2 uses the same S3 client with a
 * Cloudflare endpoint and `region: "auto"`. Throws a clear error if the config is
 * incomplete (callers: test `isHostingConfigured` beforehand).
 */
export async function uploadPublic(args: {
  videoPath: string;
  date: string;
  category: string;
  publish: PublishConfig;
}): Promise<HostedFile> {
  const { videoPath, date, category, publish } = args;
  const fileName = baseName(videoPath);
  const key = objectKeyFor(date, category, fileName);

  // Lazy import: these dependencies only come into play DURING a publication.
  const { S3Client, PutObjectCommand, DeleteObjectCommand } = await import(
    '@aws-sdk/client-s3'
  );
  const fs = await import('node:fs');

  const provider = publish.hosting.provider;
  let client: InstanceType<typeof S3Client>;
  let bucket: string;
  let publicBaseUrl: string;

  if (provider === 's3') {
    const s = resolveS3(publish);
    if (!s) {
      throw new Error(
        'S3 hosting not configured (missing S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / bucket / publicBaseUrl).',
      );
    }
    client = new S3Client({
      region: s.region,
      credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    });
    bucket = s.bucket;
    publicBaseUrl = s.publicBaseUrl;
  } else {
    const r = resolveR2(publish);
    if (!r) {
      throw new Error(
        'R2 hosting not configured (missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / bucket / publicBaseUrl).',
      );
    }
    client = new S3Client({
      endpoint: `https://${r.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      credentials: { accessKeyId: r.accessKeyId, secretAccessKey: r.secretAccessKey },
    });
    bucket = r.bucket;
    publicBaseUrl = r.publicBaseUrl;
  }

  const body = fs.readFileSync(videoPath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'video/mp4',
    }),
  );

  const url = `${trimTrailingSlash(publicBaseUrl)}/${key}`;
  log.info(`MP4 hosted temporarily (${provider}) → ${url}`);

  const cleanup = async (): Promise<void> => {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      log.info(`Hosted object deleted: ${key}`);
    } catch (e) {
      // Deletion must never doom a successful publication.
      log.warn(`Failed to delete hosted object "${key}": ${String(e)}`);
    }
  };

  return { url, cleanup };
}

/** Resolves R2 settings (or `undefined` if incomplete). */
function resolveR2(publish: PublishConfig): R2Settings | undefined {
  const accountId = env('R2_ACCOUNT_ID');
  const accessKeyId = env('R2_ACCESS_KEY_ID');
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
  const bucket = nonEmpty(publish.hosting.bucket) ?? env('R2_BUCKET');
  const publicBaseUrl = nonEmpty(publish.hosting.publicBaseUrl) ?? env('R2_PUBLIC_BASE_URL');

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return undefined;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

/** Resolves S3 settings (or `undefined` if incomplete). */
function resolveS3(publish: PublishConfig): S3Settings | undefined {
  const region = env('S3_REGION');
  const accessKeyId = env('S3_ACCESS_KEY_ID');
  const secretAccessKey = env('S3_SECRET_ACCESS_KEY');
  const bucket = nonEmpty(publish.hosting.bucket) ?? env('S3_BUCKET');
  const publicBaseUrl = nonEmpty(publish.hosting.publicBaseUrl) ?? env('S3_PUBLIC_BASE_URL');

  if (!region || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return undefined;
  }
  return { region, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

/** Returns the value if non-empty (after trim), otherwise `undefined`. */
function nonEmpty(value: string): string | undefined {
  return value.trim() !== '' ? value : undefined;
}

/** Strips a possible trailing `/` (to concatenate cleanly with the key). */
function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/** Last segment of a path (file name), tolerant of `/` and `\` separators. */
function baseName(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  const last = segments[segments.length - 1];
  return last !== undefined && last !== '' ? last : filePath;
}
