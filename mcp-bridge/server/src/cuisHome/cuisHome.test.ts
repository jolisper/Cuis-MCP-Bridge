import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { cuisHomeStatus, errorPath, layoutDir, lockPath, prepareCuisHome } from './cuisHome.js';
import { HeadlessError } from './errors.js';
import { acquireLock } from './processLock.js';
import {
  CUIS_CHANGES_FILE,
  CUIS_IMAGE_DIR,
  CUIS_IMAGE_FILE,
  CUIS_LAYOUT_KEY,
  CUIS_SOURCES_FILE,
} from './pin.js';
import { buildFakeArchive } from './testSupport/fakeDistribution.js';
import { startArchiveServer } from './testSupport/archiveServer.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('cuisHomeStatus', () => {
  let temp: Awaited<ReturnType<typeof makeTempHome>> | undefined;

  afterEach(async () => {
    await temp?.cleanup();
    temp = undefined;
  });

  it("returns 'missing' and creates nothing when cuis/ does not exist", async () => {
    // Given
    temp = await makeTempHome();

    // When
    const status = await cuisHomeStatus({ home: temp.home, key: '7.8-test' });

    // Then
    expect(status).toEqual({ state: 'missing' });
    expect(await fs.readdir(temp.home)).toEqual([]);
  });

  it("returns 'ready' when the layout directory exists", async () => {
    // Given
    temp = await makeTempHome();
    await fs.mkdir(layoutDir({ home: temp.home, key: '7.8-test' }), { recursive: true });

    // When
    const status = await cuisHomeStatus({ home: temp.home, key: '7.8-test' });

    // Then
    expect(status).toEqual({ state: 'ready' });
    expect(layoutDir({ home: temp.home })).toBe(path.join(temp.home, 'cuis', '7.8-d4f9cc1'));
  });

  it("returns 'preparing' while a live lock exists and 'missing' when the lock is stale", async () => {
    // Given
    temp = await makeTempHome();
    const opts = { home: temp.home, key: '7.8-test' };
    await fs.mkdir(path.dirname(lockPath(opts)), { recursive: true });
    await acquireLock(lockPath(opts));

    // When
    const live = await cuisHomeStatus(opts);

    // Then
    expect(live).toEqual({ state: 'preparing' });

    // Given a lock held by a dead process
    await fs.unlink(lockPath(opts));
    const deadPid = spawnSync('true').pid;
    await fs.writeFile(
      lockPath(opts),
      JSON.stringify({ pid: deadPid, startTime: 'Thu Jan  1 00:00:00 1970' }),
    );

    // When
    const stale = await cuisHomeStatus(opts);

    // Then
    expect(stale).toEqual({ state: 'missing' });
  });

  it("returns 'failed' from the error file without consuming it, and 'internal_error' when it is unreadable", async () => {
    // Given
    temp = await makeTempHome();
    const opts = { home: temp.home, key: '7.8-test' };
    await fs.mkdir(path.dirname(errorPath(opts)), { recursive: true });
    await fs.writeFile(
      errorPath(opts),
      JSON.stringify({ code: 'cuis_fetch_failed', message: 'boom' }),
    );

    // When
    const first = await cuisHomeStatus(opts);
    const second = await cuisHomeStatus(opts);

    // Then
    const expected = { state: 'failed', error: { code: 'cuis_fetch_failed', message: 'boom' } };
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    await expect(fs.stat(errorPath(opts))).resolves.toBeDefined();

    // Given an error file with garbage content
    await fs.writeFile(errorPath(opts), 'not json {{{');

    // When
    const garbage = await cuisHomeStatus(opts);

    // Then
    expect(garbage).toMatchObject({
      state: 'failed',
      error: { code: 'internal_error', message: expect.stringMatching(/unreadable/i) },
    });
  });

  it('defaults to <homedir>/.cuis-mcp-bridge/cuis/<key>, independent of cwd, creating nothing', async () => {
    // Given
    const originalHome = process.env.HOME;
    const originalCwd = process.cwd();
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-default-home-'));
    const otherCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-other-cwd-'));
    const expectedForRealHome = path.join(os.homedir(), '.cuis-mcp-bridge', 'cuis', CUIS_LAYOUT_KEY);

    try {
      // When no home option is given
      const realHomeResult = layoutDir({});
      process.env.HOME = fakeHome;
      const fromFakeHome = layoutDir({});
      const status = await cuisHomeStatus({});
      process.chdir(otherCwd);
      const afterChdir = layoutDir({});

      // Then
      expect(realHomeResult).toBe(expectedForRealHome);
      expect(fromFakeHome).toBe(path.join(os.homedir(), '.cuis-mcp-bridge', 'cuis', CUIS_LAYOUT_KEY));
      expect(fromFakeHome.startsWith(fakeHome + path.sep)).toBe(true);
      expect(status).toEqual({ state: 'missing' });
      expect(await fs.readdir(fakeHome)).toEqual([]);
      expect(afterChdir).toBe(fromFakeHome);
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      await fs.rm(fakeHome, { recursive: true, force: true });
      await fs.rm(otherCwd, { recursive: true, force: true });
    }
  });
});

