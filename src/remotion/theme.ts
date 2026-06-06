/**
 * Derives a restrained visual theme from a category's accent color.
 * All the styling (dark background, halo, grid, grain) is computed here, in code,
 * with no external dependency or image.
 */

/** Theme derived from an accent: values ready to inject as inline CSS. */
export interface Theme {
  /** Raw accent (hex). */
  accent: string;
  /** Very dark background tinted toward the accent. */
  background: string;
  /** Secondary background (cards, header). */
  surface: string;
  /** Radial gradient of the accent halo (`background` value). */
  halo: string;
  /** Fine grid pattern (`background-image` value). */
  grid: string;
  /** Size of a grid cell (`background-size` value). */
  gridSize: string;
  /** Procedural grain layer (SVG data-URI, `background-image` value). */
  grain: string;
  /** Primary text. */
  text: string;
  /** Muted text (captions, sources). */
  textMuted: string;
  /** Light translucent accent (borders, glows). */
  accentSoft: string;
}

/** Normalizes a hex (#rgb or #rrggbb) into 0–255 components. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return {
    r: Number.isFinite(r) ? r : 78,
    g: Number.isFinite(g) ? g : 168,
    b: Number.isFinite(b) ? b : 255,
  };
}

/** Builds an `rgba(...)` string. */
function rgba(c: { r: number; g: number; b: number }, alpha: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

/** Blends a component toward black by a factor (0 = black, 1 = unchanged). */
function darken(value: number, factor: number): number {
  return Math.round(value * factor);
}

/**
 * Derives a complete theme from an accent color.
 * Robust: an invalid hex falls back to a default blue.
 */
export function deriveTheme(accentColor: string): Theme {
  const accent = accentColor && accentColor.startsWith('#') ? accentColor : '#4ea8ff';
  const c = hexToRgb(accent);

  // Dark background slightly tinted toward the accent for chromatic unity.
  const bg = { r: darken(c.r, 0.07), g: darken(c.g, 0.07), b: darken(c.b, 0.1) };
  const background = `rgb(${Math.max(8, bg.r)}, ${Math.max(9, bg.g)}, ${Math.max(14, bg.b)})`;
  const surface = rgba(c, 0.06);

  // Soft radial halo at the top of the frame.
  const halo =
    `radial-gradient(120% 80% at 50% -10%, ${rgba(c, 0.32)} 0%, ` +
    `${rgba(c, 0.1)} 35%, rgba(0,0,0,0) 70%)`;

  // Fine grid: two translucent linear gradients.
  const line = rgba(c, 0.05);
  const grid =
    `linear-gradient(${line} 1px, transparent 1px), ` +
    `linear-gradient(90deg, ${line} 1px, transparent 1px)`;

  // Procedural grain: SVG turbulence as a data-URI (no external file).
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
    `</filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>`;
  const grain = `url("data:image/svg+xml,${svg}")`;

  return {
    accent,
    background,
    surface,
    halo,
    grid,
    gridSize: '48px 48px',
    grain,
    text: '#f4f6fb',
    textMuted: 'rgba(244, 246, 251, 0.62)',
    accentSoft: rgba(c, 0.18),
  };
}
