import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_DIR,
  cuisHomeStatus,
  DIST_DIR,
  errorPath,
  layoutDir,
  lockPath,
  prepareCuisHome,
} from './cuisHome.js';
import { HeadlessError } from './errors.js';
import { CUIS_CHANGES_FILE, CUIS_IMAGE_FILE, CUIS_SOURCES_FILE, CUIS_VM_PATH } from './pin.js';
import { acquireLock } from './processLock.js';
import { runWithSharedCuis } from './run.js';
import { startArchiveServer } from './testSupport/archiveServer.js';
import { buildFakeArchive } from './testSupport/fakeDistribution.js';
import { fakeShScript } from './testSupport/fakeVm.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('runWithSharedCuis', () => {
  let tmp: { home: string; cleanup(): Promise<void> };

  beforeEach(async () => {
    tmp = await makeTempHome();
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('rejects with unsupported_platform on a non-darwin platform without touching the home directory', async () => {
    // Given a non-darwin platform and an empty home
    const scriptPath = path.join(tmp.home, 'script.st');

    // When
    const result = runWithSharedCuis(
      { home: tmp.home, platform: 'linux' },
      { scriptPath, timeoutMs: 1000 },
    );

    // Then
    await expect(result).rejects.toMatchObject({
      constructor: HeadlessError,
      code: 'unsupported_platform',
    });
    expect(await fs.readdir(tmp.home)).toEqual([]);
  });

  it.each([
    { state: 'missing', code: 'cuis_missing' },
    { state: 'failed', code: 'cuis_missing' },
    { state: 'preparing', code: 'cuis_initializing' },
  ])(
    "rejects with $code when the shared home is $state, without fetching or touching the home",
    async ({ state, code }) => {
      // Given a home in the given state and an archive server that must stay unused
      const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-run-test-'));
      const zipPath = path.join(work, 'archive.zip');
      const { sha256 } = await buildFakeArchive(zipPath);
      const server = await startArchiveServer(zipPath);
      try {
        const fetchImpl = vi.fn();
        const opts = {
          home: tmp.home,
          platform: 'darwin' as const,
          key: '7.8-test',
          archiveUrl: server.url,
          archiveSha256: sha256,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        };
        if (state === 'failed') {
          await fs.mkdir(path.dirname(errorPath(opts)), { recursive: true });
          await fs.writeFile(
            errorPath(opts),
            JSON.stringify({ code: 'cuis_fetch_failed', message: 'boom' }),
          );
        } else if (state === 'preparing') {
          await fs.mkdir(path.dirname(lockPath(opts)), { recursive: true });
          await acquireLock(lockPath(opts));
        }
        const listHome = () => fs.readdir(tmp.home, { recursive: true });
        const before = await listHome();
        const scriptPath = path.join(tmp.home, 'script.st');

        // When
        const result = runWithSharedCuis(opts, { scriptPath, timeoutMs: 1000 });

        // Then
        await expect(result).rejects.toMatchObject({ constructor: HeadlessError, code });
        if (state !== 'preparing') {
          await expect(result).rejects.toThrow(/prepare/i);
        }
        if (state === 'failed') {
          await expect(result).rejects.toThrow(/boom/);
        }
        expect(server.requestCount()).toBe(0);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(await listHome()).toEqual(before);
        if (state === 'missing') expect(before).toEqual([]);
      } finally {
        await server.close();
        await fs.rm(work, { recursive: true, force: true });
      }
    },
  );

  it('runs a script on a ready home offline and leaves the base and dist trees byte-identical', async () => {
    // Given a really prepared home whose archive server is then closed
    const { work, server, opts } = await prepareReadyHome(tmp.home);
    try {
      await server.close();

      const snapshot = async (dir: string) => {
        const entries = (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
          .filter((e) => e.isFile())
          .map((e) => path.join(e.parentPath, e.name))
          .sort();
        return Promise.all(
          entries.map(async (p) => [
            path.relative(dir, p),
            createHash('sha256').update(await fs.readFile(p)).digest('hex'),
          ]),
        );
      };
      const baseDir = path.join(layoutDir(opts), 'base');
      const distDir = path.join(layoutDir(opts), 'dist');
      const baseBefore = await snapshot(baseDir);
      const distBefore = await snapshot(distDir);
      expect(baseBefore.length).toBeGreaterThan(0);

      const scriptPath = path.join(work, 'script.st');
      await fs.writeFile(scriptPath, fakeShScript('echo hello-shared; echo "DONE exitCode=0"'));
      const fetchImpl = vi.fn(() => {
        throw new Error('network used');
      });

      // When
      const result = await runWithSharedCuis(
        { ...opts, fetchImpl: fetchImpl as unknown as typeof fetch },
        { scriptPath, timeoutMs: 10_000 },
      );

      // Then
      expect(result).toMatchObject({ outcome: 'passed', exitCode: 0 });
      expect(result.output).toContain('hello-shared');
      expect(await snapshot(baseDir)).toEqual(baseBefore);
      expect(await snapshot(distDir)).toEqual(distBefore);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await server.close().catch(() => undefined);
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it('removes the UserChanges entries created by the run and preserves the pre-existing ones', async () => {
    // Given a ready home whose dist/UserChanges already holds a file
    const { work, server, opts } = await prepareReadyHome(tmp.home);
    try {
      await server.close();

      const snapshot = async (dir: string) => {
        const entries = (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
          .filter((e) => e.isFile())
          .map((e) => path.join(e.parentPath, e.name))
          .sort();
        return Promise.all(
          entries.map(async (p) => [
            path.relative(dir, p),
            createHash('sha256').update(await fs.readFile(p)).digest('hex'),
          ]),
        );
      };
      const distDir = path.join(layoutDir(opts), 'dist');
      await fs.mkdir(path.join(distDir, 'UserChanges'), { recursive: true });
      await fs.writeFile(path.join(distDir, 'UserChanges', 'keep.changes'), 'keep');
      const distBefore = await snapshot(distDir);

      // The fake VM runs with cwd = dist, like the real one
      const scriptPath = path.join(work, 'script.st');
      await fs.writeFile(
        scriptPath,
        fakeShScript(
          'echo new > UserChanges/Cuis7.8.user.001.changes; echo "DONE exitCode=0"',
        ),
      );

      // When
      const result = await runWithSharedCuis(opts, { scriptPath, timeoutMs: 10_000 });

      // Then
      expect(result).toMatchObject({ outcome: 'passed', exitCode: 0 });
      expect(await snapshot(distDir)).toEqual(distBefore);
    } finally {
      await server.close().catch(() => undefined);
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it.each([
    { label: 'passing', tail: 'echo "DONE exitCode=0"', outcome: 'passed' },
    { label: 'crashing', tail: 'exit 1', outcome: 'timeout_or_crash' },
  ])(
    'removes the UserChanges directory itself when the dist had none and the run is $label',
    async ({ tail, outcome }) => {
      // Given a ready home whose dist has no UserChanges directory
      const { work, server, opts } = await prepareReadyHome(tmp.home);
      try {
        await server.close();

        const snapshot = async (dir: string) => {
          const entries = (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
            .filter((e) => e.isFile())
            .map((e) => path.join(e.parentPath, e.name))
            .sort();
          return Promise.all(
            entries.map(async (p) => [
              path.relative(dir, p),
              createHash('sha256').update(await fs.readFile(p)).digest('hex'),
            ]),
          );
        };
        const distDir = path.join(layoutDir(opts), 'dist');
        await expect(fs.access(path.join(distDir, 'UserChanges'))).rejects.toThrow();
        const distBefore = await snapshot(distDir);

        // The fake VM runs with cwd = dist, like the real one
        const scriptPath = path.join(work, 'script.st');
        await fs.writeFile(
          scriptPath,
          fakeShScript(
            `mkdir -p UserChanges; echo new > UserChanges/Cuis7.8.user.001.changes; ${tail}`,
          ),
        );

        // When
        const result = await runWithSharedCuis(opts, { scriptPath, timeoutMs: 10_000 });

        // Then
        expect(result).toMatchObject({ outcome });
        expect(await snapshot(distDir)).toEqual(distBefore);
        await expect(fs.access(path.join(distDir, 'UserChanges'))).rejects.toThrow();
      } finally {
        await server.close().catch(() => undefined);
        await fs.rm(work, { recursive: true, force: true });
      }
    },
  );

  it.each([
    { part: 'the VM', rel: () => path.join(DIST_DIR, CUIS_VM_PATH), name: CUIS_VM_PATH },
    { part: 'the image', rel: () => path.join(BASE_DIR, CUIS_IMAGE_FILE), name: CUIS_IMAGE_FILE },
    { part: 'the sources', rel: () => path.join(BASE_DIR, CUIS_SOURCES_FILE), name: CUIS_SOURCES_FILE },
    { part: 'the changes', rel: () => path.join(BASE_DIR, CUIS_CHANGES_FILE), name: CUIS_CHANGES_FILE },
  ])(
    'rejects with cuis_corrupt when $part is missing from a ready home, without rebuilding or running',
    async ({ rel, name }) => {
      // Given a really prepared home with one part deleted
      const { work, server, opts } = await prepareReadyHome(tmp.home);
      try {
        const damaged = path.join(layoutDir(opts), rel());
        await fs.rm(damaged);
        const sentinel = path.join(work, 'ran');
        const scriptPath = path.join(work, 'script.st');
        await fs.writeFile(scriptPath, fakeShScript(`touch "${sentinel}"; echo "DONE exitCode=0"`));

        // When
        const result = runWithSharedCuis(opts, { scriptPath, timeoutMs: 10_000 });

        // Then
        await expect(result).rejects.toMatchObject({
          constructor: HeadlessError,
          code: 'cuis_corrupt',
        });
        await expect(result).rejects.toThrow(layoutDir(opts));
        await expect(result).rejects.toThrow(/delete/i);
        await expect(result).rejects.toThrow(/prepare/i);
        await expect(result).rejects.toThrow(name);
        expect(await cuisHomeStatus(opts)).toEqual({ state: 'ready' });
        await expect(fs.access(damaged)).rejects.toThrow();
        await expect(fs.access(sentinel)).rejects.toThrow();
      } finally {
        await server.close().catch(() => undefined);
        await fs.rm(work, { recursive: true, force: true });
      }
    },
  );

  it.each([
    { scenario: 'a no-op prepare of the same key', otherKey: false },
    { scenario: 'a slow preparation of a different key', otherKey: true },
  ])(
    'runs 3 scripts concurrently alongside $scenario without blocking and leaves base and dist byte-identical',
    async ({ otherKey }) => {
      // Given a ready home (and, optionally, a second key served by a slow archive server)
      const { work, server, opts } = await prepareReadyHome(tmp.home);
      const slowZip = path.join(work, 'slow.zip');
      const { sha256 } = await buildFakeArchive(slowZip);
      const slowServer = await startArchiveServer(slowZip, { delayMs: 1500 });
      const otherOpts = {
        ...opts,
        key: '7.8-other',
        archiveUrl: slowServer.url,
        archiveSha256: sha256,
      };
      try {
        const snapshot = async (dir: string) => {
          const entries = (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
            .filter((e) => e.isFile())
            .map((e) => path.join(e.parentPath, e.name))
            .sort();
          return Promise.all(
            entries.map(async (p) => [
              path.relative(dir, p),
              createHash('sha256').update(await fs.readFile(p)).digest('hex'),
            ]),
          );
        };
        const baseDir = path.join(layoutDir(opts), 'base');
        const distDir = path.join(layoutDir(opts), 'dist');
        const baseBefore = await snapshot(baseDir);
        const distBefore = await snapshot(distDir);
        expect(baseBefore.length).toBeGreaterThan(0);
        await expect(fs.access(path.join(distDir, 'UserChanges'))).rejects.toThrow();

        const scriptPaths = await Promise.all(
          [1, 2, 3].map(async (n) => {
            const scriptPath = path.join(work, `script${n}.st`);
            await fs.writeFile(
              scriptPath,
              fakeShScript(
                `mkdir -p UserChanges; echo ${n} > UserChanges/Cuis7.8.user.00${n}.changes; sleep 0.2; echo hello-${n}; echo "DONE exitCode=0"`,
              ),
            );
            return scriptPath;
          }),
        );
        const prepareOpts = otherKey ? otherOpts : opts;

        // When all runs and the prepare start at once
        const [results, prepared, statusAfterRuns] = await (async () => {
          const prepare = prepareCuisHome(prepareOpts);
          const runs = Promise.all(
            scriptPaths.map((scriptPath) => runWithSharedCuis(opts, { scriptPath, timeoutMs: 10_000 })),
          );
          const [p, r] = await Promise.all([prepare, runs]);
          return [r, p, await cuisHomeStatus(prepareOpts)] as const;
        })();

        // Then every run passed, none was blocked by the preparation, and the first key is untouched
        results.forEach((result, i) => {
          expect(result).toMatchObject({ outcome: 'passed', exitCode: 0 });
          expect(result.output).toContain(`hello-${i + 1}`);
        });
        if (otherKey) {
          expect(prepared).toBe('started');
          expect(statusAfterRuns).toEqual({ state: 'preparing' });
          const deadline = Date.now() + 20_000;
          let status = await cuisHomeStatus(otherOpts);
          while (status.state === 'preparing' && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 50));
            status = await cuisHomeStatus(otherOpts);
          }
          expect(status).toEqual({ state: 'ready' });
        } else {
          expect(prepared).toBe('ready');
          expect(statusAfterRuns).toEqual({ state: 'ready' });
        }
        expect(await cuisHomeStatus(opts)).toEqual({ state: 'ready' });
        expect(await snapshot(baseDir)).toEqual(baseBefore);
        expect(await snapshot(distDir)).toEqual(distBefore);
        await expect(fs.access(path.join(distDir, 'UserChanges'))).rejects.toThrow();
      } finally {
        await slowServer.close().catch(() => undefined);
        await server.close().catch(() => undefined);
        await fs.rm(work, { recursive: true, force: true });
      }
    },
  );
});

async function prepareReadyHome(home: string) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-run-test-'));
  const zipPath = path.join(work, 'archive.zip');
  const { sha256 } = await buildFakeArchive(zipPath);
  const server = await startArchiveServer(zipPath);
  const opts = {
    home,
    platform: 'darwin' as const,
    key: '7.8-test',
    archiveUrl: server.url,
    archiveSha256: sha256,
  };
  await prepareCuisHome(opts);
  let status = await cuisHomeStatus(opts);
  const deadline = Date.now() + 20_000;
  while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    status = await cuisHomeStatus(opts);
  }
  expect(status).toEqual({ state: 'ready' });
  return { work, server, opts };
}
