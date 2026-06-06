/**
 * Main `FeedReelVideo` composition.
 *
 * Receives a `VideoScript` as props (see src/types.ts) and assembles it:
 *   - procedural background (Background)
 *   - persistent header (Header) + progress bar (ProgressBar)
 *   - a `Series` of scenes: intro, then 1 scene per `item` segment, then the
 *     auto-appended `outro` (subscribe) scene — each lasting `seg.durationFrames`.
 *
 * The total composition duration is derived by `calculateFeedReelMetadata`
 * (sum of `durationFrames`).
 */
import { AbsoluteFill, Series } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import type { RenderedSegment, VideoScript } from '../types';

/**
 * Literal variant of `VideoScript`: an object type (not an interface)
 * satisfies the `Props extends Record<string, unknown>` constraint required by
 * `Composition` / `CalculateMetadataFunction`. Structurally identical.
 */
export type FeedReelProps = { [K in keyof VideoScript]: VideoScript[K] };
import { deriveTheme } from './theme';
import { loadFonts } from './fonts';
import { Background } from './components/Background';
import { Header } from './components/Header';
import { ProgressBar } from './components/ProgressBar';
import { IntroScene } from './scenes/IntroScene';
import { ItemScene } from './scenes/ItemScene';
import { OutroScene } from './scenes/OutroScene';

/** Minimum segment duration, in frames (safety net against 0/NaN). */
const MIN_SEGMENT_FRAMES = 1;

/** Fallback duration for a segment without a valid duration: ~3 s at 30 fps. */
const FALLBACK_SEGMENT_FRAMES = 90;

/** Safe frame count for a segment (>= MIN_SEGMENT_FRAMES). */
function safeFrames(seg: RenderedSegment): number {
  const n = Math.round(seg.durationFrames);
  if (!Number.isFinite(n) || n < MIN_SEGMENT_FRAMES) {
    return Math.max(MIN_SEGMENT_FRAMES, FALLBACK_SEGMENT_FRAMES);
  }
  return n;
}

/**
 * Computes the composition metadata from the props.
 * - `durationInFrames` = sum of the segments' `durationFrames` (at least 1).
 * - `fps` / `width` / `height` come from the props (the configured format).
 */
export const calculateFeedReelMetadata: CalculateMetadataFunction<FeedReelProps> = ({
  props,
}) => {
  const segments = Array.isArray(props.segments) ? props.segments : [];
  const total = segments.reduce((sum, seg) => sum + safeFrames(seg), 0);

  return {
    durationInFrames: Math.max(MIN_SEGMENT_FRAMES, total),
    fps: props.fps,
    width: props.width,
    height: props.height,
  };
};

/** Main Remotion composition. */
export function FeedReelVideo(props: FeedReelProps): React.ReactElement {
  const { title, date, emoji, label, accentColor, segments, uiLabel, dateLocale, subscribeText } =
    props;

  // Load the OFL fonts (idempotent, fails silently).
  loadFonts();

  const theme = deriveTheme(accentColor);
  const list = Array.isArray(segments) ? segments : [];

  // Items only, to number them "02 / 05".
  const items = list.filter((s) => s.type === 'item');

  // Safeguard: `Series` requires at least one child. With no segment, we render
  // a fallback intro so the composition never crashes.
  const isEmpty = list.length === 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.background,
        color: theme.text,
        // Cleaner antialiasing for text rendered headless.
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <Background theme={theme} />

      {/* Content layer, beneath the persistent header/bar. */}
      <AbsoluteFill style={{ paddingTop: 200, paddingBottom: 160 }}>
        <Series>
          {isEmpty ? (
            <Series.Sequence durationInFrames={MIN_SEGMENT_FRAMES}>
              <IntroScene title={title} itemCount={items.length} theme={theme} />
            </Series.Sequence>
          ) : (
            list.map((seg, i) => {
              const durationInFrames = safeFrames(seg);
              const key = `seg-${i}`;

              if (seg.type === 'intro') {
                return (
                  <Series.Sequence key={key} durationInFrames={durationInFrames}>
                    <IntroScene
                      title={title}
                      hook={seg.hook}
                      itemCount={items.length}
                      theme={theme}
                    />
                  </Series.Sequence>
                );
              }

              if (seg.type === 'outro') {
                return (
                  <Series.Sequence key={key} durationInFrames={durationInFrames}>
                    <OutroScene
                      subscribeText={subscribeText}
                      uiLabel={uiLabel}
                      emoji={emoji}
                      theme={theme}
                    />
                  </Series.Sequence>
                );
              }

              // Rank of the item among items only (1-based).
              const itemIndex = items.indexOf(seg) + 1;
              return (
                <Series.Sequence key={key} durationInFrames={durationInFrames}>
                  <ItemScene
                    index={itemIndex}
                    total={items.length}
                    headline={seg.headline}
                    body={seg.body}
                    source={seg.source}
                    theme={theme}
                  />
                </Series.Sequence>
              );
            })
          )}
        </Series>
      </AbsoluteFill>

      {/* PERSISTENT header and progress, on top of the content. */}
      <Header emoji={emoji} label={label} date={date} dateLocale={dateLocale} theme={theme} />
      <ProgressBar theme={theme} />
    </AbsoluteFill>
  );
}

/**
 * Default props: a sample `VideoScript` (intro + 2 items + outro), used by the
 * Remotion studio and the preview render.
 */
export const defaultFeedReelProps: FeedReelProps = {
  date: '2026-06-06',
  title: "Today's football wrap",
  segments: [
    {
      type: 'intro',
      hook: 'The football stories everyone is talking about today — in under a minute.',
      durationSec: 3,
      durationFrames: 90,
    },
    {
      type: 'item',
      headline: 'Late winner sends them top of the table',
      body: 'A stoppage-time strike flips the title race with three games to go.',
      url: 'https://example.com/football-winner',
      source: 'example.com',
      durationSec: 4,
      durationFrames: 120,
    },
    {
      type: 'item',
      headline: 'Star striker linked with a summer move',
      body: 'Reports suggest a record fee is being prepared by two European giants.',
      url: 'https://example.com/football-transfer',
      source: 'example.com',
      durationSec: 4,
      durationFrames: 120,
    },
    {
      type: 'outro',
      durationSec: 3,
      durationFrames: 90,
    },
  ],
  audioFile: '',
  emoji: '⚽',
  label: 'Football',
  accentColor: '#22c55e',
  uiLabel: 'FOOTBALL',
  dateLocale: 'en-US',
  subscribeText: 'Follow for daily football news',
  fps: 30,
  width: 1080,
  height: 1920,
};