describe('prepareCuisHome', () => {
  let temp: Awaited<ReturnType<typeof makeTempHome>> | undefined;

  afterEach(async () => {
    await temp?.cleanup();
    temp = undefined;
  });

  it("rejects with 'unsupported_platform' on linux without fetching or touching the home", async () => {
    // Given
    temp = await makeTempHome();
    const fetchImpl = vi.fn(() => {
      throw new Error('fetch must not be called');
    });

    // When
    const result = prepareCuisHome({
      home: temp.home,
      platform: 'linux',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Then
    await expect(result).rejects.toBeInstanceOf(HeadlessError);
    await expect(result).rejects.toMatchObject({
      code: 'unsupported_platform',
      message: expect.stringMatching(/macOS/),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await fs.readdir(temp.home)).toEqual([]);
  });

  it("prepares a ready layout from a fetched archive and leaves no sibling artifacts", async () => {
    // Given
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256 } = await buildFakeArchive(zipPath);
    const server = await startArchiveServer(zipPath);
    try {
      const opts = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
        archiveUrl: server.url,
        archiveSha256: sha256,
      };

      // When
      const started = await prepareCuisHome(opts);
      let status = await cuisHomeStatus(opts);
      const deadline = Date.now() + 20_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(opts);
      }

      // Then
      expect(started).toBe('started');
      expect(status).toEqual({ state: 'ready' });
      const layout = path.join(temp.home, 'cuis', '7.8-test');
      await expect(
        fs.stat(path.join(layout, 'dist', 'CuisVM.app', 'Contents', 'MacOS', 'Squeak')),
      ).resolves.toBeDefined();
      await expect(fs.stat(path.join(layout, 'dist', 'Packages', 'marker.txt'))).resolves.toBeDefined();
      const baseFiles = [CUIS_IMAGE_FILE, CUIS_SOURCES_FILE, CUIS_CHANGES_FILE];
      expect((await fs.readdir(path.join(layout, 'base'))).sort()).toEqual([...baseFiles].sort());
      for (const name of baseFiles) {
        expect(await fs.readFile(path.join(layout, 'base', name), 'utf8')).toBe(
          await fs.readFile(path.join(layout, 'dist', CUIS_IMAGE_DIR, name), 'utf8'),
        );
      }
      expect(await fs.readdir(path.join(temp.home, 'cuis'))).toEqual(['7.8-test']);
    } finally {
      await server.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("records 'cuis_checksum_mismatch' as the error file and leaves nothing else behind", async () => {
    // Given
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256: actual } = await buildFakeArchive(zipPath);
    const expected = '0'.repeat(64);
    const server = await startArchiveServer(zipPath);
    try {
      const opts = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
        archiveUrl: server.url,
        archiveSha256: expected,
      };

      // When
      const started = await prepareCuisHome(opts);
      let status = await cuisHomeStatus(opts);
      const deadline = Date.now() + 4_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(opts);
      }

      // Then
      expect(started).toBe('started');
      expect(
        status.state,
        `status never became 'failed' within 4s (last: ${JSON.stringify(status)})`,
      ).toBe('failed');
      expect(status).toMatchObject({
        state: 'failed',
        error: {
          code: 'cuis_checksum_mismatch',
          message: expect.stringContaining(expected),
        },
      });
      expect((status as { error: { message: string } }).error.message).toContain(actual);
      expect(await fs.readdir(path.join(temp.home, 'cuis'))).toEqual(['7.8-test.error']);
    } finally {
      await server.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it.each(['not-found', 'connection-refused', 'reset-midstream'] as const)(
    "records 'cuis_fetch_failed' as the error file and leaves nothing else behind on network failure (%s)",
    async (shape) => {
      // Given
      temp = await makeTempHome();
      const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
      const zipPath = path.join(work, 'archive.zip');
      const { sha256 } = await buildFakeArchive(zipPath);
      const server = await startArchiveServer(zipPath, {
        behavior: shape === 'connection-refused' ? 'ok' : shape,
      });
      const archiveUrl = server.url;
      if (shape === 'connection-refused') await server.close();
      try {
        const opts = {
          home: temp.home,
          key: '7.8-test',
          platform: 'darwin' as const,
          archiveUrl,
          archiveSha256: sha256,
        };

        // When
        const started = await prepareCuisHome(opts);
        let status = await cuisHomeStatus(opts);
        const deadline = Date.now() + 4_000;
        while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
          status = await cuisHomeStatus(opts);
        }

        // Then
        expect(started).toBe('started');
        expect(
          status.state,
          `status never became 'failed' within 4s (last: ${JSON.stringify(status)})`,
        ).toBe('failed');
        expect(status).toMatchObject({
          state: 'failed',
          error: { code: 'cuis_fetch_failed', message: expect.stringMatching(/\S/) },
        });
        expect(await fs.readdir(path.join(temp.home, 'cuis'))).toEqual(['7.8-test.error']);
      } finally {
        await server.close();
        await fs.rm(work, { recursive: true, force: true });
      }
    },
  );

  it(
    'fails cleanly with cuis_fetch_failed and raises no unhandled errors across 30 mid-stream resets of a large archive',
    async () => {
      // Given
      const unhandled: unknown[] = [];
      const onUnhandled = (e: unknown) => unhandled.push(e);
      process.on('unhandledRejection', onUnhandled);
      process.on('uncaughtException', onUnhandled);
      const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
      const zipPath = path.join(work, 'archive.zip');
      const { sha256 } = await buildFakeArchive(zipPath);
      await fs.appendFile(zipPath, randomBytes(8 * 1024 * 1024)); // widen the in-flight write window
      const server = await startArchiveServer(zipPath, { behavior: 'reset-midstream' });
      const outcomes: unknown[] = [];
      try {
        // When
        for (let i = 0; i < 30; i++) {
          const rep = await makeTempHome();
          try {
            const opts = {
              home: rep.home,
              key: '7.8-test',
              platform: 'darwin' as const,
              archiveUrl: server.url,
              archiveSha256: sha256,
            };
            await prepareCuisHome(opts);
            let status = await cuisHomeStatus(opts);
            const deadline = Date.now() + 4_000;
            while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 20));
              status = await cuisHomeStatus(opts);
            }
            outcomes.push(
              status.state === 'failed' ? (status as { error: { code: string } }).error.code : status.state,
            );
            await new Promise((r) => setTimeout(r, 100)); // let late errors surface
          } finally {
            await rep.cleanup();
          }
        }

        // Then
        expect(outcomes).toEqual(Array(30).fill('cuis_fetch_failed'));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
        process.off('uncaughtException', onUnhandled);
        await server.close();
        await fs.rm(work, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it(
    'downloads a large archive from an HTTP/1.0 server that closes the socket after the body without raising unhandled errors',
    async () => {
      // Given
      const unhandled: unknown[] = [];
      const onUnhandled = (e: unknown) => unhandled.push(e);
      process.on('unhandledRejection', onUnhandled);
      process.on('uncaughtException', onUnhandled);
      temp = await makeTempHome();
      const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
      const zipPath = path.join(work, 'archive.zip');
      await buildFakeArchive(zipPath);
      await fs.appendFile(zipPath, randomBytes(32 * 1024 * 1024));
      const sha256 = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
      const server = await startArchiveServer(zipPath, { behavior: 'http10-close' });
      try {
        const opts = {
          home: temp.home,
          key: '7.8-test',
          platform: 'darwin' as const,
          archiveUrl: server.url,
          archiveSha256: sha256,
        };

        // When
        await prepareCuisHome(opts);
        let status = await cuisHomeStatus(opts);
        const deadline = Date.now() + 30_000;
        while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
          status = await cuisHomeStatus(opts);
        }
        await new Promise((r) => setTimeout(r, 200)); // let late errors surface

        // Then
        expect(unhandled).toEqual([]);
        const code = status.state === 'failed' ? (status as { error: { code: string } }).error.code : status.state;
        expect(code).not.toBe('cuis_fetch_failed');
        expect(code).not.toBe('cuis_checksum_mismatch');
      } finally {
        process.off('unhandledRejection', onUnhandled);
        process.off('uncaughtException', onUnhandled);
        await server.close();
        await fs.rm(work, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it('records a failure and raises no unhandled errors when the tmp dir vanishes mid-download', async () => {
    // Given
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    process.on('uncaughtException', onUnhandled);
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    await buildFakeArchive(zipPath);
    await fs.appendFile(zipPath, randomBytes(4 * 1024 * 1024));
    const sha256 = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
    const server = await startArchiveServer(zipPath, {
      behavior: 'ok',
      chunkSize: 64 * 1024,
      chunkGapMs: 20,
    });
    try {
      const opts = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
        archiveUrl: server.url,
        archiveSha256: sha256,
      };
      const cuisDir = path.join(temp.home, 'cuis');

      // When
      await prepareCuisHome(opts);
      let tmpEntry: string | undefined;
      const tmpDeadline = Date.now() + 4_000;
      while (!tmpEntry && Date.now() < tmpDeadline) {
        const entries = await fs.readdir(cuisDir).catch(() => [] as string[]);
        const found = entries.find((e) => e.startsWith('7.8-test.tmp-'));
        const written = found
          ? await fs.stat(path.join(cuisDir, found, 'archive.zip')).then((s) => s.size, () => 0)
          : 0;
        if (found && written > 0) tmpEntry = found;
        else await new Promise((r) => setTimeout(r, 5));
      }
      expect(tmpEntry, 'archive never started downloading').toBeDefined();
      await fs.rm(path.join(cuisDir, tmpEntry!), { recursive: true, force: true });

      let status = await cuisHomeStatus(opts);
      const deadline = Date.now() + 4_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(opts);
      }
      await new Promise((r) => setTimeout(r, 200)); // let late errors surface

      // Then
      expect(status).toMatchObject({
        state: 'failed',
        error: { code: 'cuis_write_failed', message: expect.stringMatching(/\S/) },
      });
      expect(await fs.readdir(cuisDir)).toEqual(['7.8-test.error']);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      process.off('uncaughtException', onUnhandled);
      await server.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it.each(['unwritable-home', 'unzip-cannot-run'] as const)(
    "surfaces local write failures as 'cuis_write_failed' carrying the cause (%s)",
    async (shape) => {
      if (shape === 'unwritable-home' && process.getuid?.() === 0) return; // root ignores modes

      // Given
      temp = await makeTempHome();
      const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
      const zipPath = path.join(work, 'archive.zip');
      const { sha256 } = await buildFakeArchive(zipPath);
      const server = await startArchiveServer(zipPath);
      try {
        const opts = {
          home: temp.home,
          key: '7.8-test',
          platform: 'darwin' as const,
          archiveUrl: server.url,
          archiveSha256: sha256,
          ...(shape === 'unzip-cannot-run' ? { unzip: '/nonexistent/unzip' } : {}),
        };

        if (shape === 'unwritable-home') {
          await fs.chmod(temp.home, 0o555);

          // When
          const result = prepareCuisHome(opts);

          // Then
          await expect(result).rejects.toBeInstanceOf(HeadlessError);
          await expect(result).rejects.toMatchObject({
            code: 'cuis_write_failed',
            message: expect.stringMatching(/EACCES|permission/i),
          });
          await fs.chmod(temp.home, 0o755);
          expect(await fs.readdir(temp.home)).toEqual([]);
          return;
        }

        // When
        const started = await prepareCuisHome(opts);
        let status = await cuisHomeStatus(opts);
        const deadline = Date.now() + 4_000;
        while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
          status = await cuisHomeStatus(opts);
        }

        // Then
        expect(started).toBe('started');
        expect(
          status.state,
          `status never became 'failed' within 4s (last: ${JSON.stringify(status)})`,
        ).toBe('failed');
        expect(status).toMatchObject({
          state: 'failed',
          error: { code: 'cuis_write_failed', message: expect.stringMatching(/ENOENT/) },
        });
        expect(await fs.readdir(path.join(temp.home, 'cuis'))).toEqual(['7.8-test.error']);
      } finally {
        await server.close();
        await fs.rm(work, { recursive: true, force: true });
      }
    },
  );

  it("records 'cuis_base_build_failed' with the VM output when the smoke boot fails, never reporting 'ready'", async () => {
    // Given
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256 } = await buildFakeArchive(zipPath, { bootFails: true });
    const server = await startArchiveServer(zipPath);
    try {
      const opts = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
        archiveUrl: server.url,
        archiveSha256: sha256,
      };

      // When
      const started = await prepareCuisHome(opts);
      let status = await cuisHomeStatus(opts);
      const observed: string[] = [status.state];
      const deadline = Date.now() + 8_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(opts);
        observed.push(status.state);
      }

      // Then
      expect(started).toBe('started');
      expect(observed).not.toContain('ready');
      expect(
        status.state,
        `status never became 'failed' within 8s (last: ${JSON.stringify(status)})`,
      ).toBe('failed');
      expect(status).toMatchObject({
        state: 'failed',
        error: {
          code: 'cuis_base_build_failed',
          message: expect.stringContaining('fake VM: cannot boot'),
        },
      });
      expect(await fs.readdir(path.join(temp.home, 'cuis'))).toEqual(['7.8-test.error']);
    } finally {
      await server.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("makes the smoke-boot script log the Transcript to stdout and end the marker with newLine, as the real VM requires", async () => {
    // Given a fake VM that, like the real one, prints the marker only when the Transcript logs to stdout and the marker is ended with newLine
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256 } = await buildFakeArchive(zipPath, { requireRealVmScript: true });
    const server = await startArchiveServer(zipPath);
    try {
      const opts = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
        archiveUrl: server.url,
        archiveSha256: sha256,
      };

      // When
      await prepareCuisHome(opts);
      let status = await cuisHomeStatus(opts);
      const deadline = Date.now() + 20_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(opts);
      }

      // Then
      expect(status).toEqual({ state: 'ready' });
    } finally {
      await server.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("removes the UserChanges directory the smoke boot created so the published dist is pristine", async () => {
    // Given a fake VM that, like the real one, writes UserChanges/ in its cwd during the smoke boot
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256 } = await buildFakeArchive(zipPath, { writesUserChanges: true });
    const server = await startArchiveServer(zipPath);
    try {
      const opts = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
        archiveUrl: server.url,
        archiveSha256: sha256,
      };

      // When
      await prepareCuisHome(opts);
      let status = await cuisHomeStatus(opts);
      const deadline = Date.now() + 20_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(opts);
      }

      // Then
      expect(status).toEqual({ state: 'ready' });
      await expect(fs.access(path.join(layoutDir(opts), 'dist', 'UserChanges'))).rejects.toBeDefined();
    } finally {
      await server.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("starts one preparation for concurrent calls and never re-fetches once ready", async () => {
    // Given
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256 } = await buildFakeArchive(zipPath);
    const server = await startArchiveServer(zipPath, { delayMs: 300 });
    try {
      const opts = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
        archiveUrl: server.url,
        archiveSha256: sha256,
      };

      // When
      const results = await Promise.all([prepareCuisHome(opts), prepareCuisHome(opts)]);
      let status = await cuisHomeStatus(opts);
      const deadline = Date.now() + 20_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(opts);
      }

      // Then
      expect([...results].sort()).toEqual(['in_progress', 'started']);
      expect(status).toEqual({ state: 'ready' });
      expect(server.requestCount()).toBe(1);
      const layoutBefore = await fs.readdir(path.join(temp.home, 'cuis'));

      // When ready already
      const again = await prepareCuisHome(opts);

      // Then
      expect(again).toBe('ready');
      expect(server.requestCount()).toBe(1);
      expect(await fs.readdir(path.join(temp.home, 'cuis'))).toEqual(layoutBefore);
      expect(layoutBefore).toEqual(['7.8-test']);
    } finally {
      await server.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("retries after a failure with a fresh attempt and clears the old error file once ready", async () => {
    // Given a first attempt that failed
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256 } = await buildFakeArchive(zipPath);
    const badServer = await startArchiveServer(zipPath, { behavior: 'not-found' });
    const goodServer = await startArchiveServer(zipPath);
    try {
      const base = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
        archiveSha256: sha256,
      };
      const failingOpts = { ...base, archiveUrl: badServer.url };
      await prepareCuisHome(failingOpts);
      let status = await cuisHomeStatus(failingOpts);
      let deadline = Date.now() + 4_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(failingOpts);
      }
      const failedAgain = await cuisHomeStatus(failingOpts);
      expect(status).toMatchObject({ state: 'failed', error: { code: 'cuis_fetch_failed' } });
      expect(failedAgain).toEqual(status);

      // When retrying against a good server
      const retryOpts = { ...base, archiveUrl: goodServer.url };
      const started = await prepareCuisHome(retryOpts);
      status = await cuisHomeStatus(retryOpts);
      deadline = Date.now() + 20_000;
      while (status.state !== 'ready' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(retryOpts);
      }

      // Then
      expect(started).toBe('started');
      expect(status).toEqual({ state: 'ready' });
      expect(await fs.readdir(path.join(temp.home, 'cuis'))).toEqual(['7.8-test']);
    } finally {
      await badServer.close();
      await goodServer.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it(
    "is fully settled the instant status stops being 'preparing' (no lock or tmp dir left) across 15 failing and 15 successful runs",
    async () => {
      const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
      const failingZip = path.join(work, 'failing.zip');
      const okZip = path.join(work, 'ok.zip');
      const failing = await buildFakeArchive(failingZip, { bootFails: true });
      const ok = await buildFakeArchive(okZip);
      const failingServer = await startArchiveServer(failingZip);
      const okServer = await startArchiveServer(okZip);
      try {
        const scenarios = [
          { server: failingServer, sha256: failing.sha256, final: 'failed', entries: ['7.8-test.error'] },
          { server: okServer, sha256: ok.sha256, final: 'ready', entries: ['7.8-test'] },
        ] as const;
        for (const scenario of scenarios) {
          for (let i = 0; i < 15; i++) {
            // Given
            const repetition = await makeTempHome();
            try {
              const opts = {
                home: repetition.home,
                key: '7.8-test',
                platform: 'darwin' as const,
                archiveUrl: scenario.server.url,
                archiveSha256: scenario.sha256,
              };

              // When
              await prepareCuisHome(opts);
              let status = await cuisHomeStatus(opts);
              const deadline = Date.now() + 20_000;
              while (
                (status.state === 'missing' || status.state === 'preparing') &&
                Date.now() < deadline
              ) {
                await new Promise((r) => setImmediate(r));
                status = await cuisHomeStatus(opts);
              }
              const entries = await fs.readdir(path.join(repetition.home, 'cuis'));
              const after = await cuisHomeStatus(opts);

              // Then
              expect(status.state, `${scenario.final} run ${i}`).toBe(scenario.final);
              expect(entries, `${scenario.final} run ${i}`).toEqual(scenario.entries);
              expect(after.state, `${scenario.final} run ${i}`).toBe(scenario.final);
            } finally {
              await new Promise((r) => setTimeout(r, 200));
              await repetition.cleanup();
            }
          }
        }
      } finally {
        await failingServer.close();
        await okServer.close();
        await fs.rm(work, { recursive: true, force: true });
      }
    },
    120000,
  );

  it("recovers from a simulated crash: stale lock and foreign tmp leftover are discarded and the layout becomes ready", async () => {
    // Given a crashed run: dead-pid lock, a leftover tmp dir with junk, no layout dir
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256 } = await buildFakeArchive(zipPath);
    const server = await startArchiveServer(zipPath);
    try {
      const opts = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
        archiveUrl: server.url,
        archiveSha256: sha256,
      };
      const cuisDir = path.join(temp.home, 'cuis');
      await fs.mkdir(cuisDir, { recursive: true });
      const child = spawn(process.execPath, ['-e', '']);
      await new Promise((resolve) => child.on('exit', resolve));
      await fs.writeFile(
        lockPath(opts),
        JSON.stringify({ pid: child.pid, startTime: 'Thu Jan  1 00:00:00 1970' }),
      );
      const leftover = path.join(cuisDir, '7.8-test.tmp-99999');
      await fs.mkdir(leftover);
      await fs.writeFile(path.join(leftover, 'half.zip'), 'junk');

      // When
      const before = await cuisHomeStatus(opts);
      const started = await prepareCuisHome(opts);
      let status = await cuisHomeStatus(opts);
      const deadline = Date.now() + 20_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(opts);
      }

      // Then
      expect(before).toEqual({ state: 'missing' });
      expect(started).toBe('started');
      expect(status).toEqual({ state: 'ready' });
      expect(await fs.readdir(cuisDir)).toEqual(['7.8-test']);
    } finally {
      await server.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("keeps layouts for different keys independent: preparing b leaves a untouched, and deleting b leaves a ready and nothing else behind", async () => {
    // Given
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-prepare-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256 } = await buildFakeArchive(zipPath);
    const server = await startArchiveServer(zipPath);
    const snapshot = async (dir: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
      const lines: string[] = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const full = path.join(entry.parentPath, entry.name);
        const hash = createHash('sha256').update(await fs.readFile(full)).digest('hex');
        lines.push(`${path.relative(dir, full)} ${hash}`);
      }
      return lines.sort();
    };
    const waitReady = async (o: Parameters<typeof cuisHomeStatus>[0]) => {
      let status = await cuisHomeStatus(o);
      const deadline = Date.now() + 20_000;
      while (status.state !== 'ready' && status.state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        status = await cuisHomeStatus(o);
      }
      return status;
    };
    try {
      const base = {
        home: temp.home,
        platform: 'darwin' as const,
        archiveUrl: server.url,
        archiveSha256: sha256,
      };
      const optsA = { ...base, key: '7.8-a' };
      const optsB = { ...base, key: '7.8-b' };
      const cuisDir = path.join(temp.home, 'cuis');

      // When preparing a, then b
      await prepareCuisHome(optsA);
      expect(await waitReady(optsA)).toEqual({ state: 'ready' });
      const snapshotA = await snapshot(path.join(cuisDir, '7.8-a'));
      await prepareCuisHome(optsB);
      expect(await waitReady(optsB)).toEqual({ state: 'ready' });

      // Then a is untouched
      expect(await cuisHomeStatus(optsA)).toEqual({ state: 'ready' });
      expect(await snapshot(path.join(cuisDir, '7.8-a'))).toEqual(snapshotA);
      expect((await fs.readdir(cuisDir)).sort()).toEqual(['7.8-a', '7.8-b']);

      // When b is deleted by hand
      await fs.rm(path.join(cuisDir, '7.8-b'), { recursive: true });

      // Then
      expect(await cuisHomeStatus(optsB)).toEqual({ state: 'missing' });
      expect(await cuisHomeStatus(optsA)).toEqual({ state: 'ready' });
      expect((await fs.readdir(cuisDir)).sort()).toEqual(['7.8-a']);
    } finally {
      await server.close();
      await fs.rm(work, { recursive: true, force: true });
    }
  });
});

describe('cuisHome offline reuse and no-network guarantees', () => {
  let temp: Awaited<ReturnType<typeof makeTempHome>> | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await temp?.cleanup();
    temp = undefined;
  });

  it('cuisHomeStatus makes no network request in missing, preparing, failed or ready state', async () => {
    // Given
    temp = await makeTempHome();
    const fetchImpl = vi.fn(() => {
      throw new Error('network used');
    });
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network used');
    });
    const statusOf = (key: string) =>
      cuisHomeStatus({ home: temp!.home, key, fetchImpl: fetchImpl as unknown as typeof fetch } as never);
    const started = Date.now();

    // When / Then: missing
    expect(await statusOf('k-missing')).toEqual({ state: 'missing' });

    // preparing (live lock)
    const preparing = { home: temp.home, key: 'k-preparing' };
    await fs.mkdir(path.dirname(lockPath(preparing)), { recursive: true });
    await acquireLock(lockPath(preparing));
    expect(await statusOf('k-preparing')).toEqual({ state: 'preparing' });

    // failed (error file)
    const failed = { home: temp.home, key: 'k-failed' };
    await fs.writeFile(
      errorPath(failed),
      JSON.stringify({ code: 'cuis_fetch_failed', message: 'boom' }),
    );
    expect(await statusOf('k-failed')).toMatchObject({ state: 'failed' });

    // ready (key dir)
    await fs.mkdir(layoutDir({ home: temp.home, key: 'k-ready' }), { recursive: true });
    expect(await statusOf('k-ready')).toEqual({ state: 'ready' });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("keeps a ready home working offline: preparing again resolves 'ready' without any fetch", async () => {
    // Given a home prepared from a local server that is then closed
    temp = await makeTempHome();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-offline-test-'));
    const zipPath = path.join(work, 'archive.zip');
    const { sha256 } = await buildFakeArchive(zipPath);
    const server = await startArchiveServer(zipPath);
    try {
      const opts = {
        home: temp.home,
        key: '7.8-test',
        platform: 'darwin' as const,
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
      await server.close();

      const fetchImpl = vi.fn(() => {
        throw new Error('network used');
      });
      const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('network used');
      });

      // When
      const result = await prepareCuisHome({
        ...opts,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      // Then
      expect(result).toBe('ready');
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      await server.close().catch(() => undefined);
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it('hardcodes no distribution paths and is not wired into server startup', async () => {
    // Given
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const sources = entries.filter(
      (e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'),
    );

    // When / Then
    expect(sources.length).toBeGreaterThan(0);
    for (const entry of sources) {
      const text = await fs.readFile(path.join(dir, entry.name), 'utf8');
      expect(text, `${entry.name} mentions Cuis7-8-main`).not.toContain('Cuis7-8-main');
      expect(text, `${entry.name} mentions .headless-base`).not.toContain('.headless-base');
    }
    for (const file of ['index.ts', 'tools.ts']) {
      const text = await fs.readFile(path.join(dir, '..', file), 'utf8');
      expect(text, `${file} imports cuisHome`).not.toMatch(/from\s+['"]\.\/cuisHome/);
    }
  });
});
