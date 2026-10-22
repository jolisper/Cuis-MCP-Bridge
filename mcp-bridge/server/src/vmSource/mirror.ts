/**
 * Local bare mirror of the VM source repository.
 *
 * On-disk layout under `home`:
 * - `vm-mirror/`          the finished bare clone; its presence means the mirror is ready.
 * - `vm-mirror.lock`      JSON `{pid, startTime}` of the process setting up the mirror; live only
 *                         while that pid runs with that `ps` start time, otherwise stale.
 * - `vm-mirror.tmp-<pid>` the in-progress clone; renamed to `vm-mirror/` on success.
 * - `vm-mirror.error`     JSON `{code, message}` of the last failed clone; consumed (reported
 *                         once) by the next `setupVmMirror` call.
 * - `vm-mirror.lock.<pid>.<uuid>` / `vm-mirror.lock.stale-<pid>.<uuid>` short-lived files used
 *                         to create and take over the lock atomically.
 */
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gitUnavailable, transferError, VmSourceError } from './errors.js';

const execFileP = promisify(execFile);

/** Termination signals that kill a running clone before this process exits. */
const KILL_ON_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

/** Number of trailing characters of a clone's stderr kept for the failure report. */
const MAX_CLONE_STDERR_CHARS = 65536;

/** Options locating the VM source mirror and the tools used to manage it. */
export interface MirrorOptions {
  home: string;
  upstreamUrl: string;
  git: string;
}

/** Path of the finished bare mirror under `home`. */
export function mirrorPath(home: string): string {
  return path.join(home, 'vm-mirror');
}

const TMP_MIRROR_PREFIX = 'vm-mirror.tmp-';

function tmpMirrorPath(home: string): string {
  return path.join(home, TMP_MIRROR_PREFIX + process.pid);
}

function lockPath(home: string): string {
  return path.join(home, 'vm-mirror.lock');
}

function errorPath(home: string): string {
  return path.join(home, 'vm-mirror.error');
}

/** Path of a sibling of `file` unique to this process and call, for atomic create/rename tricks. */
function uniqueSiblingPath(file: string): string {
  return file + '.' + process.pid + '.' + randomUUID();
}

function hasErrnoCode(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException).code === code;
}

/** Reports the current state of the VM source mirror under `opts.home`. */
export async function mirrorState(opts: MirrorOptions): Promise<'missing' | 'initializing' | 'ready'> {
  try {
    await fs.access(mirrorPath(opts.home));
    return 'ready';
  } catch {
    return (await isLockLive(opts.home)) ? 'initializing' : 'missing';
  }
}

/** Resolves `true` iff the lock under `home` exists and its recorded pid is running with the recorded start time. */
async function isLockLive(home: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(lockPath(home), 'utf8');
  } catch (err) {
    if (hasErrnoCode(err, 'ENOENT')) return false;
    throw err;
  }
  let parsed: { pid: number; startTime?: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  const { pid, startTime } = parsed;
  const actual = await processStartTime(pid);
  return actual !== undefined && actual === startTime;
}

