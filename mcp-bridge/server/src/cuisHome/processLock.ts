/**
 * Cross-process lock backed by a file.
 *
 * Lock file format: JSON `{pid, startTime}` of the owning process, where `startTime` is the
 * `ps` lstart of that pid. A lock is live only while that pid runs with that exact start time;
 * a dead pid, or a recycled pid with a different start time, makes the lock stale.
 *
 * Taking over a stale lock is serialized through an exclusive `<lockFile>.takeover` marker
 * (same JSON format, plus a random token). A rename-aside takeover (move the stale lock away,
 * then create a new one) could let two callers both win: the second caller could rename away
 * the first caller's freshly created lock. Holding the marker lets only one caller at a time
 * inspect, remove and recreate the lock.
 *
 * Files are created atomically by writing a unique `<file>.<pid>.<uuid>` temp file and
 * hard-linking it to the target, which fails with EEXIST if the target already exists.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** `true` iff `err` is a Node system error with the given errno `code` (e.g. `ENOENT`). */
function hasErrnoCode(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException).code === code;
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

/** The `{pid, startTime}` JSON identifying this process as a lock owner. */
async function ownLockContent(): Promise<string> {
  return JSON.stringify({
    pid: process.pid,
    startTime: await processStartTime(process.pid),
  });
}

/** Atomically creates `file` holding `content`; `false` if it exists. */
async function createExclusive(file: string, content: string): Promise<boolean> {
  const temp = `${file}.${process.pid}.${randomUUID()}`;
  await fs.writeFile(temp, content);
  try {
    await fs.link(temp, file);
    return true;
  } catch (err) {
    if (hasErrnoCode(err, 'EEXIST')) return false;
    throw err;
  } finally {
    await fs.unlink(temp);
  }
}

/** Resolves `true` iff `lockFile` exists and its recorded pid is running with the recorded start time. */
export async function isLockLive(lockFile: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(lockFile, 'utf8');
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

/** Serializes takeovers through an exclusive `<lockFile>.takeover` marker; `false` if another takeover is in progress. */
async function takeOverStaleLock(lockFile: string): Promise<boolean> {
  const marker = `${lockFile}.takeover`;
  const token = JSON.stringify({
    pid: process.pid,
    startTime: await processStartTime(process.pid),
    token: randomUUID(),
  });
  if (!(await createExclusive(marker, token))) {
    if (!(await isLockLive(marker))) await fs.unlink(marker).catch(() => {});
    return false;
  }
  try {
    if (await isLockLive(lockFile)) return false;
    await fs.unlink(lockFile).catch((err) => {
      if (!hasErrnoCode(err, 'ENOENT')) throw err;
    });
    return await createExclusive(lockFile, await ownLockContent());
  } finally {
    if ((await fs.readFile(marker, 'utf8').catch(() => undefined)) === token) {
      await fs.unlink(marker).catch(() => {});
    }
  }
}

/** Acquires `lockFile`, taking over a stale (not live) lock once; `false` if live or the race is lost. */
export async function acquireLock(lockFile: string): Promise<boolean> {
  if (await createExclusive(lockFile, await ownLockContent())) return true;
  if (await isLockLive(lockFile)) return false;
  return takeOverStaleLock(lockFile);
}

/** Removes `lockFile` only if it holds this process's own lock content; missing file is a no-op. */
export async function releaseLock(lockFile: string): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(lockFile, 'utf8');
  } catch (err) {
    if (hasErrnoCode(err, 'ENOENT')) return;
    throw err;
  }
  if (content === (await ownLockContent())) await fs.unlink(lockFile);
}
