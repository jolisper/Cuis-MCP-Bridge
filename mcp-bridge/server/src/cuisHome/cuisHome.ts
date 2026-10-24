/**
 * Shared Cuis installation, downloaded and prepared once per user.
 *
 * On-disk layout under `home`:
 * - `cuis/<key>/dist`        the extracted Cuis distribution (VM, packages, image directory).
 * - `cuis/<key>/base`        the pristine image, sources and changes files, copied from `dist`.
 *                            `cuis/<key>/` existing means the setup is ready.
 * - `cuis/<key>.lock`        the lock held by the process preparing the setup (see processLock).
 * - `cuis/<key>.tmp-<pid>`   the in-progress setup; renamed to `cuis/<key>/` on success.
 * - `cuis/<key>.error`       JSON `{code, message}` of the last failed preparation; cleared when
 *                            the next preparation starts.
 *
 * Status precedence: ready (directory present, no live lock) > preparing (live lock) >
 * failed (error file) > missing. The lock is released last, after the temporary directory is gone.
 */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { HeadlessError } from './errors.js';
import {
  CUIS_ARCHIVE_SHA256,
  CUIS_ARCHIVE_TOP_DIR,
  CUIS_ARCHIVE_URL,
  CUIS_CHANGES_FILE,
  CUIS_IMAGE_DIR,
  CUIS_IMAGE_FILE,
  CUIS_LAYOUT_KEY,
  CUIS_SOURCES_FILE,
} from './pin.js';
import { acquireLock, isLockLive, releaseLock } from './processLock.js';
import { runHeadless } from './runner.js';
import { USER_CHANGES_DIR } from './userChanges.js';

const execFileP = promisify(execFile);

/** Unzip executable used when `unzip` is not given in the options. */
const DEFAULT_UNZIP = '/usr/bin/unzip';

/** Time allowed for the smoke boot of the freshly built base image. */
const DEFAULT_SMOKE_TIMEOUT_MS = 120000;

/**
 * Script the smoke boot runs: prints the success marker (newLine flushes it) and quits. A headless
 * Cuis keeps Transcript output in memory unless logToStdout is enabled, so the script enables it
 * first (as mcp-bridge/image/run-tests.st does).
 */
const SMOKE_SCRIPT =
  "Transcript logToStdout: true. Transcript show: 'DONE exitCode=0'; newLine. Smalltalk quitPrimitive: 0\n";

/** File and directory names inside the in-progress setup directory. */
const ARCHIVE_FILE = 'archive.zip';
const EXTRACT_DIR = 'extract';
export const DIST_DIR = 'dist';
export const BASE_DIR = 'base';
const SMOKE_SCRIPT_FILE = 'smoke.st';

/** Image files copied from the distribution into the base directory. */
const BASE_IMAGE_FILES = [CUIS_IMAGE_FILE, CUIS_SOURCES_FILE, CUIS_CHANGES_FILE];

/** Filesystem error codes reported as `cuis_write_failed`. */
const WRITE_FAILURE_CODES = ['EACCES', 'ENOSPC', 'EROFS', 'ENOENT', 'EPERM', 'ENOTDIR'];

/** Message of the `unsupported_platform` error raised on anything but macOS. */
export const MACOS_ONLY_MESSAGE = 'Cuis shared setup needs macOS';

/** Options locating the shared Cuis setup and overriding the pinned download for tests. */
export interface CuisHomeOptions {
  home?: string;
  platform?: NodeJS.Platform;
  archiveUrl?: string;
  archiveSha256?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  unzip?: string;
  smokeTimeoutMs?: number;
}

/** State of the shared Cuis setup. */
export type CuisHomeStatus =
  | { state: 'missing' }
  | { state: 'preparing' }
  | { state: 'ready' }
  | { state: 'failed'; error: { code: string; message: string } };

/** Default `home` directory when none is given. */
export function defaultHome(): string {
  return path.join(os.homedir(), '.cuis-mcp-bridge');
}

/** Path of the finished setup directory (`cuis/<key>`). */
export function layoutDir(opts: CuisHomeOptions): string {
  return path.join(opts.home ?? defaultHome(), 'cuis', opts.key ?? CUIS_LAYOUT_KEY);
}

/** Path of the lock held while the setup is being prepared. */
export function lockPath(opts: CuisHomeOptions): string {
  return `${layoutDir(opts)}.lock`;
}

