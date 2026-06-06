import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** stdin to write to the process. */
  input?: string;
  /** timeout (ms) before kill. */
  timeoutMs?: number;
  /** additional environment variables. */
  env?: Record<string, string>;
  /** working directory. */
  cwd?: string;
}

/**
 * Runs a command and captures stdout/stderr.
 * Never throws on a non-zero exit code — the caller inspects `code`.
 * Throws only if the binary is not found / killed by timeout.
 */
export function exec(
  cmd: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Timeout (${opts.timeoutMs}ms): ${cmd} ${args.join(' ')}`));
      }, opts.timeoutMs);
    }

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });

    // Error handler on stdin BEFORE any write: if the child closes/exits
    // before reading the input (e.g. killed by timeout), Node emits 'error'
    // (EPIPE) on the stream. Without this handler it becomes an uncaught
    // exception that kills the whole process. Ignored here: the failure is
    // already reflected by the exit code/stderr.
    child.stdin.on('error', () => {
      /* EPIPE / write-after-end: intentionally ignored (see above). */
    });
    child.stdin.end(opts.input ?? undefined);
  });
}

/** Like exec, but throws if the exit code is not 0. */
export async function execOrThrow(
  cmd: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const res = await exec(cmd, args, opts);
  if (res.code !== 0) {
    throw new Error(
      `Failed (${res.code}): ${cmd} ${args.join(' ')}\n${res.stderr || res.stdout}`,
    );
  }
  return res;
}