/** Resolves the `ps` lstart of `pid` (C locale), or `undefined` if no such process runs. */
async function processStartTime(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('ps', ['-o', 'lstart=', '-p', String(pid)], {
      env: { ...process.env, LC_ALL: 'C' },
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Atomically creates the mirror lock under `home` by hard-linking a unique temp file to it.
 * Resolves `false` if the lock already exists.
 */
async function tryAcquireLock(home: string): Promise<boolean> {
  const lock = lockPath(home);
  const lockTemp = uniqueSiblingPath(lock);
  await fs.writeFile(lockTemp, await ownLockContent());
  try {
    await fs.link(lockTemp, lock);
    return true;
  } catch (err) {
    if (hasErrnoCode(err, 'EEXIST')) return false;
    throw err;
  } finally {
    await fs.unlink(lockTemp);
  }
}

/**
 * Removes the stale lock under `home` by renaming it aside and verifying its content is unchanged.
 * Resolves `false` (restoring the lock if needed) when another process acquired it in between.
 */
async function takeOverStaleLock(home: string): Promise<boolean> {
  const lock = lockPath(home);
  const aside = lock + '.stale-' + process.pid + '.' + randomUUID();
  let before: string;
  try {
    before = await fs.readFile(lock, 'utf8');
    await fs.rename(lock, aside);
  } catch (err) {
    if (hasErrnoCode(err, 'ENOENT')) return false;
    throw err;
  }
  if ((await fs.readFile(aside, 'utf8')) === before) {
    await fs.unlink(aside);
    return true;
  }
  await fs.link(aside, lock).catch((err) => {
    if (!hasErrnoCode(err, 'EEXIST')) throw err;
  });
  await fs.unlink(aside);
  return false;
}

/**
 * Acquires the mirror lock under `home`, taking over a stale (not live) lock once.
 * Resolves `false` if the lock is live or another process wins the race.
 */
async function acquireLock(home: string): Promise<boolean> {
  if (await tryAcquireLock(home)) return true;
  if (await isLockLive(home)) return false;
  if (!(await takeOverStaleLock(home))) return false;
  return tryAcquireLock(home);
}

let ownLockContentP: Promise<string> | undefined;

/** Resolves the lock content this process writes; cached since pid and start time never change. */
function ownLockContent(): Promise<string> {
  ownLockContentP ??= processStartTime(process.pid).then((startTime) =>
    JSON.stringify({ pid: process.pid, startTime }),
  );
  return ownLockContentP;
}

/** Unlinks the lock under `home` only if it still holds this process's content. */
async function releaseLock(home: string): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(lockPath(home), 'utf8');
  } catch (err) {
    if (hasErrnoCode(err, 'ENOENT')) return;
    throw err;
  }
  if (content === (await ownLockContent())) await fs.unlink(lockPath(home));
}

const WRITE_FAILURE_CODES = ['EACCES', 'ENOSPC', 'EROFS'];

/** Runs `fn`, rethrowing an EACCES/ENOSPC/EROFS fs error as `mirror_write_failed`; other errors pass unchanged. */
async function mapWriteFailure<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== undefined && WRITE_FAILURE_CODES.includes(code)) {
      throw new VmSourceError('mirror_write_failed', (err as Error).message);
    }
    throw err;
  }
}

/**
 * Ensures the VM source mirror under `opts.home` is set up, creating `opts.home` if needed.
 * If neither ready nor initializing, first throws (once) the error recorded by a previous failed
 * clone, if any (see `consumeErrorFile`). Returns `'ready'` if the mirror exists (also re-checked after acquiring the lock, in which
 * case the lock is released), `'in_progress'` if a live lock is held elsewhere or the lock
 * race is lost, or `'started'` after acquiring the lock, probing `opts.git --version`, removing
 * leftover `vm-mirror.tmp-*` dirs, and launching a background clone (see `startClone`).
 * Throws `git_unavailable` (releasing the lock) if the git probe fails, and `mirror_write_failed`
 * (with the errno message) if creating `opts.home` or writing the lock fails with EACCES, ENOSPC or EROFS.
 */
export async function setupVmMirror(opts: MirrorOptions): Promise<'ready' | 'in_progress' | 'started'> {
  const state = await mirrorState(opts);
  if (state === 'ready') return 'ready';
  if (state === 'initializing') return 'in_progress';
  await consumeErrorFile(opts.home);
  const acquired = await mapWriteFailure(async () => {
    await fs.mkdir(opts.home, { recursive: true });
    return acquireLock(opts.home);
  });
  if (!acquired) return 'in_progress';
  if ((await mirrorState(opts)) === 'ready') {
    await releaseLock(opts.home);
    return 'ready';
  }
  try {
    await execFileP(opts.git, ['--version']);
  } catch (err) {
    await releaseLock(opts.home);
    throw gitUnavailable((err as Error).message);
  }
  for (const name of await fs.readdir(opts.home)) {
    if (name.startsWith(TMP_MIRROR_PREFIX)) {
      await fs.rm(path.join(opts.home, name), { recursive: true, force: true });
    }
  }
  startClone(opts);
  return 'started';
}

