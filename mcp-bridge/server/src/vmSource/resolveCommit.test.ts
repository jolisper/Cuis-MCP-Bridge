import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VmSourceError } from './errors.js';
import { resolveCommit, stampWindowCommit } from './resolveCommit.js';
import { coreInterp, plugin } from './testSupport/fixtures.js';
import { createHarness, type Harness } from './testSupport/harness.js';

describe('resolveCommit', () => {
  let h: Harness;
  let sha3738: string;
  let sha3739: string;

  beforeAll(async () => {
    h = await createHarness();
    const cointerp = 'src/spur64.cog/cointerp.c';
    await h.pushUpstream({ [cointerp]: coreInterp({ version: '3737' }) }, 'CogVM source as per VMMaker.oscog-eem.3737');
    await h.pushUpstream({ [cointerp]: coreInterp({ version: '37380' }) }, 'CogVM source as per VMMaker.oscog-eem.37380');
    sha3738 = await h.pushUpstream(
      { [cointerp]: coreInterp({ version: '3738' }) },
      'CogVM source as per VMMaker.oscog-eem.3739',
    );
    await h.pushUpstream({ [cointerp]: coreInterp({ version: '3738' }), README: 'x\n' }, 'unrelated');
    sha3739 = await h.pushUpstream({ [cointerp]: coreInterp({ version: '3739' }) }, 'CogVM source as per VMMaker.oscog-eem.3739');
    await h.cloneMirror();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('returns the commit whose cointerp.c introduced the token, via one pickaxe log and no fetch', async () => {
    // Given
    const mark = await h.argvMark();

    // When
    const { commit: sha } = await resolveCommit({ home: h.home, upstreamUrl: h.upstreamUrl, git: h.git }, 'VMMaker.oscog-eem.3738');

    // Then
    expect(sha).toBe(sha3738);
    expect(await h.argvSince(mark)).toEqual([
      ['--git-dir=' + path.join(h.home, 'vm-mirror'), 'rev-parse', 'Cog'],
      [
        '--git-dir=' + path.join(h.home, 'vm-mirror'),
        'log',
        'Cog',
        '--reverse',
        '--format=%H',
        '-SVMMaker.oscog-eem.3738]',
        '--',
        'src/*/cointerp.c',
        'src/*/interp.c',
      ],
    ]);
  });

  it('returns every pickaxe hit oldest first, with commit equal to the first hit', async () => {
    // Given
    const opts = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const result = await resolveCommit(opts, 'VMMaker.oscog-eem.3738');

    // Then
    expect(result.hits).toEqual([sha3738, sha3739]);
    expect(result.commit).toBe(result.hits[0]);
    expect(result.commit).toBe(sha3738);
  });

  it('fetches Cog once and re-runs the pickaxe when the token is not yet in the mirror', async () => {
    // Given
    const own = await createHarness();
    try {
      const cointerp = 'src/spur64.cog/cointerp.c';
      await own.pushUpstream({ [cointerp]: coreInterp({ version: '3999' }) }, 'CogVM source as per VMMaker.oscog-eem.3999');
      await own.cloneMirror();
      const sha4000 = await own.pushUpstream(
        { [cointerp]: coreInterp({ version: '4000' }) },
        'CogVM source as per VMMaker.oscog-eem.4000',
      );
      const mark = await own.argvMark();
      const gitDir = '--git-dir=' + path.join(own.home, 'vm-mirror');
      const pickaxeArgv = [
        gitDir,
        'log',
        'Cog',
        '--reverse',
        '--format=%H',
        '-SVMMaker.oscog-eem.4000]',
        '--',
        'src/*/cointerp.c',
        'src/*/interp.c',
      ];

      // When
      const { commit: sha } = await resolveCommit({ home: own.home, upstreamUrl: own.upstreamUrl, git: own.git }, 'VMMaker.oscog-eem.4000');

      // Then
      expect(sha).toBe(sha4000);
      expect(await own.argvSince(mark)).toEqual([
        [gitDir, 'rev-parse', 'Cog'],
        pickaxeArgv,
        [gitDir, 'rev-parse', 'Cog'],
        [gitDir, 'fetch', '--quiet', 'origin', '+refs/heads/Cog:refs/heads/Cog'],
        pickaxeArgv,
      ]);
    } finally {
      await own.cleanup();
    }
  });

  it('rejects with mirror_busy at once when another process holds the Cog ref lock, after one log and one fetch', async () => {
    // Given
    const own = await createHarness();
    try {
      const cointerp = 'src/spur64.cog/cointerp.c';
      await own.pushUpstream({ [cointerp]: coreInterp({ version: '4199' }) }, 'CogVM source as per VMMaker.oscog-eem.4199');
      await own.cloneMirror();
      await own.pushUpstream({ [cointerp]: coreInterp({ version: '4200' }) }, 'CogVM source as per VMMaker.oscog-eem.4200');
      const lockFile = path.join(own.home, 'vm-mirror', 'refs', 'heads', 'Cog.lock');
      await fs.writeFile(lockFile, '');
      const mark = await own.argvMark();

      // When
      let caught: unknown;
      try {
        await resolveCommit({ home: own.home, upstreamUrl: own.upstreamUrl, git: own.git }, 'VMMaker.oscog-eem.4200');
      } catch (err) {
        caught = err;
      }

      // Then
      expect(caught).toBeInstanceOf(VmSourceError);
      expect((caught as VmSourceError).code).toBe('mirror_busy');
      expect((await own.argvSince(mark)).map((entry) => entry[1])).toEqual(['rev-parse', 'log', 'rev-parse', 'fetch']);
    } finally {
      await own.cleanup();
    }
  });

  it('rejects with commit_not_found naming the full token when no Cog commit carries it, even after one fetch', async () => {
    // Given
    const mark = await h.argvMark();

    // When
    let caught: unknown;
    try {
      await resolveCommit({ home: h.home, upstreamUrl: h.upstreamUrl, git: h.git }, 'VMMaker.oscog-eem.9999');
    } catch (err) {
      caught = err;
    }

    // Then
    expect(caught).toBeInstanceOf(VmSourceError);
    expect((caught as VmSourceError).code).toBe('commit_not_found');
    expect((caught as VmSourceError).message).toContain('VMMaker.oscog-eem.9999');
    const argv = await h.argvSince(mark);
    expect(argv).toHaveLength(5);
    expect(argv.filter((entry) => entry[1] === 'fetch')).toHaveLength(1);
  });

  it('rejects with fetch_failed carrying git\'s text when the fetch hits a network failure, after exactly one fetch', async () => {
    // Given
    const own = await createHarness();
    try {
      const cointerp = 'src/spur64.cog/cointerp.c';
      await own.pushUpstream({ [cointerp]: coreInterp({ version: '4699' }) }, 'CogVM source as per VMMaker.oscog-eem.4699');
      await own.cloneMirror();
      await own.pushUpstream({ [cointerp]: coreInterp({ version: '4700' }) }, 'CogVM source as per VMMaker.oscog-eem.4700');
      await own.failGit('fetch', { stderr: "fatal: unable to access 'https://x/': Could not resolve host: x" });
      const mark = await own.argvMark();

      // When
      let caught: unknown;
      try {
        await resolveCommit({ home: own.home, upstreamUrl: own.upstreamUrl, git: own.git }, 'VMMaker.oscog-eem.4700');
      } catch (err) {
        caught = err;
      }

      // Then
      expect(caught).toBeInstanceOf(VmSourceError);
      expect((caught as VmSourceError).code).toBe('fetch_failed');
      expect((caught as VmSourceError).code).not.toBe('commit_not_found');
      expect((caught as VmSourceError).message).toContain('Could not resolve host');
      expect((await own.argvSince(mark)).filter((entry) => entry[1] === 'fetch')).toHaveLength(1);
    } finally {
      await own.cleanup();
    }
  });

  it('rejects with mirror_write_failed carrying git\'s text when the fetch fails for a reason other than reaching upstream', async () => {
    // Given
    const own = await createHarness();
    try {
      const cointerp = 'src/spur64.cog/cointerp.c';
      await own.pushUpstream({ [cointerp]: coreInterp({ version: '4799' }) }, 'CogVM source as per VMMaker.oscog-eem.4799');
      await own.cloneMirror();
      await own.pushUpstream({ [cointerp]: coreInterp({ version: '4800' }) }, 'CogVM source as per VMMaker.oscog-eem.4800');
      await own.failGit('fetch', { stderr: 'fatal: write error: No space left on device' });
      const mark = await own.argvMark();

      // When
      let caught: unknown;
      try {
        await resolveCommit({ home: own.home, upstreamUrl: own.upstreamUrl, git: own.git }, 'VMMaker.oscog-eem.4800');
      } catch (err) {
        caught = err;
      }

      // Then
      expect(caught).toBeInstanceOf(VmSourceError);
      expect((caught as VmSourceError).code).toBe('mirror_write_failed');
      expect((caught as VmSourceError).message).toContain('No space left on device');
      expect((await own.argvSince(mark)).filter((entry) => entry[1] === 'fetch')).toHaveLength(1);
    } finally {
      await own.cleanup();
    }
  });

  it('surfaces non-lock fetch failures and stays consistent under concurrent calls', async () => {
    const execFileP = promisify(execFile);
    const cointerp = 'src/spur64.cog/cointerp.c';

    // (b) Non-lock fetch failure
    // Given
    const b = await createHarness();
    try {
      await b.pushUpstream({ [cointerp]: coreInterp({ version: '4399' }) }, 'CogVM source as per VMMaker.oscog-eem.4399');
      await b.cloneMirror();
      await fs.rm(b.upstreamUrl, { recursive: true, force: true });

      // When
      let caught: unknown;
      try {
        await resolveCommit({ home: b.home, upstreamUrl: b.upstreamUrl, git: b.git }, 'VMMaker.oscog-eem.4400');
      } catch (err) {
        caught = err;
      }

      // Then
      expect(caught).toBeInstanceOf(VmSourceError);
      expect((caught as VmSourceError).code).toBe('fetch_failed');
      expect((caught as VmSourceError).message).toContain('does not appear to be a git repository');
    } finally {
      await b.cleanup();
    }

    // (c) Concurrent calls
    // Given
    const c = await createHarness();
    try {
      await c.pushUpstream({ [cointerp]: coreInterp({ version: '4499' }) }, 'CogVM source as per VMMaker.oscog-eem.4499');
      await c.cloneMirror();
      const sha4500 = await c.pushUpstream(
        { [cointerp]: coreInterp({ version: '4500' }) },
        'CogVM source as per VMMaker.oscog-eem.4500',
      );
      const opts = { home: c.home, upstreamUrl: c.upstreamUrl, git: c.git };

      // When
      const shas = (await Promise.all([1, 2, 3, 4].map(() => resolveCommit(opts, 'VMMaker.oscog-eem.4500')))).map((r) => r.commit);

      // Then
      expect(shas).toEqual([sha4500, sha4500, sha4500, sha4500]);
      await expect(execFileP('git', ['--git-dir=' + path.join(c.home, 'vm-mirror'), 'fsck'])).resolves.toBeDefined();
    } finally {
      await c.cleanup();
    }
  });

  it('shares one in-flight fetch among concurrent calls on the same mirror', async () => {
    // Given
    const own = await createHarness();
    try {
      const cointerp = 'src/spur64.cog/cointerp.c';
      await own.pushUpstream({ [cointerp]: coreInterp({ version: '4599' }) }, 'CogVM source as per VMMaker.oscog-eem.4599');
      await own.cloneMirror();
      const sha4600 = await own.pushUpstream(
        { [cointerp]: coreInterp({ version: '4600' }) },
        'CogVM source as per VMMaker.oscog-eem.4600',
      );
      const mark = await own.argvMark();
      const opts = { home: own.home, upstreamUrl: own.upstreamUrl, git: own.git };

      // When
      const shas = (await Promise.all([1, 2, 3, 4].map(() => resolveCommit(opts, 'VMMaker.oscog-eem.4600')))).map((r) => r.commit);

      // Then
      expect(shas).toEqual([sha4600, sha4600, sha4600, sha4600]);
      expect((await own.argvSince(mark)).filter((entry) => entry[1] === 'fetch')).toHaveLength(1);
    } finally {
      await own.cleanup();
    }
  });

  it('re-runs the pickaxe without fetching when another fetch moves Cog while the first pickaxe misses', async () => {
    // Given
    const own = await createHarness();
    try {
      const cointerp = 'src/spur64.cog/cointerp.c';
      await own.pushUpstream({ [cointerp]: coreInterp({ version: '4799' }) }, 'CogVM source as per VMMaker.oscog-eem.4799');
      await own.cloneMirror();
      const sha4800 = await own.pushUpstream(
        { [cointerp]: coreInterp({ version: '4800' }) },
        'CogVM source as per VMMaker.oscog-eem.4800',
      );
      const { stdout } = await promisify(execFile)('sh', ['-c', 'command -v git']);
      const realGit = stdout.trim();
      const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
      const marker = path.join(own.root, 'concurrent-fetch-done');
      const wrapper = path.join(own.root, 'git-concurrent-fetch');
      await fs.writeFile(
        wrapper,
        `#!/bin/sh
out=$(${q(own.git)} "$@")
status=$?
for a in "$@"; do
  if [ "$a" = "log" ] && [ ! -e ${q(marker)} ]; then
    : > ${q(marker)}
    ${q(realGit)} ${q('--git-dir=' + path.join(own.home, 'vm-mirror'))} fetch --quiet origin +refs/heads/Cog:refs/heads/Cog
    break
  fi
done
printf '%s\\n' "$out"
exit $status
`,
      );
      await fs.chmod(wrapper, 0o755);
      const mark = await own.argvMark();

      // When
      const { commit: sha } = await resolveCommit({ home: own.home, upstreamUrl: own.upstreamUrl, git: wrapper }, 'VMMaker.oscog-eem.4800');

      // Then
      expect(sha).toBe(sha4800);
      expect((await own.argvSince(mark)).map((entry) => entry[1])).toEqual(['rev-parse', 'log', 'rev-parse', 'log']);
    } finally {
      await own.cleanup();
    }
  });
});

describe('resolveCommit with a corrupt mirror', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await fs.mkdir(path.join(h.home, 'vm-mirror'), { recursive: true });
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('rejects with mirror_corrupt naming the mirror and setup_vm_mirror after only the rev-parse', async () => {
    // Given
    const mirror = path.join(h.home, 'vm-mirror');
    const mark = await h.argvMark();

    // When
    let caught: unknown;
    try {
      await resolveCommit({ home: h.home, upstreamUrl: h.upstreamUrl, git: h.git }, 'VMMaker.oscog-eem.3738');
    } catch (err) {
      caught = err;
    }

    // Then
    expect(caught).toBeInstanceOf(VmSourceError);
    expect((caught as VmSourceError).code).toBe('mirror_corrupt');
    expect((caught as VmSourceError).message).toContain(mirror);
    expect((caught as VmSourceError).message).toContain('setup_vm_mirror');
    expect(await h.argvSince(mark)).toEqual([['--git-dir=' + mirror, 'rev-parse', 'Cog']]);
  });
});

describe('resolveCommit with an unusable git', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await h.pushUpstream(
      { 'src/spur64.cog/cointerp.c': coreInterp({ version: '3738' }) },
      'CogVM source as per VMMaker.oscog-eem.3738',
    );
    await h.cloneMirror();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it.each([
    { name: 'nonexistent git', script: undefined, code: 'git_unavailable', messagePart: undefined },
    { name: 'git killed by SIGKILL', script: '#!/bin/sh\nkill -9 $$\n', code: 'internal_error', messagePart: 'SIGKILL' },
  ])('rejects the first rev-parse with $code when git is $name', async ({ script, code, messagePart }) => {
    // Given
    const git = path.join(h.root, script === undefined ? 'no-such-git' : 'killed-git');
    if (script !== undefined) {
      await fs.writeFile(git, script);
      await fs.chmod(git, 0o755);
    }

    // When
    let caught: unknown;
    try {
      await resolveCommit({ home: h.home, upstreamUrl: h.upstreamUrl, git }, 'VMMaker.oscog-eem.3738');
    } catch (err) {
      caught = err;
    }

    // Then
    expect(caught).toBeInstanceOf(VmSourceError);
    expect((caught as VmSourceError).code).toBe(code);
    if (messagePart !== undefined) expect((caught as VmSourceError).message).toContain(messagePart);
  });
});

