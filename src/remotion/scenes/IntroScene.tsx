/**
 * Intro scene: title (display) + hook (narration), spring entrances.
 * Robust: works even when the hook is absent.
 */
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../theme';
import { FONTS } from '../fonts';

interface IntroSceneProps {
  title: string;
  /** Spoken hook (1–2 sentences), optional. */
  hook?: string;
  label: string;
  /** Header label prefix per language (e.g. "VEILLE", "TECH WATCH"). */
  uiLabel: string;
  theme: Theme;
}

export function IntroScene({
  title,
  hook,
  label,
  uiLabel,
  theme,
}: IntroSceneProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Soft spring for the eyebrow, the title, then the hook (staggered).
  const enter = (delay: number): number =>
    spring({
      frame: frame - delay,
      fps,
      config: { damping: 200, mass: 0.8 },
    });

  const eyebrow = enter(2);
  const titleIn = enter(8);
  const hookIn = enter(20);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '0 96px',
      }}
    >
      <div style={{ maxWidth: 900 }}>
        <div
          style={{
            opacity: eyebrow,
            transform: `translateY(${(1 - eyebrow) * 24}px)`,
            fontFamily: FONTS.mono,
            fontSize: 30,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: theme.accent,
            marginBottom: 28,
          }}
        >
          {uiLabel} · {label}
        </div>

        <h1
          style={{
            opacity: titleIn,
            transform: `translateY(${(1 - titleIn) * 40}px)`,
            fontFamily: FONTS.display,
            fontWeight: 800,
            fontSize: 104,
            lineHeight: 1.02,
            letterSpacing: '-0.02em',
            color: theme.text,
            margin: 0,
            textWrap: 'balance',
          }}
        >
          {title}
        </h1>

        {hook ? (
          <p
            style={{
              opacity: hookIn,
              transform: `translateY(${(1 - hookIn) * 28}px)`,
              fontFamily: FONTS.sans,
              fontWeight: 400,
              fontSize: 44,
              lineHeight: 1.32,
              color: theme.textMuted,
              marginTop: 48,
              maxWidth: 820,
            }}
          >
            {hook}
          </p>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
