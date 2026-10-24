/**
 * Headless runner for Cuis scripts.
 *
 * Each run works on a throwaway copy of the base directory (`cuis-run-*` under the OS temp dir), so
 * the base image is never modified. The VM's combined stdout/stderr goes to `cuis-run.log` next to
 * the copied image, and is returned as the run's output.
 *
 * A script signals that it ran to completion by printing a line containing `DONE exitCode=`;
 * the VM's exit status alone is not trusted, since a crash can also exit non-zero.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CUIS_VM_PATH } from './pin.js';

/** Exit code reported when the run could not start (missing script, VM or image). */
const SETUP_ERROR_EXIT_CODE = 2;

/** Exit code reported when the run timed out, was aborted, or died without the DONE marker. */
const TIMEOUT_OR_CRASH_EXIT_CODE = 124;

/** Prefix of the scratch directory each run executes in. */
const SCRATCH_DIR_PREFIX = 'cuis-run-';

/** Name of the log file, inside the scratch directory, capturing the VM's output. */
const RUN_LOG_FILE = 'cuis-run.log';

/** Line the script prints, possibly after a Transcript timestamp prefix, once it has run to completion. */
const DONE_MARKER = /DONE exitCode=/;

/** Options for a headless run. `vm` defaults to the pinned VM under `cuisDir`; `cwd` to `cuisDir`. */
export interface RunHeadlessOptions {
  cuisDir: string;
  baseDir: string;
  scriptPath: string;
  timeoutMs: number;
  cwd?: string;
  vm?: string;
  signal?: AbortSignal;
}

/**
 * Result of a headless run.
 * - `passed`           exit 0 and DONE marker printed.
 * - `failed`           non-zero exit with DONE marker printed; `exitCode` is the VM's.
 * - `timeout_or_crash` timed out, aborted, killed, or exited without the DONE marker (exit 124).
 * - `setup_error`      script, VM or image missing (exit 2); nothing was run.
 */
export interface RunHeadlessResult {
  outcome: 'passed' | 'failed' | 'timeout_or_crash' | 'setup_error';
  exitCode: number;
  output: string;
}

function setupError(output: string): RunHeadlessResult {
  return { outcome: 'setup_error', exitCode: SETUP_ERROR_EXIT_CODE, output };
}

/**
 * Runs `scriptPath` in the VM against a scratch copy of `baseDir`, then removes the copy.
 * Never rejects for setup problems; those come back as a `setup_error` result.
 */
export async function runHeadless(opts: RunHeadlessOptions): Promise<RunHeadlessResult> {
  // The VM runs with a different cwd, so a relative script path must be resolved against ours first.
  const scriptPath = resolve(opts.scriptPath);
  try {
    await fs.access(scriptPath);
  } catch {
    return setupError(`Script not found: ${scriptPath}`);
  }
  const vm = opts.vm ?? join(opts.cuisDir, CUIS_VM_PATH);
  try {
    await fs.access(vm);
  } catch {
    return setupError(`VM not found: ${vm}`);
  }
  let entries: string[];
  try {
    entries = await fs.readdir(opts.baseDir);
  } catch {
    entries = [];
  }
  const imageName = entries.find((e) => e.endsWith('.image'));
  if (imageName === undefined) {
    return setupError(`No .image file found in: ${opts.baseDir}`);
  }
  const scratch = await fs.mkdtemp(join(tmpdir(), SCRATCH_DIR_PREFIX));
  try {
    await fs.cp(opts.baseDir, scratch, { recursive: true });
    return await runOnScratch({ ...opts, scriptPath }, vm, join(scratch, imageName));
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

/** Spawns the VM on the scratch `image`, logging its output next to the image, and awaits the result. */
async function runOnScratch(
  opts: RunHeadlessOptions,
  vm: string,
  image: string,
): Promise<RunHeadlessResult> {
  const logPath = join(dirname(image), RUN_LOG_FILE);
  const log = await fs.open(logPath, 'a');
  try {
    const child = spawn(vm, ['-headless', image, '-s', opts.scriptPath], {
      cwd: opts.cwd ?? opts.cuisDir,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    return await waitAndMap(opts, child, () => fs.readFile(logPath, 'utf8'));
  } finally {
    await log.close();
  }
}

/**
 * Waits for `child` to close, or for the timeout / abort signal to kill its process group, then
 * maps the exit status and the output (read via `readOutput`) to a result.
 */
async function waitAndMap(
  opts: RunHeadlessOptions,
  child: ChildProcess,
  readOutput: () => Promise<string>,
): Promise<RunHeadlessResult> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const status = await Promise.race([
    new Promise<number | null>((resolve) => child.on('close', resolve)),
    new Promise<'timeout'>((resolve) => {
      const kill = () => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          // already gone
        }
        resolve('timeout');
      };
      timer = setTimeout(kill, opts.timeoutMs);
      if (opts.signal) {
        if (opts.signal.aborted) {
          kill();
        } else {
          onAbort = kill;
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }
      }
    }),
  ]);
  clearTimeout(timer);
  if (onAbort) opts.signal!.removeEventListener('abort', onAbort);
  const output = await readOutput();
  if (typeof status === 'number' && DONE_MARKER.test(output)) {
    return status === 0
      ? { outcome: 'passed', exitCode: 0, output }
      : { outcome: 'failed', exitCode: status, output };
  }
  return { outcome: 'timeout_or_crash', exitCode: TIMEOUT_OR_CRASH_EXIT_CODE, output };
}
