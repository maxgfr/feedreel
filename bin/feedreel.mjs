#!/usr/bin/env node
/**
 * feedreel CLI launcher.
 *
 * Re-runs `npx tsx src/cli.ts <args>` from the project root (inherited stdio)
 * and propagates the exit code. Lets you run the TypeScript without a build.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Project root: this file lives in <root>/bin/.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const result = spawnSync('npx', ['tsx', 'src/cli.ts', ...args], {
  cwd: projectRoot,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
