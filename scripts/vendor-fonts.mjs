#!/usr/bin/env node
/**
 * Vendoring of OFL fonts for feedreel (100% code-driven styling, offline at render time).
 *
 * Downloads 3 woff2 files (OFL-licensed) from the Fontsource CDN (jsDelivr)
 * into `public/fonts/`, with the EXACT, stable file names expected by the
 * Remotion composition:
 *   - Unbounded.woff2        (display, 700)
 *   - HankenGrotesk.woff2    (sans, 500)
 *   - JetBrainsMono.woff2    (mono, 500)
 *
 * No external dependency: `fetch` (Node >= 20) + `node:fs`.
 * Idempotent: a file already present (and non-empty) is skipped.
 * Fault-tolerant: a failed download emits a warning without failing
 * the whole run (setup can continue; re-running later fills in the missing ones).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Project root: this script lives in <root>/scripts/.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS_DIR = path.join(PROJECT_ROOT, 'public', 'fonts');

/** List of fonts to vendor: local file name + CDN URL. */
const FONTS = [
  {
    file: 'Unbounded.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/unbounded@latest/latin-700-normal.woff2',
  },
  {
    file: 'HankenGrotesk.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/hanken-grotesk@latest/latin-500-normal.woff2',
  },
  {
    file: 'JetBrainsMono.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-500-normal.woff2',
  },
];

/** True if the file already exists with non-empty content. */
function alreadyPresent(dest) {
  try {
    return fs.statSync(dest).size > 0;
  } catch {
    return false;
  }
}

/** Downloads a font. Returns true on success (or already present), false on tolerated failure. */
async function downloadFont({ file, url }) {
  const dest = path.join(FONTS_DIR, file);
  if (alreadyPresent(dest)) {
    console.log(`[vendor-fonts] already present, skipped: ${file}`);
    return true;
  }
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      throw new Error('empty response');
    }
    // Atomic write: temporary file then rename.
    const tmp = `${dest}.download`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
    console.log(`[vendor-fonts] downloaded: ${file} (${buf.length} bytes)`);
    return true;
  } catch (err) {
    console.warn(`[vendor-fonts] WARNING: failed to download ${file} from ${url}: ${err}`);
    return false;
  }
}

async function main() {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
  const results = await Promise.all(FONTS.map(downloadFont));
  const ok = results.filter(Boolean).length;
  const total = FONTS.length;
  if (ok === total) {
    console.log(`[vendor-fonts] done: ${ok}/${total} font(s) available in public/fonts/`);
  } else {
    console.warn(
      `[vendor-fonts] done with warnings: ${ok}/${total} font(s) available. ` +
        `Re-run \`node scripts/vendor-fonts.mjs\` to complete the missing ones.`,
    );
  }
  // We never fail the setup because of a failed download.
}

main().catch((err) => {
  console.warn(`[vendor-fonts] WARNING: unexpected error: ${err}`);
});
