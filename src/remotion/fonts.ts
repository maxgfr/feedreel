/**
 * Loading of the 3 OFL fonts vendored locally in `public/fonts`.
 *
 * We register the fonts via the browser's FontFace API (the Remotion render
 * runs in headless Chromium). `delayRender` holds the render until the fonts
 * are ready; on failure we continue silently with the system fallbacks
 * (the render must never crash because of a missing font).
 *
 * EXACT files expected in public/fonts:
 *   - Unbounded.woff2       → family "Unbounded"        (display)
 *   - HankenGrotesk.woff2   → family "Hanken Grotesk"   (sans)
 *   - JetBrainsMono.woff2   → family "JetBrains Mono"   (mono)
 */
import { continueRender, delayRender, staticFile } from 'remotion';

/** Font families to use in the CSS `fontFamily` properties. */
export const FONTS = {
  display: 'Unbounded',
  sans: 'Hanken Grotesk',
  mono: 'JetBrains Mono',
} as const;

interface FontSpec {
  family: string;
  file: string;
}

const FONT_SPECS: FontSpec[] = [
  { family: FONTS.display, file: 'fonts/Unbounded.woff2' },
  { family: FONTS.sans, file: 'fonts/HankenGrotesk.woff2' },
  { family: FONTS.mono, file: 'fonts/JetBrainsMono.woff2' },
];

let loaded = false;

/**
 * Loads and registers the fonts only once.
 * Idempotent: no effect outside the browser (no `document`/`FontFace`).
 */
export function loadFonts(): void {
  if (loaded) return;
  loaded = true;

  // Outside a DOM environment (e.g. Node metadata computation): nothing to do.
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    return;
  }

  const handle = delayRender('Loading feedreel fonts');

  const tasks = FONT_SPECS.map(async (spec) => {
    try {
      const url = `url(${staticFile(spec.file)})`;
      const face = new FontFace(spec.family, url);
      await face.load();
      document.fonts.add(face);
    } catch {
      // Missing or unreadable font: we silently fall back.
    }
  });

  Promise.all(tasks)
    .catch(() => {
      // No error must propagate: system fallback.
    })
    .finally(() => {
      continueRender(handle);
    });
}
