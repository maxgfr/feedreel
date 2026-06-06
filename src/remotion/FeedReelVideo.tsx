/**
 * Main `FeedReelVideo` composition.
 *
 * Receives a `VideoScript` as props (see src/types.ts) and assembles it:
 *   - procedural background (Background)
 *   - persistent header (Header) + progress bar (ProgressBar)
 *   - a `Series` of scenes: intro, then 1 scene per `item`-type segment,
 *     each sub-sequence lasting `seg.durationFrames` (aligned with the TTS audio).
 *
 * The total composition duration is derived by `calculateFeedReelMetadata`
 * (sum of `durationFrames`), so the video lasts exactly as long as the voice-over.
 */
import { AbsoluteFill, Series } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import type { RenderedSegment, VideoScript } from '../types';

/**
 * Literal variant of `VideoScript`: an object type (not an interface)
 * satisfies the `Props extends Record<string, unknown>` constraint required by
 * `Composition` / `CalculateMetadataFunction`, without modifying `src/types.ts`.
 * Structurally identical to `VideoScript`.
 */
export type FeedReelProps = { [K in keyof VideoScript]: VideoScript[K] };
import { deriveTheme } from './theme';
import { loadFonts } from './fonts';
import { Background } from './components/Background';
import { Header } from './components/Header';
import { ProgressBar } from './components/ProgressBar';
import { IntroScene } from './scenes/IntroScene';
import { ItemScene } from './scenes/ItemScene';

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
 * - `fps` / `width` / `height` come from the props (the category's format).
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
  const { title, date, emoji, label, accentColor, segments, uiLabel, dateLocale } = props;

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
              <IntroScene title={title} label={label} uiLabel={uiLabel} theme={theme} />
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
                      hook={seg.narration}
                      label={label}
                      uiLabel={uiLabel}
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
 * Default props: a sample `VideoScript` in English (intro + 2 items),
 * used by the Remotion studio and the preview render.
 */
export const defaultFeedReelProps: FeedReelProps = {
  category: 'global',
  date: '2026-06-05',
  title: "Today's tech watch",
  segments: [
    {
      type: 'intro',
      narration:
        'The tech digest of the day, in under a minute. Three things to remember, no noise.',
      audioPath: '',
      durationSec: 4,
      durationFrames: 120,
    },
    {
      type: 'item',
      headline: 'A new model paves the way for autonomous code',
      body: 'Agents able to chain several development steps without continuous supervision.',
      narration:
        'First topic: a new model pushes the autonomy of code agents even further.',
      url: 'https://example.com/ia-agents',
      source: 'example.com',
      audioPath: '',
      durationSec: 6,
      durationFrames: 180,
    },
    {
      type: 'item',
      headline: 'A critical vulnerability patched urgently',
      body: 'An update is recommended without delay for servers exposed on the Internet.',
      narration:
        'On the security side, a critical vulnerability has just been fixed: apply the patch right away.',
      url: 'https://example.com/securite-faille',
      source: 'example.com',
      audioPath: '',
      durationSec: 6,
      durationFrames: 180,
    },
  ],
  audioFile: '',
  emoji: '🌍',
  label: 'Global / News Tech',
  accentColor: '#4ea8ff',
  langCode: 'en',
  uiLabel: 'TECH WATCH',
  dateLocale: 'en-US',
  fps: 30,
  width: 1080,
  height: 1920,
};