describe('stampWindowCommit', () => {
  let h: Harness;
  let sha1: string;
  let sha2: string;

  beforeAll(async () => {
    h = await createHarness();
    const cointerp = 'src/spur64.cog/cointerp.c';
    const pluginPath = 'src/plugins/SocketPlugin/SocketPlugin.c';
    sha1 = await h.pushUpstream(
      {
        [cointerp]: coreInterp({ version: '3794' }),
        [pluginPath]: plugin({ module: 'SocketPlugin', stampVersion: '3700' }),
      },
      'CogVM source as per VMMaker.oscog-eem.3794',
    );
    sha2 = await h.pushUpstream(
      { [pluginPath]: plugin({ module: 'SocketPlugin', stampVersion: '3743' }) },
      'plugin update',
    );
    await h.pushUpstream({ README2: 'x\n' }, 'unrelated');
    await h.pushUpstream({ [cointerp]: coreInterp({ version: '3795' }) }, 'CogVM source as per VMMaker.oscog-eem.3795');
    await h.cloneMirror();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('returns the first window commit whose plugin file carries the running stamp, or undefined, without fetching', async () => {
    // Given
    const opts = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const token = 'VMMaker.oscog-eem.3794';
    const pluginPath = 'src/plugins/SocketPlugin/SocketPlugin.c';
    const r = await resolveCommit(opts, token);
    const mark = await h.argvMark();

    // When
    const at3743 = await stampWindowCommit(opts, token, r.hits, pluginPath, 'SocketPlugin VMMaker.oscog-eem.3743');
    const at3700 = await stampWindowCommit(opts, token, r.hits, pluginPath, 'SocketPlugin VMMaker.oscog-eem.3700');
    const at9999 = await stampWindowCommit(opts, token, r.hits, pluginPath, 'SocketPlugin VMMaker.oscog-eem.9999');

    // Then
    expect(at3743).toBe(sha2);
    expect(at3700).toBe(sha1);
    expect(at9999).toBeUndefined();
    expect((await h.argvSince(mark)).filter((entry) => entry[1] === 'fetch')).toHaveLength(0);
  });
});

describe('stampWindowCommit with an open window and a mirror that predates the build', () => {
  const token = 'VMMaker.oscog-eem.3794';
  const pluginPath = 'src/plugins/SocketPlugin/SocketPlugin.c';
  const harnesses: Harness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map((h) => h.cleanup()));
  });

  async function setup() {
    const h = await createHarness();
    harnesses.push(h);
    const sha1 = await h.pushUpstream(
      {
        'src/spur64.cog/cointerp.c': coreInterp({ version: '3794' }),
        [pluginPath]: plugin({ module: 'SocketPlugin', stampVersion: '3700' }),
      },
      'CogVM source as per VMMaker.oscog-eem.3794',
    );
    await h.cloneMirror();
    const sha2 = await h.pushUpstream(
      { [pluginPath]: plugin({ module: 'SocketPlugin', stampVersion: '4000' }) },
      'plugin update after clone',
    );
    const opts = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const r = await resolveCommit(opts, token);
    const mark = await h.argvMark();
    return { h, opts, r, mark, sha1, sha2 };
  }

  it('fetches once and finds the matching commit among the new commits only', async () => {
    // Given
    const { h, opts, r, mark, sha1, sha2 } = await setup();

    // When
    const found = await stampWindowCommit(opts, token, r.hits, pluginPath, 'SocketPlugin VMMaker.oscog-eem.4000');

    // Then
    const argv = await h.argvSince(mark);
    const logs = argv.filter((entry) => entry.includes('log'));
    expect(found).toBe(sha2);
    expect(argv.filter((entry) => entry[1] === 'fetch')).toHaveLength(1);
    expect(logs.some((entry) => entry.some((arg) => arg.includes(`${sha1}..Cog`)))).toBe(true);
    expect(logs.every((entry) => entry.some((arg) => arg.includes('..')))).toBe(true);
  });

  it('returns undefined after exactly one fetch when no new commit carries the running stamp', async () => {
    // Given
    const { h, opts, r, mark } = await setup();

    // When
    const found = await stampWindowCommit(opts, token, r.hits, pluginPath, 'SocketPlugin VMMaker.oscog-eem.9999');

    // Then
    expect(found).toBeUndefined();
    expect((await h.argvSince(mark)).filter((entry) => entry[1] === 'fetch')).toHaveLength(1);
  });

  it('rejects with fetch_failed carrying git\'s text when the refresh fetch fails', async () => {
    // Given
    const { h, opts, r } = await setup();
    await h.failGit('fetch', { stderr: "fatal: unable to access 'https://x/': Could not resolve host: x" });

    // When
    let caught: unknown;
    try {
      await stampWindowCommit(opts, token, r.hits, pluginPath, 'SocketPlugin VMMaker.oscog-eem.4000');
    } catch (err) {
      caught = err;
    }

    // Then
    expect(caught).toBeInstanceOf(VmSourceError);
    expect((caught as VmSourceError).code).toBe('fetch_failed');
    expect((caught as VmSourceError).message).toContain('Could not resolve host');
  });
});

