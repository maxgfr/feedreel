import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal logger: console + optional file (timestamped logs for the launchd job).
 * Set FEEDREEL_LOG_FILE to enable file writing.
 */

type Level = 'info' | 'warn' | 'error';

let fileStream: fs.WriteStream | null = null;
const logFile = process.env.FEEDREEL_LOG_FILE;
if (logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fileStream = fs.createWriteStream(logFile, { flags: 'a' });
}

function ts(): string {
  return new Date().toISOString();
}

function write(level: Level, scope: string, msg: string): void {
  const line = `${ts()} [${level.toUpperCase()}] ${scope ? `(${scope}) ` : ''}${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  fileStream?.write(line + '\n');
}

export function createLogger(scope = '') {
  return {
    info: (msg: string) => write('info', scope, msg),
    warn: (msg: string) => write('warn', scope, msg),
    error: (msg: string) => write('error', scope, msg),
    child: (sub: string) => createLogger(scope ? `${scope}:${sub}` : sub),
  };
}

export type Logger = ReturnType<typeof createLogger>;

export const log = createLogger();
