/**
 * Item scene: number (mono), headline (display), body (sans), source (mono).
 * Staggered spring reveals. No field is required:
 * the scene does not crash if headline/body/source are missing.
 */
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../theme';
import { FONTS } from '../fonts';

interface ItemSceneProps {
  /** Rank of the item (1-based) for the displayed number. */
  index: number;
  /** Total number of items, for the "02 / 05" counter. */
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

export function ItemScene({
  index,
  total,
  headline,
  body,
  source,
  theme,
}: ItemSceneProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = (delay: number): number =>
    spring({
      frame: frame - delay,
      fps,
      config: { damping: 200, mass: 0.7 },
    });

  const numberIn = enter(0);
  const headlineIn = enter(8);
  const bodyIn = enter(18);
  const sourceIn = enter(28);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '0 96px',
      }}
    >
      <div style={{ maxWidth: 900, width: '100%' }}>
        {/* Number + counter. */}
        <div
          style={{
            opacity: numberIn,
            transform: `translateY(${(1 - numberIn) * 24}px)`,
            display: 'flex',
            alignItems: 'baseline',
            gap: 18,
            marginBottom: 36,
          }}
        >
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 120,
              fontWeight: 700,
              lineHeight: 1,
              color: theme.accent,
            }}
          >
            {pad2(index)}
          </span>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 34,
              color: theme.textMuted,
            }}
          >
            / {pad2(total)}
          </span>
        </div>

        {headline ? (
          <h2
            style={{
              opacity: headlineIn,
              transform: `translateY(${(1 - headlineIn) * 36}px)`,
              fontFamily: FONTS.display,
              fontWeight: 700,
              fontSize: 76,
              lineHeight: 1.06,
              letterSpacing: '-0.015em',
              color: theme.text,
              margin: 0,
              textWrap: 'balance',
            }}
          >
            {headline}
          </h2>
        ) : null}

        {body ? (
          <p
            style={{
              opacity: bodyIn,
              transform: `translateY(${(1 - bodyIn) * 28}px)`,
              fontFamily: FONTS.sans,
              fontWeight: 400,
              fontSize: 42,
              lineHeight: 1.34,
              color: theme.textMuted,
              marginTop: 40,
              maxWidth: 840,
            }}
          >
            {body}
          </p>
        ) : null}

        {source ? (
          <div
            style={{
              opacity: sourceIn,
              transform: `translateY(${(1 - sourceIn) * 20}px)`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
              marginTop: 56,
              padding: '14px 24px',
              borderRadius: 16,
              background: theme.surface,
              border: `1px solid ${theme.accentSoft}`,
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: theme.accent,
                boxShadow: `0 0 16px ${theme.accent}`,
              }}
            />
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 30,
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
