/**
 * Remotion Studio configuration.
 * Minimal: JPEG video image format (faster rendering) and concurrency of 2.
 * Only affects the Studio / Remotion CLI; programmatic rendering goes through
 * `renderMedia` in src/pipeline/render.ts.
 */

import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setConcurrency(2);
