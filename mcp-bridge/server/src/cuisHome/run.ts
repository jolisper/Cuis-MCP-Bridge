/**
 * Runs a Smalltalk script headlessly on the shared Cuis installation (see cuisHome.ts).
 *
 * Checks, in order, each failing with a `HeadlessError`:
 * 1. platform is macOS (`unsupported_platform`);
 * 2. setup status: `preparing` (`cuis_initializing`), `missing` or `failed` (`cuis_missing`);
 * 3. the ready setup still has all its required parts (`cuis_corrupt`).
 * Only then is the script run, against the pristine image in `base` and the VM in `dist`.
 *
 * This module never fetches or prepares anything: an unready setup is reported, not repaired.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CUIS_CHANGES_FILE, CUIS_IMAGE_FILE, CUIS_SOURCES_FILE, CUIS_VM_PATH } from './pin.js';
import {
  BASE_DIR,
  cuisHomeStatus,
  DIST_DIR,
  layoutDir,
  MACOS_ONLY_MESSAGE,
  type CuisHomeOptions,
} from './cuisHome.js';
import { HeadlessError } from './errors.js';
import { USER_CHANGES_DIR } from './userChanges.js';
import { runHeadless, type RunHeadlessResult } from './runner.js';

/** Paths, relative to the setup directory, that a ready setup must contain. */
const REQUIRED_PARTS = [
  path.join(DIST_DIR, CUIS_VM_PATH),
  path.join(BASE_DIR, CUIS_IMAGE_FILE),
  path.join(BASE_DIR, CUIS_SOURCES_FILE),
  path.join(BASE_DIR, CUIS_CHANGES_FILE),
];

/** Throws `cuis_corrupt` naming the first required part missing from the setup directory. */
async function assertSetupIntact(setupDir: string): Promise<void> {
  for (const part of REQUIRED_PARTS) {
    try {
      await fs.access(path.join(setupDir, part));
    } catch {
      throw new HeadlessError(
        'cuis_corrupt',
        `The shared Cuis at ${setupDir} is damaged: ${part} is missing; delete that directory and prepare it again`,
      );
    }
  }
}

/**
 * The real Cuis VM runs with cwd = dist and writes its user changes files into this
 * directory there; runs leave no trace: entries created by a run are removed afterwards, and
 * the directory itself too if it did not exist before the run.
 */

/** Names in `dir`, or an empty list if it cannot be read (e.g. it does not exist). */
async function listEntries(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/** Best-effort: removes entries of `dir` not in `keep`, ignoring all errors. */
async function removeNewEntries(dir: string, keep: string[]): Promise<void> {
  try {
    for (const entry of await listEntries(dir)) {
      if (!keep.includes(entry)) {
        await fs.rm(path.join(dir, entry), { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {
    // best effort
  }
}

export async function runWithSharedCuis(
  opts: CuisHomeOptions,
  run: { scriptPath: string; timeoutMs: number; signal?: AbortSignal; cwd?: string },
): Promise<RunHeadlessResult> {
  if ((opts.platform ?? process.platform) !== 'darwin') {
    throw new HeadlessError('unsupported_platform', MACOS_ONLY_MESSAGE);
  }
  const status = await cuisHomeStatus(opts);
  if (status.state === 'preparing') {
    throw new HeadlessError(
      'cuis_initializing',
      'The shared Cuis is still being prepared; retry shortly',
    );
  }
  if (status.state === 'missing') {
    throw new HeadlessError(
      'cuis_missing',
      'The shared Cuis is not installed; prepare it first',
    );
  }
  if (status.state === 'failed') {
    throw new HeadlessError(
      'cuis_missing',
      `The shared Cuis is not installed; preparation failed (${status.error.code}: ${status.error.message}); prepare it again`,
    );
  }
  const setupDir = layoutDir(opts);
  await assertSetupIntact(setupDir);
  const cuisDir = path.join(setupDir, DIST_DIR);
  const userChangesDir = path.join(cuisDir, USER_CHANGES_DIR);
  const preExisting = await listEntries(userChangesDir);
  const existedBefore = await fs.access(userChangesDir).then(() => true, () => false);
  try {
    return await runHeadless({
      cuisDir,
      baseDir: path.join(setupDir, BASE_DIR),
      scriptPath: run.scriptPath,
      timeoutMs: run.timeoutMs,
      signal: run.signal,
      cwd: run.cwd,
    });
  } finally {
    if (existedBefore) {
      await removeNewEntries(userChangesDir, preExisting);
    } else {
      await fs.rm(userChangesDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
