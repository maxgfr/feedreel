/**
 * Outro scene (auto-appended): a full-screen "subscribe" call-to-action.
 * Bold broadcast look: emoji tile, a glowing SUBSCRIBE pill (gradient + bell +
 * arrow) with a gentle pulse, the configurable CTA line, an optional comment
 * card tied to the day's news ("Join the debate"), and a handle divider.
 * Music only (no voice-over).
 */
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../theme';
import { FONTS } from '../fonts';

interface OutroSceneProps {
  /** Configurable call-to-action (e.g. "Follow for daily football news"). */
  subscribeText: string;
  /** Localizable subscribe-button label (e.g. "Subscribe"). */
  subscribeLabel: string;
  /** Localizable comment-card badge (e.g. "Join the debate"). */
  joinLabel: string;
  /**
   * Optional news-tied question pushing viewers to comment (e.g.
   * "Scandal or fair? 👇"). When empty, the comment card is not rendered.
   */
  commentPrompt: string;
  /** Header label prefix per language (e.g. "FOOTBALL"). */
  uiLabel: string;
  emoji: string;
  theme: Theme;
}

export function OutroScene({
  subscribeText,
  subscribeLabel,
  joinLabel,
  commentPrompt,
  uiLabel,
  emoji,
  theme,
}: OutroSceneProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = (delay: number): number =>
    spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.6 } });

  const emojiIn = enter(0);
  const buttonIn = enter(8);
  const ctaIn = enter(20);
  const commentIn = enter(26);
  const handleIn = enter(36);

  const hasComment = typeof commentPrompt === 'string' && commentPrompt.trim() !== '';

  // Gentle continuous pulse on the subscribe pill.
  const pulse = 1 + 0.035 * Math.sin((frame / fps) * Math.PI * 2 * 0.9);

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 84px' }}>
      {/* Soft glow ring behind the CTA. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(42% 26% at 50% 46%, ${theme.accentGlow} 0%, rgba(0,0,0,0) 70%)`,
          opacity: buttonIn,
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 920 }}>
        {/* Emoji tile. */}
        <div
          style={{
            opacity: emojiIn,
            transform: `scale(${interpolate(emojiIn, [0, 1], [0.7, 1])})`,
            width: 140,
            height: 140,
            borderRadius: 34,
            background: theme.accentGradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 76,
            lineHeight: 1,
            boxShadow: `0 18px 54px ${theme.accentGlow}`,
            marginBottom: 60,
          }}
        >
          {emoji}
        </div>

        {/* SUBSCRIBE pill (bell + label + arrow), with a continuous pulse. */}
        <div
          style={{
            opacity: buttonIn,
            transform: `translateY(${(1 - buttonIn) * 28}px) scale(${pulse})`,
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            background: theme.accentGradient,
            color: theme.onAccent,
            padding: '28px 56px',
            borderRadius: 26,
            boxShadow: `0 20px 64px ${theme.accentGlow}`,
          }}
        >
          <span style={{ fontSize: 58, lineHeight: 1 }}>🔔</span>
          <span
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 84,
              lineHeight: 1,
              letterSpacing: '-0.01em',
              textTransform: 'uppercase',
            }}
          >
            {subscribeLabel}
          </span>
        </div>

        {/* Configurable call-to-action line. */}
        <p
          style={{
            opacity: ctaIn,
            transform: `translateY(${(1 - ctaIn) * 22}px)`,
            fontFamily: FONTS.sans,
            fontWeight: 600,
            fontSize: 50,
            lineHeight: 1.3,
            textAlign: 'center',
            color: theme.text,
            margin: '66px 0 0',
            maxWidth: 860,
          }}
        >
          {subscribeText}
        </p>

        {/* Comment card (news-tied) — pushes viewers to reply. */}
        {hasComment && (
          <div
            style={{
              opacity: commentIn,
              transform: `translateY(${(1 - commentIn) * 24}px)`,
              marginTop: 52,
              width: '100%',
              maxWidth: 860,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 18,
              padding: '32px 40px',
              borderRadius: 30,
              background: theme.surface,
              border: `2px solid ${theme.accentSoft}`,
              boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
            }}
          >
            {/* "💬 JOIN THE DEBATE" badge row. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 46, lineHeight: 1 }}>💬</span>
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 30,
                  fontWeight: 700,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: theme.accentBright,
                }}
              >
                {joinLabel}
              </span>
            </div>

            {/* The news-tied question. */}
            <p
              style={{
                fontFamily: FONTS.sans,
                fontWeight: 700,
                fontSize: 46,
                lineHeight: 1.28,
                textAlign: 'center',
                color: theme.text,
                margin: 0,
              }}
            >
              {commentPrompt}
            </p>
          </div>
        )}

        {/* Handle divider: ── uiLabel ── */}
        <div
          style={{
            opacity: handleIn,
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            marginTop: 44,
          }}
        >
          <span style={{ width: 70, height: 3, borderRadius: 999, background: theme.accentSoft }} />
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: theme.textMuted,
            }}
          >
            {uiLabel}
          </span>
          <span style={{ width: 70, height: 3, borderRadius: 999, background: theme.accentSoft }} />
        </div>
      </div>
    </AbsoluteFill>
  );
}
