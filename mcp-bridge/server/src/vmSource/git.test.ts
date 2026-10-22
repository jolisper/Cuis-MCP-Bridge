import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { VmSourceError } from './errors.js';
import { isLockContention, probeGit, readGit, runGit } from './git.js';
import type { MirrorOptions } from './mirror.js';
import { createHarness, type Harness } from './testSupport/harness.js';

const execFileP = promisify(execFile);

describe('runGit', () => {
  let h: Harness | undefined;

  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it('runs git against the mirror dir via --git-dir and resolves to stdout', async () => {
    // Given
    h = await createHarness();
    const mirrorDir = path.join(h.home, 'vm-mirror');
    await execFileP(h.git, ['clone', '--bare', '--quiet', h.upstreamUrl, mirrorDir]);
    const mark = (await h.argvLog()).length;
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const out = await runGit(opts, ['rev-parse', '--is-bare-repository']);

    // Then
    expect(out).toBe('true\n');
    expect((await h.argvLog()).slice(mark)).toEqual([
      ['--git-dir=' + mirrorDir, 'rev-parse', '--is-bare-repository'],
    ]);
  });

  it('rejects with an Error whose message is git trimmed stderr and carries stderr', async () => {
    // Given
    h = await createHarness();
    const mirrorDir = path.join(h.home, 'vm-mirror');
    await execFileP(h.git, ['clone', '--bare', '--quiet', h.upstreamUrl, mirrorDir]);
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const err = await runGit(opts, ['show', 'deadbeef:nope']).then(
      () => undefined,
      (e: unknown) => e,
    );

    // Then
    expect(err).toBeInstanceOf(Error);
    const e = err as Error & { stderr?: unknown };
    expect(Object.prototype.hasOwnProperty.call(e, 'stderr')).toBe(true);
    expect(typeof e.stderr).toBe('string');
    expect(e.stderr).toContain('fatal:');
    expect(e.message).toMatch(/^fatal:/);
    expect(e.message).toBe((e.stderr as string).trim());
  });

  it('marks a git-reported failure with an own numeric exitCode property', async () => {
    // Given
    h = await createHarness();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const err = await runGit(opts, ['rev-parse', 'Cog']).then(
      () => undefined,
      (e: unknown) => e,
    );

    // Then
    const e = err as Error & { stderr?: unknown; exitCode?: unknown };
    expect(Object.prototype.hasOwnProperty.call(e, 'exitCode')).toBe(true);
    expect(e.exitCode).toBe(128);
    expect(e.stderr).toContain('fatal:');
  });

  it('rejects with a non-empty message naming ENOENT when the git binary does not exist', async () => {
    // Given
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rungit-enoent-'));
    const opts: MirrorOptions = { home: tmp, upstreamUrl: 'unused', git: '/nonexistent/git' };

    try {
      // When
      const err = await runGit(opts, ['status']).then(
        () => undefined,
        (e: unknown) => e,
      );

      // Then
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/ENOENT/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('rejects with a git_unavailable VmSourceError naming ENOENT when the git binary does not exist', async () => {
    // Given
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rungit-unavailable-'));
    const opts: MirrorOptions = {
      home: tmp,
      upstreamUrl: 'unused',
      git: path.join(tmp, 'no-such-git'),
    };

    try {
      // When
      const err = await runGit(opts, ['--version']).then(
        () => undefined,
        (e: unknown) => e,
      );

      // Then
      expect(err).toBeInstanceOf(VmSourceError);
      expect((err as VmSourceError).code).toBe('git_unavailable');
      expect((err as VmSourceError).message).toContain('ENOENT');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('rejects with a git_unavailable VmSourceError naming EACCES when the git binary is not executable', async () => {
    // Given
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rungit-eacces-'));
    const notExecutable = path.join(tmp, 'not-executable-git');
    await writeFile(notExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    const opts: MirrorOptions = { home: tmp, upstreamUrl: 'unused', git: notExecutable };

    try {
      // When
      const err = await runGit(opts, ['--version']).then(
        () => undefined,
        (e: unknown) => e,
      );

      // Then
      expect(err).toBeInstanceOf(VmSourceError);
      expect((err as VmSourceError).code).toBe('git_unavailable');
      expect((err as VmSourceError).message).toContain('EACCES');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('rejects with an internal_error VmSourceError naming SIGKILL when the git process is killed', async () => {
    // Given
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rungit-killed-'));
    const killed = path.join(tmp, 'killed-git');
    await writeFile(killed, '#!/bin/sh\nkill -9 $$\n', { mode: 0o755 });
    const opts: MirrorOptions = { home: tmp, upstreamUrl: 'unused', git: killed };

    try {
      // When
      const err = await runGit(opts, ['rev-parse', 'Cog']).then(
        () => undefined,
        (e: unknown) => e,
      );

      // Then
      expect(err).toBeInstanceOf(VmSourceError);
      expect((err as VmSourceError).code).toBe('internal_error');
      expect((err as VmSourceError).message).toContain('SIGKILL');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('runs git with LC_ALL=C and GIT_TERMINAL_PROMPT=0 overriding the parent env', async () => {
    // Given
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rungit-env-'));
    const stub = path.join(tmp, 'git-stub');
    await writeFile(stub, `#!/bin/sh\nprintf '%s %s\\n' "$LC_ALL" "$GIT_TERMINAL_PROMPT"\n`, {
      mode: 0o755,
    });
    const savedLcAll = process.env.LC_ALL;
    const savedPrompt = process.env.GIT_TERMINAL_PROMPT;
    process.env.LC_ALL = 'en_US.UTF-8';
    delete process.env.GIT_TERMINAL_PROMPT;
    const opts: MirrorOptions = { home: tmp, upstreamUrl: 'unused', git: stub };

    try {
      // When
      const out = await runGit(opts, ['status']);

      // Then
      expect(out).toBe('C 0\n');
    } finally {
      if (savedLcAll === undefined) delete process.env.LC_ALL;
      else process.env.LC_ALL = savedLcAll;
      if (savedPrompt === undefined) delete process.env.GIT_TERMINAL_PROMPT;
      else process.env.GIT_TERMINAL_PROMPT = savedPrompt;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('resolves stdout larger than the 1 MB default maxBuffer', async () => {
    // Given
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rungit-big-'));
    const stub = path.join(tmp, 'git-stub');
    await writeFile(stub, `#!/bin/sh\nhead -c 2097152 /dev/zero | tr '\\0' 'a'\n`, {
      mode: 0o755,
    });
    const opts: MirrorOptions = { home: tmp, upstreamUrl: 'unused', git: stub };

    try {
      // When
      const out = await runGit(opts, ['show', 'x']);

      // Then
      expect(out.length).toBe(2097152);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('rejects with an internal_error VmSourceError naming maxBuffer when stdout exceeds the buffer', async () => {
    // Given
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rungit-overflow-'));
    const stub = path.join(tmp, 'git-stub');
    await writeFile(stub, '#!/bin/sh\nhead -c 68157440 /dev/zero\n', { mode: 0o755 });
    const opts: MirrorOptions = { home: tmp, upstreamUrl: 'unused', git: stub };

    try {
      // When
      const err = await runGit(opts, ['show', 'x']).then(
        () => undefined,
        (e: unknown) => e,
      );

      // Then
      expect(err).toBeInstanceOf(VmSourceError);
      expect((err as VmSourceError).code).toBe('internal_error');
      expect((err as VmSourceError).message).toContain('maxBuffer');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 20000);
});

describe('isLockContention', () => {
  it('recognises index-lock and ref-lock contention stderr but not other git errors', () => {
    // Given
    const indexLock = "fatal: Unable to create '/x/refs/heads/Cog.lock': File exists.";
    const refLock = "error: cannot lock ref 'refs/heads/Cog': is at abc but expected def";
    const other = "fatal: invalid object name 'deadbeef'.";

    // When
    const results = [indexLock, refLock, other].map(isLockContention);

    // Then
    expect(results).toEqual([true, true, false]);
  });
});

describe('readGit', () => {
  let h: Harness | undefined;

  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it('turns a git-reported failure into a mirror_corrupt VmSourceError naming the mirror path and setup_vm_mirror', async () => {
    // Given
    h = await createHarness();
    const mirrorDir = path.join(h.home, 'vm-mirror');
    await mkdir(mirrorDir, { recursive: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const err = await readGit(opts, ['rev-parse', 'Cog']).then(
      () => undefined,
      (e: unknown) => e,
    );

    // Then
    expect(err).toBeInstanceOf(VmSourceError);
    const e = err as VmSourceError;
    expect(e.code).toBe('mirror_corrupt');
    expect(e.message).toContain(mirrorDir);
    expect(e.message).toContain('setup_vm_mirror');
    expect(e.message).toContain('not a git repository');
  });

  it.each([
    ['git_unavailable', 'a nonexistent git binary', null],
    ['internal_error', 'a git process killed by SIGKILL', '#!/bin/sh\nkill -9 $$\n'],
  ] as const)(
    'passes a %s VmSourceError from runGit through untouched for %s',
    async (expectedCode, _label, stubScript) => {
      // Given
      const tmp = await mkdtemp(path.join(os.tmpdir(), 'readgit-passthrough-'));
      const git = path.join(tmp, 'git-stub');
      if (stubScript !== null) await writeFile(git, stubScript, { mode: 0o755 });
      const opts: MirrorOptions = { home: tmp, upstreamUrl: 'unused', git };

      try {
        // When
        const err = await readGit(opts, ['rev-parse', 'Cog']).then(
          () => undefined,
          (e: unknown) => e,
        );

        // Then
        expect(err).toBeInstanceOf(VmSourceError);
        expect((err as VmSourceError).code).toBe(expectedCode);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  );
});

describe('probeGit', () => {
  let h: Harness | undefined;

  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it.each([
    ['test upstream', true],
    ['no such text', false],
  ] as const)('resolves a git grep -q for %j to %s', async (needle, expected) => {
    // Given
    h = await createHarness();
    await h.cloneMirror();
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const found = await probeGit(opts, ['grep', '-q', '-F', needle, 'Cog', '--', 'README']);

    // Then
    expect(found).toBe(expected);
  });

  it('rejects with mirror_corrupt when the mirror dir is not a git repository', async () => {
    // Given
    h = await createHarness();
    await mkdir(path.join(h.home, 'vm-mirror'), { recursive: true });
    const opts: MirrorOptions = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const err = await probeGit(opts, ['grep', '-q', '-F', 'x', 'Cog']).then(
      () => undefined,
      (e: unknown) => e,
    );

    // Then
    expect(err).toBeInstanceOf(VmSourceError);
    expect((err as VmSourceError).code).toBe('mirror_corrupt');
  });
});