/** Path of the record of the last failed preparation. */
export function errorPath(opts: CuisHomeOptions): string {
  return `${layoutDir(opts)}.error`;
}

/** Path of the in-progress setup of this process. */
export function tmpPath(opts: CuisHomeOptions): string {
  return `${layoutDir(opts)}.tmp-${process.pid}`;
}

/** Reports the state of the setup: ready, preparing, failed (with the recorded error) or missing. */
export async function cuisHomeStatus(opts: CuisHomeOptions = {}): Promise<CuisHomeStatus> {
  try {
    const stat = await fs.stat(layoutDir(opts));
    if (stat.isDirectory()) {
      return (await isLockLive(lockPath(opts))) ? { state: 'preparing' } : { state: 'ready' };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (await isLockLive(lockPath(opts))) return { state: 'preparing' };
  let raw: string;
  try {
    raw = await fs.readFile(errorPath(opts), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' };
    return unreadableErrorFile();
  }
  try {
    const parsed = JSON.parse(raw) as { code: string; message: string };
    return { state: 'failed', error: { code: parsed.code, message: parsed.message } };
  } catch {
    return unreadableErrorFile();
  }
}

/**
 * Starts preparing the setup in the background unless it is ready or another process is already
 * preparing it. Returns `started` once this process holds the lock; the outcome is then visible
 * through `cuisHomeStatus`.
 */
export async function prepareCuisHome(
  opts: CuisHomeOptions,
): Promise<'ready' | 'in_progress' | 'started'> {
  if ((opts.platform ?? process.platform) !== 'darwin') {
    throw new HeadlessError('unsupported_platform', MACOS_ONLY_MESSAGE);
  }
  try {
    await fs.mkdir(path.dirname(layoutDir(opts)), { recursive: true });
    if (await exists(layoutDir(opts))) return 'ready';
    if (!(await acquireLock(lockPath(opts)))) return 'in_progress';
    await fs.rm(errorPath(opts), { force: true });
    await removeLeftoverTmpDirs(opts);
  } catch (err) {
    throw toWriteFailure(err);
  }
  void prepareInBackground(opts).catch(() => {
    // Failures are recorded inside prepareInBackground; this guards cleanup errors.
  });
  return 'started';
}

/** Removes in-progress directories left behind by earlier (crashed) preparations. */
async function removeLeftoverTmpDirs(opts: CuisHomeOptions): Promise<void> {
  const cuisDir = path.dirname(layoutDir(opts));
  const prefix = `${path.basename(layoutDir(opts))}.tmp-`;
  for (const name of await fs.readdir(cuisDir)) {
    if (name.startsWith(prefix)) await fs.rm(path.join(cuisDir, name), { recursive: true, force: true });
  }
}

/** Maps filesystem errors to `cuis_write_failed`; other errors pass through unchanged. */
function toWriteFailure(err: unknown): unknown {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (!(err instanceof HeadlessError) && code !== undefined && WRITE_FAILURE_CODES.includes(code)) {
    return new HeadlessError('cuis_write_failed', (err as Error).message);
  }
  return err;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the setup in a temporary directory and publishes it by renaming it to the final path.
 * Any failure is recorded in the error file. The temporary directory is always removed and the
 * lock is released last.
 */
async function prepareInBackground(opts: CuisHomeOptions): Promise<void> {
  const tmp = tmpPath(opts);
  try {
    await fs.mkdir(tmp, { recursive: true });
    const archive = path.join(tmp, ARCHIVE_FILE);
    const extractDir = path.join(tmp, EXTRACT_DIR);
    const dist = path.join(tmp, DIST_DIR);
    const base = path.join(tmp, BASE_DIR);
    const scriptPath = path.join(tmp, SMOKE_SCRIPT_FILE);

    await fetchArchive(opts, archive);
    await extractDistribution(opts, archive, extractDir, dist);
    await buildBase(dist, base);
    await smokeBoot(opts, dist, base, scriptPath);
    await publish(opts, tmp, [archive, extractDir, scriptPath]);
  } catch (err) {
    await recordFailure(opts, toWriteFailure(err));
  } finally {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } finally {
      await releaseLock(lockPath(opts));
    }
  }
}

/** Unzips `archive` into `extractDir` and moves its top-level directory to `dist`. */
async function extractDistribution(
  opts: CuisHomeOptions,
  archive: string,
  extractDir: string,
  dist: string,
): Promise<void> {
  try {
    await execFileP(opts.unzip ?? DEFAULT_UNZIP, ['-q', archive, '-d', extractDir]);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    throw new HeadlessError(
      'cuis_write_failed',
      `Could not unzip ${archive}: ${(err as Error).message}${stderr ? `\n${stderr}` : ''}`,
    );
  }
  await fs.rename(await topLevelDir(extractDir), dist);
}

/** Copies the pristine image files from `dist` into a new `base` directory. */
async function buildBase(dist: string, base: string): Promise<void> {
  await fs.mkdir(base);
  for (const name of BASE_IMAGE_FILES) {
    await fs.copyFile(path.join(dist, CUIS_IMAGE_DIR, name), path.join(base, name));
  }
}

/** Boots the base image headlessly once to prove it works. */
async function smokeBoot(
  opts: CuisHomeOptions,
  dist: string,
  base: string,
  scriptPath: string,
): Promise<void> {
  await fs.writeFile(scriptPath, SMOKE_SCRIPT);
  const result = await runHeadless({
    cuisDir: dist,
    baseDir: base,
    scriptPath,
    timeoutMs: opts.smokeTimeoutMs ?? DEFAULT_SMOKE_TIMEOUT_MS,
  });
  if (result.outcome !== 'passed') {
    throw new HeadlessError('cuis_base_build_failed', result.output);
  }
  await fs.rm(path.join(dist, USER_CHANGES_DIR), { recursive: true, force: true }).catch(() => {});
}

/** Removes the build leftovers and renames the temporary directory to the final path. */
async function publish(opts: CuisHomeOptions, tmp: string, leftovers: string[]): Promise<void> {
  for (const leftover of leftovers) {
    await fs.rm(leftover, { recursive: true, force: true });
  }
  await fs.rename(tmp, layoutDir(opts));
}

/** Records `err` in the error file, written atomically; a failure to record is ignored. */
async function recordFailure(opts: CuisHomeOptions, err: unknown): Promise<void> {
  const error =
    err instanceof HeadlessError
      ? { code: err.code, message: err.message }
      : { code: 'internal_error', message: err instanceof Error ? err.message : String(err) };
  const target = errorPath(opts);
  const tempFile = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(tempFile, JSON.stringify(error));
    await fs.rename(tempFile, target);
  } catch {
    await fs.rm(tempFile, { force: true }).catch(() => {});
  }
}

/** Downloads the archive to `archive`, failing with `cuis_checksum_mismatch` if its SHA-256 differs. */
async function fetchArchive(opts: CuisHomeOptions, archive: string): Promise<void> {
  const url = opts.archiveUrl ?? CUIS_ARCHIVE_URL;
  const fetchFailed = (cause: unknown): HeadlessError =>
    new HeadlessError(
      'cuis_fetch_failed',
      `Could not download ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  let response: Response;
  try {
    response = await (opts.fetchImpl ?? fetch)(url);
  } catch (err) {
    throw fetchFailed(err);
  }
  if (!response.ok) throw fetchFailed(`HTTP status ${response.status}`);
  if (!response.body) throw fetchFailed('response has no body');
  const hash = createHash('sha256');
  // The whole archive (~30 MB) is buffered on purpose: pausing the body can crash undici.
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      hash.update(next.value);
      chunks.push(next.value);
    }
  } catch (err) {
    throw fetchFailed(err);
  }
  await fs.writeFile(archive, Buffer.concat(chunks));
  const actual = hash.digest('hex');
  const expected = opts.archiveSha256 ?? CUIS_ARCHIVE_SHA256;
  if (actual !== expected) {
    throw new HeadlessError('cuis_checksum_mismatch', `expected ${expected}, got ${actual}`);
  }
}

/** The directory the archive extracts to: the pinned top directory, else the first directory. */
async function topLevelDir(extractDir: string): Promise<string> {
  const preferred = path.join(extractDir, CUIS_ARCHIVE_TOP_DIR);
  if (await exists(preferred)) return preferred;
  const dirs = (await fs.readdir(extractDir, { withFileTypes: true })).filter((e) => e.isDirectory());
  return path.join(extractDir, dirs[0].name);
}

function unreadableErrorFile(): CuisHomeStatus {
  return {
    state: 'failed',
    error: { code: 'internal_error', message: 'The error file is unreadable' },
  };
}
