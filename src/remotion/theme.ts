/**
 * Derives a restrained visual theme from the configured accent color.
 * All the styling (dark background, halo, gradients, grain) is computed here, in
 * code, with no external dependency or image.
 */

/** Theme derived from an accent: values ready to inject as inline CSS. */
export interface Theme {
  /** Raw accent (hex). */
  accent: string;
  /** Brighter accent (glints, leading dot, hover energy). */
  accentBright: string;
  /** Linear gradient of the accent (buttons, bars). */
  accentGradient: string;
  /** Very dark page background (solid base color). */
  background: string;
  /** Rich page background gradient (adds depth vs a flat fill). */
  pageGradient: string;
  /** Secondary background (cards, header, chips). */
  surface: string;
  /** Radial gradient of the accent halo. */
  halo: string;
  /** Procedural grain layer (SVG data-URI). */
  grain: string;
  /** Primary text. */
  text: string;
  /** Muted text (captions, sources). */
  textMuted: string;
  /** Light translucent accent (borders, glows). */
  accentSoft: string;
  /** Stronger translucent accent for the bold background glow. */
  accentGlow: string;
  /** Near-black text to sit ON the solid accent (slabs, highlighter). */
  onAccent: string;
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

/** Builds an `rgb(...)` string (clamped). */
function rgb(c: { r: number; g: number; b: number }): string {
  const cl = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `rgb(${cl(c.r)}, ${cl(c.g)}, ${cl(c.b)})`;
}

/** Blends a component toward black by a factor (0 = black, 1 = unchanged). */
function darken(value: number, factor: number): number {
  return Math.round(value * factor);
}

/** Blends a component toward white by a factor (0 = unchanged, 1 = white). */
function lighten(value: number, factor: number): number {
  return Math.round(value + (255 - value) * factor);
}

/**
 * Derives a complete theme from an accent color.
 * Robust: an invalid hex falls back to a default blue.
 */
export function deriveTheme(accentColor: string): Theme {
  const accent = accentColor && accentColor.startsWith('#') ? accentColor : '#4ea8ff';
  const c = hexToRgb(accent);

  const bright = { r: lighten(c.r, 0.35), g: lighten(c.g, 0.35), b: lighten(c.b, 0.35) };
  const deep = { r: darken(c.r, 0.72), g: darken(c.g, 0.72), b: darken(c.b, 0.72) };

  // Dark background slightly tinted toward the accent for chromatic unity.
  const bg = { r: Math.max(8, darken(c.r, 0.07)), g: Math.max(9, darken(c.g, 0.07)), b: Math.max(14, darken(c.b, 0.1)) };
  // A second, slightly bluer/darker anchor for the page gradient (adds depth).
  const bg2 = { r: Math.max(4, bg.r - 4), g: Math.max(5, bg.g - 4), b: Math.max(9, bg.b - 2) };
  const background = rgb(bg);
  const surface = rgba(c, 0.07);

  // Page gradient: top-tinted toward the accent, settling into a darker base.
  const pageGradient =
    `radial-gradient(120% 75% at 50% -15%, ${rgba(c, 0.22)} 0%, rgba(0,0,0,0) 55%), ` +
    `linear-gradient(168deg, ${rgb(bg)} 0%, ${rgb(bg2)} 100%)`;

  // Soft radial halo at the top of the frame.
  const halo =
    `radial-gradient(120% 80% at 50% -10%, ${rgba(c, 0.32)} 0%, ` +
    `${rgba(c, 0.1)} 35%, rgba(0,0,0,0) 70%)`;

  // Procedural grain: SVG turbulence as a data-URI (no external file).
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
    `</filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>`;
  const grain = `url("data:image/svg+xml,${svg}")`;

  return {
    accent,
    accentBright: rgb(bright),
    accentGradient: `linear-gradient(135deg, ${rgb(bright)} 0%, ${accent} 55%, ${rgb(deep)} 100%)`,
    background,
    pageGradient,
    surface,
    halo,
    grain,
    text: '#f4f6fb',
    textMuted: 'rgba(244, 246, 251, 0.6)',
    accentSoft: rgba(c, 0.2),
    accentGlow: rgba(c, 0.42),
    // Very dark version of the accent: text that sits on the solid accent slab.
    onAccent: rgb({ r: darken(c.r, 0.1), g: darken(c.g, 0.1), b: darken(c.b, 0.1) }),
  };
}
