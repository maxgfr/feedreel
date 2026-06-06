/**
 * Intro scene (bold broadcast): a "TOP N" kicker chip, a big uppercase title in
 * white anchored by an accent bar + gradient underline, then the hook.
 * Robust when the hook is absent. The title wraps and never overflows the frame.
 */
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../theme';
import { FONTS } from '../fonts';

interface IntroSceneProps {
  title: string;
  /** Spoken hook (1–2 sentences), optional. */
  hook?: string;
  /** Number of ranked items (drives the "TOP N" kicker). */
  itemCount: number;
  theme: Theme;
}

export function IntroScene({ title, hook, itemCount, theme }: IntroSceneProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = (delay: number): number =>
    spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.7 } });

  const kickerIn = enter(2);
  const titleIn = enter(8);
  const ruleIn = enter(16);
  const hookIn = enter(24);

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start', padding: '0 84px' }}>
      <div style={{ display: 'flex', gap: 28, maxWidth: 912 }}>
        {/* Accent bar anchoring the whole block. */}
        <div
          style={{
            width: 10,
            alignSelf: 'stretch',
            borderRadius: 999,
            background: theme.accentGradient,
            boxShadow: `0 0 28px ${theme.accentGlow}`,
            transform: `scaleY(${titleIn})`,
            transformOrigin: 'top',
          }}
        />

        <div>
          {/* "TOP N" kicker chip. */}
          {itemCount > 0 ? (
            <div
              style={{
                opacity: kickerIn,
                transform: `translateY(${(1 - kickerIn) * 22}px)`,
                display: 'inline-block',
                fontFamily: FONTS.mono,
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: theme.onAccent,
                background: theme.accentGradient,
                padding: '8px 18px',
                borderRadius: 10,
                marginBottom: 30,
                boxShadow: `0 10px 30px ${theme.accentGlow}`,
              }}
            >
              Top {itemCount}
            </div>
          ) : null}

          <h1
            style={{
              opacity: titleIn,
              transform: `translateY(${(1 - titleIn) * 30}px)`,
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 96,
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
              textTransform: 'uppercase',
              color: theme.text,
              overflowWrap: 'anywhere',
              textShadow: `0 6px 40px ${theme.accentGlow}`,
              margin: 0,
            }}
          >
            {title}
          </h1>

          {/* Accent gradient underline. */}
          <div
            style={{
              height: 12,
              width: `${interpolate(ruleIn, [0, 1], [0, 220])}px`,
              borderRadius: 999,
              background: theme.accentGradient,
              boxShadow: `0 0 24px ${theme.accentGlow}`,
              margin: '36px 0 0',
            }}
          />

          {hook ? (
            <p
              style={{
                opacity: hookIn,
                transform: `translateY(${(1 - hookIn) * 24}px)`,
                fontFamily: FONTS.sans,
                fontWeight: 500,
                fontSize: 46,
                lineHeight: 1.32,
                color: theme.text,
                marginTop: 40,
                maxWidth: 820,
              }}
            >
              {hook}
            </p>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
}
