/**
 * PERSISTENT header (shown for the entire duration of the video):
 * category emoji + label + date. Placed at the top, safe for the vertical format.
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
        top: 64,
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
            width: 88,
            height: 88,
            borderRadius: 24,
            background: theme.surface,
            border: `1px solid ${theme.accentSoft}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 48,
            lineHeight: 1,
          }}
        >
          {emoji}
        </div>
        <span
          style={{
            fontFamily: FONTS.display,
            fontWeight: 700,
            fontSize: 40,
            letterSpacing: '-0.01em',
            color: theme.text,
          }}
        >
          {label}
        </span>
      </div>

      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 28,
          color: theme.textMuted,
          whiteSpace: 'nowrap',
        }}
      >
        {formatDate(date, dateLocale)}
      </span>
    </div>
  );
}
