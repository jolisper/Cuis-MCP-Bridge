/**
 * Runs git commands against the local bare VM source mirror.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitUnavailable, VmSourceError } from './errors.js';
import { mirrorPath, type MirrorOptions } from './mirror.js';

const execFileP = promisify(execFile);

/** Large enough for whole generated VM sources such as `cointerp.c` (~75k lines). */
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Runs `opts.git` with `args` against the mirror via `--git-dir` and resolves to its stdout.
 * The child inherits `process.env` plus `LC_ALL=C` (stable, parseable messages) and
 * `GIT_TERMINAL_PROMPT=0` (never block on a credential prompt). When the git binary does not
 * exist (ENOENT) or is not executable (EACCES) rejects with a `git_unavailable` `VmSourceError`
 * naming the cause. When git itself reported the failure (numeric exit status) rejects with an
 * `Error` whose message is the trimmed stderr (or, when that is empty, the original error's
 * message), whose `stderr` property holds stderr verbatim (`''` when absent), and whose numeric
 * `exitCode` property is git's exit status. Any other failure (killed by a signal, another spawn
 * errno, `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`) rejects with an `internal_error` `VmSourceError`
 * naming the signal or code and the original error's message.
 */
export async function runGit(opts: MirrorOptions, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP(opts.git, ['--git-dir=' + mirrorPath(opts.home), ...args], {
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (e) {
    const err = e as Error & { stderr?: string; code?: unknown; signal?: string | null };
    if (err.code === 'ENOENT' || err.code === 'EACCES') throw gitUnavailable(err.message);
    if (typeof err.code !== 'number') {
      throw new VmSourceError('internal_error', `git failed (${err.signal ?? err.code}): ${err.message}`);
    }
    const stderr = err.stderr ?? '';
    throw Object.assign(new Error(stderr.trim() || err.message), { stderr, exitCode: err.code });
  }
}

/**
 * Runs a read-only git command against the mirror via `runGit` and resolves to its stdout.
 * When git reports a failure rejects with a `mirror_corrupt` `VmSourceError` naming the mirror
 * path, git's message, and `setup_vm_mirror` as the recovery. A `VmSourceError` from `runGit`
 * (`git_unavailable`, `internal_error`) is rethrown unchanged.
 */
export async function readGit(opts: MirrorOptions, args: string[]): Promise<string> {
  try {
    return await runGit(opts, args);
  } catch (e) {
    throw asMirrorError(opts, e);
  }
}

/**
 * Like `readGit` for a quiet probe such as `git grep -q`: resolves to true when git exits 0 and to
 * false when it exits 1 with empty stderr (no match, not an error). Any other failure is rejected
 * exactly as `readGit` does.
 */
export async function probeGit(opts: MirrorOptions, args: string[]): Promise<boolean> {
  try {
    await runGit(opts, args);
    return true;
  } catch (e) {
    const err = e as { exitCode?: number; stderr?: string };
    if (!(e instanceof VmSourceError) && err.exitCode === 1 && !err.stderr?.trim()) return false;
    throw asMirrorError(opts, e);
  }
}

/** Maps a `runGit` rejection to `mirror_corrupt`, passing a `VmSourceError` through unchanged. */
export function asMirrorError(opts: MirrorOptions, e: unknown): unknown {
  if (e instanceof VmSourceError) return e;
  const err = e as Error;
  return new VmSourceError(
    'mirror_corrupt',
    `the VM source mirror at ${mirrorPath(opts.home)} can't be read as a git repository (${err.message}); delete it and call setup_vm_mirror again`,
  );
}

/** True when git `stderr` reports index-lock or ref-lock contention. */
export function isLockContention(stderr: string): boolean {
  return /Unable to create '.*\.lock'|cannot lock ref/.test(stderr);
}