describe('stampWindowCommit with a hit that only adds the token to a second interpreter file', () => {
  let h: Harness;
  let sha2: string;
  let sha3: string;
  let sha4: string;
  let sha5: string;
  let sha1: string;

  beforeAll(async () => {
    h = await createHarness();
    const cointerp64 = 'src/spur64.cog/cointerp.c';
    const cointerp32 = 'src/spur32.cog/cointerp.c';
    const pluginPath = 'src/plugins/SocketPlugin/SocketPlugin.c';
    sha1 = await h.pushUpstream(
      {
        [cointerp64]: coreInterp({ version: '3794' }),
        [pluginPath]: plugin({ module: 'SocketPlugin', stampVersion: '3700' }),
      },
      'CogVM source as per VMMaker.oscog-eem.3794',
    );
    sha2 = await h.pushUpstream({ [cointerp32]: coreInterp({ version: '3794' }) }, 'second interpreter file');
    sha3 = await h.pushUpstream(
      { [pluginPath]: plugin({ module: 'SocketPlugin', stampVersion: '3743' }) },
      'plugin update',
    );
    sha4 = await h.pushUpstream({ [cointerp64]: coreInterp({ version: '3795' }) }, 'CogVM 64 bump');
    sha5 = await h.pushUpstream({ [cointerp32]: coreInterp({ version: '3795' }) }, 'CogVM 32 bump');
    await h.cloneMirror();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('does not end the window at a hit while another interpreter file still carries the token', async () => {
    // Given
    const opts = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const token = 'VMMaker.oscog-eem.3794';
    const r = await resolveCommit(opts, token);

    // When
    const found = await stampWindowCommit(
      opts,
      token,
      r.hits,
      'src/plugins/SocketPlugin/SocketPlugin.c',
      'SocketPlugin VMMaker.oscog-eem.3743',
    );

    // Then
    expect(r.hits).toEqual([sha1, sha2, sha4, sha5]);
    expect(found).toBe(sha3);
  });
});

describe('stampWindowCommit with a closed window and an unreachable network', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    const cointerp = 'src/spur64.cog/cointerp.c';
    await h.pushUpstream(
      {
        [cointerp]: coreInterp({ version: '3794' }),
        'src/plugins/SocketPlugin/SocketPlugin.c': plugin({ module: 'SocketPlugin', stampVersion: '3700' }),
      },
      'CogVM source as per VMMaker.oscog-eem.3794',
    );
    await h.pushUpstream({ [cointerp]: coreInterp({ version: '3795' }) }, 'CogVM source as per VMMaker.oscog-eem.3795');
    await h.cloneMirror();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('returns undefined on a stamp mismatch without attempting any fetch', async () => {
    // Given
    const opts = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
    const token = 'VMMaker.oscog-eem.3794';
    await h.failGit('fetch', { stderr: "fatal: unable to access 'https://x/': Could not resolve host: x" });
    const r = await resolveCommit(opts, token);
    const mark = await h.argvMark();

    // When
    const found = await stampWindowCommit(
      opts,
      token,
      r.hits,
      'src/plugins/SocketPlugin/SocketPlugin.c',
      'SocketPlugin VMMaker.oscog-eem.9999',
    );

    // Then
    expect(found).toBeUndefined();
    expect((await h.argvSince(mark)).filter((entry) => entry[1] === 'fetch')).toHaveLength(0);
  });
});

describe('resolveCommit with the same number from different authors', () => {
  let h: Harness;
  let shaMt: string;
  let shaEem: string;

  beforeAll(async () => {
    h = await createHarness();
    const cointerp = 'src/spur64.cog/cointerp.c';
    shaMt = await h.pushUpstream(
      { [cointerp]: coreInterp({ author: 'mt', version: '3568' }) },
      'CogVM source as per VMMaker.oscog-mt.3568',
    );
    shaEem = await h.pushUpstream(
      { [cointerp]: coreInterp({ author: 'eem', version: '3568' }) },
      'CogVM source as per VMMaker.oscog-eem.3568',
    );
    await h.cloneMirror();
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('resolves each author-qualified token to its own commit and does not find an absent author', async () => {
    // Given
    const opts = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };

    // When
    const mt = (await resolveCommit(opts, 'VMMaker.oscog-mt.3568')).commit;
    const eem = (await resolveCommit(opts, 'VMMaker.oscog-eem.3568')).commit;
    const mark = await h.argvMark();
    let caught: unknown;
    try {
      await resolveCommit(opts, 'VMMaker.oscog-nice.3568');
    } catch (err) {
      caught = err;
    }

    // Then
    expect(mt).toBe(shaMt);
    expect(eem).toBe(shaEem);
    expect(caught).toBeInstanceOf(Error);
    expect((await h.argvSince(mark)).filter((entry) => entry[1] === 'fetch')).toHaveLength(1);
  });
});