/**
 * Spawns `git clone --bare` of `opts.upstreamUrl` into the pid-suffixed temp dir without awaiting it.
 * The first of `error` / `close` settles it exactly once: exit 0 finishes the clone, anything else
 * (including a spawn `error`, recorded as `mirror_write_failed`) abandons it. The child is killed if this process exits first, or gets one of `KILL_ON_SIGNALS`
 * (which, unhandled, would end it without emitting `exit`); it then exits with 128 + signo.
 * Only the last `MAX_CLONE_STDERR_CHARS` characters of the clone's stderr are kept for the failure report.
 */
function startClone(opts: MirrorOptions): void {
  const tmp = tmpMirrorPath(opts.home);
  const child = spawn(opts.git, ['clone', '--bare', '--quiet', opts.upstreamUrl, tmp], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-MAX_CLONE_STDERR_CHARS);
  });
  const onExit = () => child.kill();
  const onSignal = (signal: NodeJS.Signals) => {
    child.kill();
    process.exit(128 + os.constants.signals[signal]);
  };
  process.once('exit', onExit);
  for (const signal of KILL_ON_SIGNALS) process.once(signal, onSignal);
  let settled = false;
  /** Finishes the clone when `failure` is undefined, otherwise abandons it recording `failure`. */
  const settle = (failure?: VmSourceError) => {
    if (settled) return;
    settled = true;
    process.off('exit', onExit);
    for (const signal of KILL_ON_SIGNALS) process.off(signal, onSignal);
    if (failure === undefined) finishClone(opts.home, tmp);
    else abandonClone(opts.home, tmp, failure);
  };
  child.on('error', (err) => settle(new VmSourceError('mirror_write_failed', err.message)));
  child.on('close', (code) => settle(code === 0 ? undefined : transferError(stderr)));
}

/**
 * Records `failure` (the classified git stderr, or `mirror_write_failed` with the message of a
 * spawn error) in the error file, removes the failed clone's `tmp` dir, then releases
 * the lock. Errors are ignored.
 */
function abandonClone(home: string, tmp: string, failure: VmSourceError): void {
  writeErrorFile(home, failure)
    .then(() => fs.rm(tmp, { recursive: true, force: true }))
    .then(() => releaseLock(home))
    .catch(() => {});
}

/** Writes `failure` as JSON `{code, message}` to the error file via a unique temp file. */
async function writeErrorFile(home: string, failure: VmSourceError): Promise<void> {
  const { code, message } = failure;
  const errorTemp = uniqueSiblingPath(errorPath(home));
  await fs.writeFile(errorTemp, JSON.stringify({ code, message }));
  await fs.rename(errorTemp, errorPath(home));
}

/** Renames the error file aside, reads and unlinks it, and throws it; resolves if there is none. */
async function consumeErrorFile(home: string): Promise<void> {
  const aside = uniqueSiblingPath(errorPath(home));
  try {
    await fs.rename(errorPath(home), aside);
  } catch (err) {
    if (hasErrnoCode(err, 'ENOENT')) return;
    throw err;
  }
  const { code, message } = JSON.parse(await fs.readFile(aside, 'utf8'));
  await fs.unlink(aside);
  throw new VmSourceError(code, message);
}

/** Renames the finished clone at `tmp` into place, then releases the lock. Errors are ignored. */
function finishClone(home: string, tmp: string): void {
  fs.rename(tmp, mirrorPath(home))
    .then(() => releaseLock(home))
    .catch(() => {});
}
