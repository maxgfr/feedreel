/**
 * Item scene (bold broadcast): a big number badge + counter, a huge faint "ghost"
 * rank number for depth, the headline in white anchored by an accent underline,
 * the body, and a source chip. Staggered spring reveals. No field is required.
 */
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../theme';
import { FONTS } from '../fonts';

interface ItemSceneProps {
  /** Rank of the item (1-based) for the displayed number. */
  index: number;
  /** Total number of items, for the "01 / 10" counter. */
  total: number;
  headline?: string;
  body?: string;
  source?: string;
  theme: Theme;
}

/** Formats an integer to 2 digits (e.g. 3 → "03"). */
function pad2(n: number): string {
  return String(Math.max(0, n)).padStart(2, '0');
}

export function ItemScene({ index, total, headline, body, source, theme }: ItemSceneProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = (delay: number): number =>
    spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.6 } });

  const numberIn = enter(0);
  const headlineIn = enter(7);
  const ruleIn = enter(14);
  const bodyIn = enter(20);
  const sourceIn = enter(30);

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start', padding: '0 84px' }}>
      {/* Huge faint ghost number for depth. */}
      <div
        style={{
          position: 'absolute',
          top: 40,
          right: -24,
          fontFamily: FONTS.display,
          fontWeight: 800,
          fontSize: 560,
          lineHeight: 0.8,
          color: theme.accentSoft,
          opacity: interpolate(numberIn, [0, 1], [0, 0.5]),
          pointerEvents: 'none',
        }}
      >
        {pad2(index)}
      </div>

      <div style={{ maxWidth: 920, width: '100%' }}>
        {/* Number in a solid accent slab + counter. */}
        <div
          style={{
            opacity: numberIn,
            transform: `translateY(${(1 - numberIn) * 24}px)`,
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            marginBottom: 44,
          }}
        >
          <span
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 72,
              lineHeight: 1,
              color: theme.onAccent,
              background: theme.accentGradient,
              padding: '10px 26px',
              borderRadius: 18,
              boxShadow: `0 14px 40px ${theme.accentGlow}`,
            }}
          >
            {pad2(index)}
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 40, fontWeight: 700, color: theme.textMuted }}>
            / {pad2(total)}
          </span>
        </div>

        {/* Headline in white, uppercase, with an accent underline. */}
        {headline ? (
          <>
            <h2
              style={{
                opacity: headlineIn,
                transform: `translateY(${(1 - headlineIn) * 32}px)`,
                fontFamily: FONTS.display,
                fontWeight: 800,
                fontSize: 82,
                lineHeight: 1.08,
                letterSpacing: '-0.01em',
                textTransform: 'uppercase',
                color: theme.text,
                overflowWrap: 'anywhere',
                textShadow: `0 6px 36px ${theme.accentGlow}`,
                margin: 0,
              }}
            >
              {headline}
            </h2>
            <div
              style={{
                height: 10,
                width: `${interpolate(ruleIn, [0, 1], [0, 180])}px`,
                borderRadius: 999,
                background: theme.accentGradient,
                boxShadow: `0 0 22px ${theme.accentGlow}`,
                margin: '30px 0 0',
              }}
            />
          </>
        ) : null}

        {body ? (
          <p
            style={{
              opacity: bodyIn,
              transform: `translateY(${(1 - bodyIn) * 24}px)`,
              fontFamily: FONTS.sans,
              fontWeight: 500,
              fontSize: 44,
              lineHeight: 1.3,
              color: theme.text,
              margin: '34px 0 0',
              maxWidth: 860,
            }}
          >
            {body}
          </p>
        ) : null}

        {source ? (
          <div
            style={{
              opacity: sourceIn,
              transform: `translateY(${(1 - sourceIn) * 18}px)`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
              marginTop: 52,
              padding: '12px 22px',
              borderRadius: 999,
              background: theme.surface,
              border: `2px solid ${theme.accentSoft}`,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: theme.accent,
                boxShadow: `0 0 18px ${theme.accent}`,
              }}
            />
            <span
              style={{
                fontFamily: FONTS.mono,
                fontWeight: 700,
                fontSize: 30,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: theme.text,
              }}
            >
              {source}
            </span>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
