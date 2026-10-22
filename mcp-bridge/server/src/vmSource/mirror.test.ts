import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VmSourceError } from './errors.js';
import { getVmSource } from './getVmSource.js';
import { mirrorState, setupVmMirror, type MirrorOptions } from './mirror.js';
import { createHarness, waitFor, type Harness } from './testSupport/harness.js';

const execFileP = promisify(execFile);

/** Relative path → mtime (ms) of every entry under `dir`, recursively. */
async function listTree(dir: string): Promise<Map<string, number>> {
  const entries = await fs.readdir(dir, { recursive: true });
  const tree = new Map<string, number>();
  for (const rel of entries) {
    tree.set(rel, (await fs.lstat(path.join(dir, rel))).mtimeMs);
  }
  return tree;
}

/** Run `setupVmMirror` to completion: mirror ready and lock released. */
async function setUpToCompletion(opts: MirrorOptions): Promise<void> {
  expect(await setupVmMirror(opts)).toBe('started');
  await waitFor(async () => (await mirrorState(opts)) === 'ready');
  const lock = path.join(opts.home, 'vm-mirror.lock');
  await waitFor(async () => fs.access(lock).then(() => false, () => true), 3000);
}

describe('mirrorState', () => {
  let h: Harness | undefined;

  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it("returns 'missing' when home does not exist", async () => {
    // Given
    h = await createHarness();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const state = await mirrorState(opts);

    // Then
    expect(state).toBe('missing');
  });

  it("returns 'ready' when <home>/vm-mirror exists", async () => {
    // Given
    h = await createHarness();
    await fs.mkdir(path.join(h.home, 'vm-mirror'), { recursive: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const state = await mirrorState(opts);

    // Then
    expect(state).toBe('ready');
  });

  it("returns 'initializing' while a started clone is still running", async () => {
    // Given
    h = await createHarness({ gated: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    expect(await setupVmMirror(opts)).toBe('started');

    // When
    const state = await mirrorState(opts);

    // Then
    expect(state).toBe('initializing');
  });

  it("returns 'missing' when the lock is held by a pid that is no longer running", async () => {
    // Given
    h = await createHarness();
    const child = spawn('node', ['-e', '']);
    await new Promise((r) => child.once('exit', r));
    const deadPid = child.pid;
    await fs.mkdir(h.home, { recursive: true });
    await fs.writeFile(
      path.join(h.home, 'vm-mirror.lock'),
      JSON.stringify({ pid: deadPid, startTime: 'Thu Jan  1 00:00:00 1970' }),
    );
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const state = await mirrorState(opts);

    // Then
    expect(state).toBe('missing');
  });

  it("treats a lock as live only when its pid runs with the recorded start time", async () => {
    // Given
    h = await createHarness();
    await fs.mkdir(h.home, { recursive: true });
    const lock = path.join(h.home, 'vm-mirror.lock');
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const child = spawn('sleep', ['30']);
    try {
      // When: running pid with a different start time (PID reuse)
      await fs.writeFile(lock, JSON.stringify({ pid: process.pid, startTime: 'Thu Jan  1 00:00:00 1970' }));
      const reusedState = await mirrorState(opts);

      // When: running pid with its actual start time
      const { stdout } = await execFileP('ps', ['-o', 'lstart=', '-p', String(child.pid)], {
        env: { ...process.env, LC_ALL: 'C' },
      });
      await fs.writeFile(lock, JSON.stringify({ pid: child.pid, startTime: stdout.trim() }));
      const liveState = await mirrorState(opts);

      // Then
      expect(reusedState).toBe('missing');
      expect(liveState).toBe('initializing');
    } finally {
      child.kill();
    }
  });

  it("returns 'missing' when the lock content is unparseable", async () => {
    // Given
    h = await createHarness();
    await fs.mkdir(h.home, { recursive: true });
    await fs.writeFile(path.join(h.home, 'vm-mirror.lock'), '');
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const state = mirrorState(opts);

    // Then
    await expect(state).resolves.toBe('missing');
  });
});

describe('setupVmMirror', () => {
  let h: Harness | undefined;

  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it("returns 'ready' without invoking git when <home>/vm-mirror exists", async () => {
    // Given
    h = await createHarness();
    await fs.mkdir(path.join(h.home, 'vm-mirror'), { recursive: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const result = await setupVmMirror(opts);

    // Then
    expect(result).toBe('ready');
    expect(await h.argvLog()).toEqual([]);
  });

  it("returns 'started' without awaiting the clone and spawns a bare clone into a pid-suffixed tmp dir", async () => {
    // Given
    h = await createHarness({ gated: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const result = await setupVmMirror(opts);

    // Then
    expect(result).toBe('started');
    await waitFor(async () => (await h!.argvLog()).some((argv) => argv[0] === 'clone'));
    expect((await h.argvLog()).filter((argv) => argv[0] === 'clone')).toEqual([
      ['clone', '--bare', '--quiet', h.upstreamUrl, path.join(h.home, 'vm-mirror.tmp-' + process.pid)],
    ]);
  });

  it('renames the finished bare clone to <home>/vm-mirror on clone exit 0', async () => {
    // Given
    h = await createHarness({ gated: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    await setupVmMirror(opts);
    await h.releaseClone();
    await waitFor(async () => (await mirrorState(opts)) === 'ready');

    // Then
    const { stdout } = await execFileP('git', [
      '--git-dir=' + path.join(h.home, 'vm-mirror'),
      'rev-parse',
      '--is-bare-repository',
    ]);
    expect(stdout.trim()).toBe('true');
  }, 15000);

  it('releases <home>/vm-mirror.lock after renaming the finished clone', async () => {
    // Given
    h = await createHarness({ gated: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const lockPath = path.join(h.home, 'vm-mirror.lock');
    expect(await setupVmMirror(opts)).toBe('started');

    // When
    await h.releaseClone();
    await waitFor(async () => (await mirrorState(opts)) === 'ready');
    await waitFor(async () => fs.access(lockPath).then(() => false, () => true), 3000).catch(() => undefined);

    // Then
    await expect(fs.access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15000);

  it('does not unlink <home>/vm-mirror.lock on release when another holder has taken it over', async () => {
    // Given
    h = await createHarness({ gated: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const lockPath = path.join(h.home, 'vm-mirror.lock');
    expect(await setupVmMirror(opts)).toBe('started');
    const foreign = JSON.stringify({ pid: 999999, startTime: 'Thu Jan  1 00:00:00 1970' });
    await fs.writeFile(lockPath, foreign);

    // When
    await h.releaseClone();
    await waitFor(async () => (await mirrorState(opts)) === 'ready');
    await new Promise((r) => setTimeout(r, 500));

    // Then
    expect(await fs.readFile(lockPath, 'utf8')).toBe(foreign);
  }, 15000);

  it("returns 'in_progress' and does not spawn a second clone while one is running", async () => {
    // Given
    h = await createHarness({ gated: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    expect(await setupVmMirror(opts)).toBe('started');

    // When
    const result = await setupVmMirror(opts);

    // Then
    expect(result).toBe('in_progress');
    await waitFor(async () => (await h!.argvLog()).some((argv) => argv[0] === 'clone'));
    await new Promise((r) => setTimeout(r, 500));
    const clones = (await h.argvLog()).filter((argv) => argv[0] === 'clone');
    expect(clones.length).toBe(1);
  }, 15000);

  it("starts exactly one clone when called concurrently from distinct option objects sharing a home", async () => {
    // Given
    h = await createHarness({ gated: true });
    const a: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const b: MirrorOptions = { ...a };

    // When
    const results = await Promise.all([a, b, a, b, a].map((o) => setupVmMirror(o)));

    // Then
    expect([...results].sort()).toEqual(['in_progress', 'in_progress', 'in_progress', 'in_progress', 'started']);
    await waitFor(async () => (await h!.argvLog()).some((argv) => argv[0] === 'clone'));
    await new Promise((r) => setTimeout(r, 500));
    const clones = (await h.argvLog()).filter((argv) => argv[0] === 'clone');
    expect(clones.length).toBe(1);
  }, 15000);

  it("re-checks <home>/vm-mirror after acquiring the lock and returns 'ready' without cloning", async () => {
    // Given
    h = await createHarness({ gated: true });
    await fs.mkdir(h.home, { recursive: true });
    const lockFile = path.join(h.home, 'vm-mirror.lock');
    // vm-mirror is a symlink to the lock file: it dangles (reads as 'missing') until the lock
    // is acquired, then resolves, simulating another bridge finishing between check and acquire.
    await fs.symlink(lockFile, path.join(h.home, 'vm-mirror'));
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const result = await setupVmMirror(opts);

    // Then
    expect(result).toBe('ready');
    await new Promise((r) => setTimeout(r, 800));
    expect((await h.argvLog()).some((argv) => argv[0] === 'clone')).toBe(false);
    await expect(fs.access(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15000);

  it("takes over a stale lock, removes leftover tmp dirs, and starts a new clone", async () => {
    // Given
    h = await createHarness({ gated: true });
    const child = spawn('node', ['-e', '']);
    await new Promise((r) => child.once('exit', r));
    const deadPid = child.pid;
    await fs.mkdir(h.home, { recursive: true });
    await fs.writeFile(
      path.join(h.home, 'vm-mirror.lock'),
      JSON.stringify({ pid: deadPid, startTime: 'Thu Jan  1 00:00:00 1970' }),
    );
    const leftover = path.join(h.home, 'vm-mirror.tmp-' + deadPid);
    await fs.mkdir(leftover, { recursive: true });
    await fs.writeFile(path.join(leftover, 'HEAD'), 'ref: refs/heads/main\n');
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const result = await setupVmMirror(opts);

    // Then
    expect(result).toBe('started');
    await expect(fs.access(leftover)).rejects.toMatchObject({ code: 'ENOENT' });
    await waitFor(async () => (await h!.argvLog()).some((argv) => argv[0] === 'clone'));
    await new Promise((r) => setTimeout(r, 500));
    const clones = (await h.argvLog()).filter((argv) => argv[0] === 'clone');
    expect(clones.length).toBe(1);
  }, 15000);

  it('removes the tmp dir, releases the lock and reports the failure on the next call without starting a clone', async () => {
    // Given
    h = await createHarness();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: path.join(h.root, 'does-not-exist.git'), git: h.git };
    const lockFile = path.join(h.home, 'vm-mirror.lock');
    const tmp = path.join(h.home, 'vm-mirror.tmp-' + process.pid);
    expect(await setupVmMirror(opts)).toBe('started');

    // When
    await waitFor(async () => fs.access(lockFile).then(() => false, () => true), 5000).catch(() => undefined);

    // Then
    await expect(fs.access(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(tmp)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await mirrorState(opts)).toBe('missing');
    const next = await setupVmMirror(opts).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(next).toBeInstanceOf(VmSourceError);
    expect((next as VmSourceError).code).toBe('fetch_failed');
    expect((next as VmSourceError).message).toContain('does not exist');
    const clones = (await h.argvLog()).filter((argv) => argv[0] === 'clone');
    expect(clones.length).toBe(1);
  }, 15000);

  it('reports a non-fetch clone failure once as mirror_write_failed, keeps get_vm_source at mirror_missing, then clones anew', async () => {
    // Given
    h = await createHarness();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const lockFile = path.join(h.home, 'vm-mirror.lock');
    await h.failGit('clone', { stderr: 'fatal: could not write: No space left on device' });
    expect(await setupVmMirror(opts)).toBe('started');
    await waitFor(async () => fs.access(lockFile).then(() => false, () => true), 5000);

    // When
    const state = await mirrorState(opts);
    const lookup = await getVmSource(opts, {
      vmVersion: 'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794]',
      lookupKey: 'x',
      module: 'SocketPlugin',
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    const next = await setupVmMirror(opts).then(
      () => undefined,
      (e: unknown) => e,
    );
    await h.clearGitFailures();
    const retry = await setupVmMirror(opts);

    // Then
    expect(state).toBe('missing');
    expect(lookup).toBeInstanceOf(VmSourceError);
    expect((lookup as VmSourceError).code).toBe('mirror_missing');
    expect(next).toBeInstanceOf(VmSourceError);
    expect((next as VmSourceError).code).toBe('mirror_write_failed');
    expect((next as VmSourceError).message).toContain('No space left on device');
    expect(retry).toBe('started');
    await waitFor(async () => (await mirrorState(opts)) === 'ready');
  }, 15000);

  it('lets exactly one of two concurrent calls after a failed clone report it while the other proceeds', async () => {
    // Given
    h = await createHarness();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const lockFile = path.join(h.home, 'vm-mirror.lock');
    await h.failGit('clone', { stderr: 'fatal: write error: No space left on device' });
    expect(await setupVmMirror(opts)).toBe('started');
    await waitFor(async () => fs.access(lockFile).then(() => false, () => true), 5000);
    await h.clearGitFailures();

    // When
    const results = await Promise.allSettled([setupVmMirror(opts), setupVmMirror({ ...opts })]);

    // Then
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<'started' | 'in_progress'> => r.status === 'fulfilled');
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(VmSourceError);
    expect((rejected[0].reason as VmSourceError).code).toBe('mirror_write_failed');
    expect(fulfilled.length).toBe(1);
    expect(['started', 'in_progress']).toContain(fulfilled[0].value);
    await waitFor(async () => (await mirrorState(opts)) === 'ready');
    const clones = (await h.argvLog()).filter((argv) => argv[0] === 'clone');
    expect(clones.length).toBe(2);
  }, 15000);

  it('keeps only the tail of a chatty clone stderr in the reported failure', async () => {
    // Given
    h = await createHarness();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const lockFile = path.join(h.home, 'vm-mirror.lock');
    await h.failGit('clone', { stderr: 'HEAD-MARKER\n' + 'x'.repeat(200_000) + '\nfatal: TAIL-MARKER' });
    expect(await setupVmMirror(opts)).toBe('started');
    await waitFor(async () => fs.access(lockFile).then(() => false, () => true), 5000);

    // When
    const next = await setupVmMirror(opts).then(
      () => undefined,
      (e: unknown) => e,
    );

    // Then
    expect(next).toBeInstanceOf(VmSourceError);
    expect((next as VmSourceError).code).toBe('mirror_write_failed');
    expect((next as VmSourceError).message).toContain('TAIL-MARKER');
    expect((next as VmSourceError).message).not.toContain('HEAD-MARKER');
    expect((next as VmSourceError).message.length).toBeLessThan(70_000);
  }, 15000);

  it('throws git_unavailable instead of starting a clone when git cannot be run, leaving no lock or tmp dir', async () => {
    // Given
    h = await createHarness();
    const home = await h.freshHome();
    const opts: MirrorOptions = { home, upstreamUrl: h.upstreamUrl, git: path.join(h.root, 'no-such-git') };

    // When
    const err = await setupVmMirror(opts).then(
      (r) => r,
      (e: unknown) => e,
    );

    // Then
    expect(err).toBeInstanceOf(VmSourceError);
    expect((err as VmSourceError).code).toBe('git_unavailable');
    expect((err as VmSourceError).message).toContain('git is required');
    await expect(fs.access(path.join(home, 'vm-mirror.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    const entries = await fs.readdir(home).catch(() => [] as string[]);
    expect(entries.filter((e) => e.startsWith('vm-mirror.tmp-'))).toEqual([]);
  }, 15000);

  it('records a clone spawn error as mirror_write_failed carrying the error message and reports it on the next call', async () => {
    // Given: a git stub whose --version probe passes but removes itself, so the clone spawn fails with ENOENT
    h = await createHarness();
    const home = await h.freshHome();
    const stubDir = await fs.mkdtemp(path.join(h.root, 'stub-git-'));
    const stub = path.join(stubDir, 'git');
    await fs.writeFile(stub, '#!/bin/sh\nif [ "$1" = "--version" ]; then rm -- "$0"; fi\nexit 0\n', { mode: 0o755 });
    const opts: MirrorOptions = { home, upstreamUrl: h.upstreamUrl, git: stub };
    expect(await setupVmMirror(opts)).toBe('started');
    await waitFor(async () => fs.access(path.join(home, 'vm-mirror.lock')).then(() => false, () => true), 5000);

    // When
    const state = await mirrorState(opts);
    const next = await setupVmMirror(opts).then(
      () => undefined,
      (e: unknown) => e,
    );

    // Then
    expect(state).toBe('missing');
    expect(next).toBeInstanceOf(VmSourceError);
    expect((next as VmSourceError).code).toBe('mirror_write_failed');
    expect((next as VmSourceError).message).toContain('ENOENT');
  }, 15000);

  it('kills the clone and exits with 128+signo when this process gets SIGTERM, SIGINT or SIGHUP', async () => {
    for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]] as const) {
      // Given a running (gated) clone and process.exit stubbed out
      await h?.cleanup();
      h = await createHarness({ gated: true });
      const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
      const lockFile = path.join(h.home, 'vm-mirror.lock');
      const before = process.listeners(sig);
      expect(await setupVmMirror(opts)).toBe('started');
      await waitFor(async () => (await h!.argvLog()).length === 1);
      const added = process.listeners(sig).filter((l) => !before.includes(l));
      expect(added).toHaveLength(1);
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      try {
        // When the signal arrives
        (added[0] as (s: NodeJS.Signals) => void)(sig);

        // Then the process exits with 128+signo, and the killed clone is abandoned (lock released)
        expect(exit).toHaveBeenCalledWith(code);
        await waitFor(async () => fs.access(lockFile).then(() => false, () => true), 3000);
        expect(await mirrorState(opts)).toBe('missing');
        expect(process.listeners(sig)).toEqual(before);
      } finally {
        exit.mockRestore();
      }
    }
  }, 30000);

  it('removes its signal handlers once the clone finishes', async () => {
    // Given
    h = await createHarness();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const before = (['SIGTERM', 'SIGINT', 'SIGHUP'] as const).map((s) => process.listenerCount(s));

    // When
    await setUpToCompletion(opts);

    // Then
    expect((['SIGTERM', 'SIGINT', 'SIGHUP'] as const).map((s) => process.listenerCount(s))).toEqual(before);
  }, 15000);

  it('writes nothing outside <home>/vm-mirror during a full setup', async () => {
    // Given
    h = await createHarness();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const harnessFiles = new Set(['argv.log', 'done.log']);
    const before = await listTree(h.root);

    // When
    await setUpToCompletion(opts);

    // Then
    const created = [...(await listTree(h.root)).keys()].filter(
      (rel) => !before.has(rel) && !harnessFiles.has(rel),
    );
    expect(created.length).toBeGreaterThan(0);
    for (const rel of created) {
      expect(rel === 'home' || rel === path.join('home', 'vm-mirror') || rel.startsWith(path.join('home', 'vm-mirror') + path.sep)).toBe(true);
    }
  }, 15000);

  it('writes nothing outside <home> but vm-mirror.error after a failed clone, and leaves nothing once it is consumed', async () => {
    // Given
    h = await createHarness();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const lockFile = path.join(h.home, 'vm-mirror.lock');
    const isHarnessEntry = (rel: string) =>
      ['argv.log', 'done.log'].includes(rel) || /^(fail-|kill-|flood-)/.test(path.basename(rel));
    const before = await listTree(h.root);
    const createdSince = async () =>
      [...(await listTree(h!.root)).keys()].filter((rel) => !before.has(rel) && !isHarnessEntry(rel));
    await h.failGit('clone', { stderr: 'fatal: write error: No space left on device' });

    // When the clone fails and the failure has not yet been consumed
    expect(await setupVmMirror(opts)).toBe('started');
    await waitFor(async () => fs.access(lockFile).then(() => false, () => true), 5000);
    const beforeConsume = await createdSince();

    // Then only home and the error file exist
    for (const rel of beforeConsume) {
      expect(['home', path.join('home', 'vm-mirror.error')]).toContain(rel);
    }

    // When the failure is consumed by the next call
    await expect(setupVmMirror(opts)).rejects.toBeInstanceOf(VmSourceError);

    // Then nothing but home remains
    for (const rel of await createdSince()) {
      expect(rel).toBe('home');
    }
  }, 15000);

  it.skipIf(process.getuid?.() === 0)("rejects with mirror_write_failed carrying the errno text when home cannot be created", async () => {
    // Given
    h = await createHarness();
    const dir = path.join(h.root, 'ro');
    await fs.mkdir(dir);
    await fs.chmod(dir, 0o555);
    const opts: MirrorOptions = { home: path.join(dir, 'home'), upstreamUrl: h.upstreamUrl, git: h.git };

    try {
      // When
      const result = setupVmMirror(opts);

      // Then
      await expect(result).rejects.toBeInstanceOf(VmSourceError);
      await expect(result).rejects.toMatchObject({
        code: 'mirror_write_failed',
        message: expect.stringContaining('EACCES'),
      });
    } finally {
      await fs.chmod(dir, 0o755);
    }
  });

  describe('with a project-local cwd', () => {
    const originalCwd = process.cwd();

    afterEach(() => {
      process.chdir(originalCwd);
    });

    it('never touches an opensmalltalk-vm/ checkout in the current directory', async () => {
      // Given
      h = await createHarness();
      const project = path.join(h.root, 'project');
      const checkout = path.join(project, 'opensmalltalk-vm');
      await fs.mkdir(path.join(checkout, 'platforms'), { recursive: true });
      await fs.writeFile(path.join(checkout, 'README'), 'project-local VM checkout\n');
      const before = await listTree(project);
      process.chdir(project);
      const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

      // When
      await setUpToCompletion(opts);

      // Then
      expect(await listTree(project)).toEqual(before);
      expect((await h.argvLog()).flat().some((arg) => arg.includes('opensmalltalk-vm'))).toBe(false);
    }, 15000);

    it("reuses the shared mirror from a different project's cwd", async () => {
      // Given
      h = await createHarness();
      const projectA = path.join(h.root, 'project-a');
      const projectB = path.join(h.root, 'project-b');
      await fs.mkdir(projectA);
      await fs.mkdir(projectB);
      process.chdir(projectA);
      await setUpToCompletion({ home: h.home, upstreamUrl: h.upstreamUrl, git: h.git });
      const argvBefore = await h.argvLog();

      // When
      process.chdir(projectB);
      const result = await setupVmMirror({ home: h.home, upstreamUrl: h.upstreamUrl, git: h.git });

      // Then
      expect(result).toBe('ready');
      expect(await h.argvLog()).toEqual(argvBefore);
      expect(await fs.readdir(projectB)).toEqual([]);
    }, 15000);
  });
});
