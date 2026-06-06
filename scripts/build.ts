/**
 * `npm run build`: verifies that the Remotion bundle compiles.
 * Builds the bundle via `bundleRemotion(loadConfig())` and logs the `serveUrl`.
 * Acts as a safeguard: a composition compilation failure surfaces here.
 */

import { loadConfig } from '../config/index';
import { bundleRemotion } from '../src/pipeline/render';
import { log } from '../src/log';

const logger = log.child('build');

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.info('Bundling the Remotion project…');
  const serveUrl = await bundleRemotion(cfg);
  logger.info(`Remotion bundle OK: ${serveUrl}`);
}

main().catch((err) => {
  logger.error(`Remotion bundle failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
