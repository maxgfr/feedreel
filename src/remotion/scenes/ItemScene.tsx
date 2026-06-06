/**
 * Item scene (bold broadcast). Two layouts share the same chrome (rank badge +
 * counter + ghost number + source chip):
 *   - SCOREBOARD: when `home` AND `away` are set. With scores it shows a result
 *     (winner highlighted); without scores it shows a fixture (VS).
 *   - NEWS: otherwise — headline + accent underline + body (the default).
 * No field is required; every block renders defensively.
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
  /** Scoreboard: home/away teams (both required to trigger the layout). */
  home?: string;
  away?: string;
  /** Scoreboard: scores (both required to show a result instead of a fixture). */
  homeScore?: number;
  awayScore?: number;
  /** Scoreboard: small label above the score (e.g. "World Cup warm-up"). */
  competition?: string;
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
  home,
  away,
  homeScore,
  awayScore,
  competition,
  theme,
}: ItemSceneProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = (delay: number): number =>
    spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.6 } });

  const numberIn = enter(0);
  const headlineIn = enter(7);
  const ruleIn = enter(14);
  const bodyIn = enter(20);
  const sourceIn = enter(30);

  const isScoreboard = typeof home === 'string' && home !== '' && typeof away === 'string' && away !== '';
  const hasScores = typeof homeScore === 'number' && typeof awayScore === 'number';

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

        {isScoreboard ? (
          <Scoreboard
            home={home as string}
            away={away as string}
            homeScore={homeScore}
            awayScore={awayScore}
            hasScores={hasScores}
            competition={competition}
            body={body}
            theme={theme}
            cardIn={headlineIn}
            bodyIn={bodyIn}
          />
        ) : (
          <>
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
          </>
        )}

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

/** Scoreboard block: a result (two rows + scores, winner lit) or a fixture (VS). */
function Scoreboard({
  home,
  away,
  homeScore,
  awayScore,
  hasScores,
  competition,
  body,
  theme,
  cardIn,
  bodyIn,
}: {
  home: string;
  away: string;
  homeScore?: number;
  awayScore?: number;
  hasScores: boolean;
  competition?: string;
  body?: string;
  theme: Theme;
  cardIn: number;
  bodyIn: number;
}): React.ReactElement {
  const homeWon = hasScores && (homeScore as number) > (awayScore as number);
  const awayWon = hasScores && (awayScore as number) > (homeScore as number);

  const teamColor = (won: boolean, lost: boolean): string =>
    won ? theme.accentBright : lost ? theme.textMuted : theme.text;

  const teamStyle = (won: boolean, lost: boolean): React.CSSProperties => ({
    fontFamily: FONTS.display,
    fontWeight: 800,
    fontSize: 62,
    lineHeight: 1.04,
    textTransform: 'uppercase',
    letterSpacing: '-0.01em',
    color: teamColor(won, lost),
    overflowWrap: 'anywhere',
    flex: 1,
    minWidth: 0,
  });

  const scoreStyle = (won: boolean, lost: boolean): React.CSSProperties => ({
    fontFamily: FONTS.display,
    fontWeight: 800,
    fontSize: 104,
    lineHeight: 1,
    color: teamColor(won, lost),
    textShadow: won ? `0 6px 32px ${theme.accentGlow}` : 'none',
  });

  return (
    <>
      {competition ? (
        <div
          style={{
            opacity: cardIn,
            transform: `translateY(${(1 - cardIn) * 20}px)`,
            display: 'inline-block',
            fontFamily: FONTS.mono,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: theme.accentBright,
            marginBottom: 24,
          }}
        >
          {competition}
        </div>
      ) : null}

      <div
        style={{
          opacity: cardIn,
          transform: `translateY(${(1 - cardIn) * 30}px)`,
          width: '100%',
          boxSizing: 'border-box',
          background: theme.surface,
          border: `2px solid ${theme.accentSoft}`,
          borderRadius: 32,
          padding: '44px 52px',
          boxShadow: '0 18px 54px rgba(0,0,0,0.38)',
        }}
      >
        {hasScores ? (
          <>
            {/* Home row. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 28 }}>
              <span style={teamStyle(homeWon, awayWon)}>{home}</span>
              <span style={scoreStyle(homeWon, awayWon)}>{homeScore}</span>
            </div>
            {/* Divider. */}
            <div style={{ height: 2, background: theme.accentSoft, borderRadius: 999, margin: '26px 0' }} />
            {/* Away row. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 28 }}>
              <span style={teamStyle(awayWon, homeWon)}>{away}</span>
              <span style={scoreStyle(awayWon, homeWon)}>{awayScore}</span>
            </div>
          </>
        ) : (
          /* Fixture: stacked teams around a VS badge. */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            <span style={{ ...teamStyle(false, false), flex: 'none', textAlign: 'center', width: '100%' }}>
              {home}
            </span>
            <span
              style={{
                fontFamily: FONTS.display,
                fontWeight: 800,
                fontSize: 56,
                lineHeight: 1,
                color: theme.onAccent,
                background: theme.accentGradient,
                padding: '6px 26px',
                borderRadius: 16,
                boxShadow: `0 10px 30px ${theme.accentGlow}`,
              }}
            >
              VS
            </span>
            <span style={{ ...teamStyle(false, false), flex: 'none', textAlign: 'center', width: '100%' }}>
              {away}
            </span>
          </div>
        )}
      </div>

      {body ? (
        <p
          style={{
            opacity: bodyIn,
            transform: `translateY(${(1 - bodyIn) * 24}px)`,
            fontFamily: FONTS.sans,
            fontWeight: 500,
            fontSize: 42,
            lineHeight: 1.3,
            color: theme.text,
            margin: '34px 0 0',
            maxWidth: 860,
          }}
        >
          {body}
        </p>
      ) : null}
    </>
  );
}
