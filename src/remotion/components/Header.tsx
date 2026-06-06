/**
 * PERSISTENT header (shown for the entire duration of the video):
 * solid accent emoji tile + uppercase label + date chip. Bold sport-social.
 */
import type { Theme } from '../theme';
import { FONTS } from '../fonts';

interface HeaderProps {
  emoji: string;
  label: string;
  date: string;
  /** Intl locale to format the date (e.g. "fr-FR", "en-US"). */
  dateLocale: string;
  theme: Theme;
}

/** Formats the ISO date (YYYY-MM-DD) per the locale; tolerant of empty input. */
function formatDate(date: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  if (!match) return date ?? '';
  const [, y, m, d] = match;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  try {
    return new Intl.DateTimeFormat(locale || 'fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(dt);
  } catch {
    return `${Number(d)}/${Number(m)}/${y}`;
  }
}

export function Header({ emoji, label, date, dateLocale, theme }: HeaderProps): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: 64,
        right: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: 22,
            background: theme.accentGradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 50,
            lineHeight: 1,
            boxShadow: `0 12px 36px ${theme.accentGlow}`,
          }}
        >
          {emoji}
        </div>
        <span
          style={{
            fontFamily: FONTS.display,
            fontWeight: 800,
            fontSize: 44,
            letterSpacing: '0.01em',
            textTransform: 'uppercase',
            color: theme.text,
          }}
        >
          {label}
        </span>
      </div>

      <span
        style={{
          fontFamily: FONTS.mono,
          fontWeight: 700,
          fontSize: 28,
          color: theme.text,
          whiteSpace: 'nowrap',
          padding: '10px 18px',
          borderRadius: 999,
          background: theme.surface,
          border: `2px solid ${theme.accentSoft}`,
        }}
      >
        {formatDate(date, dateLocale)}
      </span>
    </div>
  );
}
