import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, waitFor, type Harness } from './harness.js';

const execFileP = promisify(execFile);

describe('vm mirror test harness', () => {
  let h: Harness | undefined;

  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it('creates an upstream with branch Cog holding one commit', async () => {
    h = await createHarness();
    const { stdout } = await execFileP('git', ['--git-dir=' + h.upstreamUrl, 'rev-list', '--count', 'Cog']);
    expect(stdout.trim()).toBe('1');
  });

  it('wrapper runs real git and logs its argv', async () => {
    h = await createHarness();
    expect(await h.argvLog()).toEqual([]);
    await execFileP(h.git, ['--version']);
    expect(await h.argvLog()).toEqual([['--version']]);
  });

  it('argvLog ignores a line the wrapper has not finished writing', async () => {
    h = await createHarness();
    const logPath = path.join(h.root, 'argv.log');
    await fs.writeFile(logPath, 'clone\t--bare');
    expect(await h.argvLog()).toEqual([]);
    await fs.appendFile(logPath, '\t--quiet\n');
    expect(await h.argvLog()).toEqual([['clone', '--bare', '--quiet']]);
  });

  it('gated clone blocks until releaseClone', async () => {
    h = await createHarness({ gated: true });
    const child = spawn(h.git, ['clone', '--bare', h.upstreamUrl, path.join(h.root, 'c')], { stdio: 'ignore' });
    let exitCode: number | null = null;
    let exited = false;
    child.on('exit', (code) => {
      exitCode = code;
      exited = true;
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(exited).toBe(false);

    await h.releaseClone();
    await waitFor(() => exited);
    expect(exitCode).toBe(0);
  });

  it('gated clone stops waiting once the gate is gone', async () => {
    h = await createHarness({ gated: true });
    const child = spawn(h.git, ['--version', 'clone'], { stdio: 'ignore' });
    let exited = false;
    child.on('exit', () => {
      exited = true;
    });
    await waitFor(async () => (await h!.argvLog()).length === 1);

    await fs.rm(path.join(h.root, 'gate'));

    await waitFor(() => exited, 3000);
  });

  it('gated clone stops waiting once its parent dies', async () => {
    h = await createHarness({ gated: true });
    const parent = spawn('sh', ['-c', '"$0" --version clone & echo $!; wait', h.git], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const wrapperPid = Number(await new Promise<string>((r) => parent.stdout.once('data', (d) => r(String(d)))));
    await waitFor(async () => (await h!.argvLog()).length === 1);
    const alive = () => {
      try {
        process.kill(wrapperPid, 0);
        return true;
      } catch {
        return false;
      }
    };

    parent.kill('SIGKILL');

    await waitFor(() => !alive(), 3000);
  });
  it('pushUpstream commits files onto Cog and returns the new SHA', async () => {
    h = await createHarness();
    const message = 'CogVM source as per VMMaker.oscog-eem.3739';
    const sha = await h.pushUpstream({ 'src/spur64.cog/cointerp.c': 'int x;\n' }, message);
    const gitDir = '--git-dir=' + h.upstreamUrl;
    const { stdout: tip } = await execFileP('git', [gitDir, 'rev-parse', 'Cog']);
    expect(tip.trim()).toBe(sha);
    const { stdout: content } = await execFileP('git', [gitDir, 'show', 'Cog:src/spur64.cog/cointerp.c']);
    expect(content).toBe('int x;\n');
    const { stdout: subject } = await execFileP('git', [gitDir, 'log', '-1', '--format=%s', 'Cog']);
    expect(subject.trim()).toBe(message);
    const { stdout: count } = await execFileP('git', [gitDir, 'rev-list', '--count', 'Cog']);
    expect(count.trim()).toBe('2');
    expect(await h.argvLog()).toEqual([]);
  });

  it('cloneMirror makes a bare mirror holding the pushed commit without logging argv', async () => {
    h = await createHarness();
    const sha = await h.pushUpstream({ a: '1\n' }, 'one');
    const home = await h.freshHome();
    await h.cloneMirror(home);
    const gitDir = '--git-dir=' + path.join(home, 'vm-mirror');
    const { stdout: bare } = await execFileP('git', [gitDir, 'rev-parse', '--is-bare-repository']);
    expect(bare.trim()).toBe('true');
    const { stdout: tip } = await execFileP('git', [gitDir, 'rev-parse', 'Cog']);
    expect(tip.trim()).toBe(sha);
    await h.cloneMirror();
    await fs.access(path.join(h.home, 'vm-mirror'));
    expect(await h.argvLog()).toEqual([]);
  });

  it('freshHome returns distinct paths that do not exist yet', async () => {
    h = await createHarness();
    const a = await h.freshHome();
    const b = await h.freshHome();
    expect(a).not.toBe(b);
    expect(a.startsWith(h.root + path.sep)).toBe(true);
    await expect(fs.access(a)).rejects.toThrow();
    await expect(fs.access(b)).rejects.toThrow();
  });

  it('argvSince returns only entries after the mark', async () => {
    h = await createHarness();
    await execFileP(h.git, ['--version']);
    const mark = await h.argvMark();
    expect(mark).toBe(1);
    await execFileP(h.git, ['--version', '--build-options']);
    expect(await h.argvSince(mark)).toEqual([['--version', '--build-options']]);
  });

  it('failGit with stderr makes the subcommand print it and exit 128 without running real git', async () => {
    // Given
    h = await createHarness();
    await h.failGit('clone', { stderr: 'fatal: boom' });
    const target = path.join(h.root, 'x.git');
    const argv = ['clone', '--bare', '--quiet', h.upstreamUrl, target];

    // When
    const result = execFileP(h.git, argv);

    // Then
    await expect(result).rejects.toMatchObject({ code: 128, stderr: expect.stringContaining('fatal: boom') });
    await expect(fs.access(target)).rejects.toThrow();
    expect(await h.argvLog()).toEqual([argv]);
  });

  it('failGit with signal KILL makes the subcommand kill itself after recording done', async () => {
    // Given
    h = await createHarness();
    await h.failGit('rev-parse', { signal: 'KILL' });

    // When
    const result = execFileP(h.git, ['--git-dir=/nowhere', 'rev-parse', 'Cog']);

    // Then
    await expect(result).rejects.toMatchObject({ signal: 'SIGKILL' });
    const lineCount = async (name: string) => (await fs.readFile(path.join(h!.root, name), 'utf8')).split('\n').length - 1;
    expect(await lineCount('done.log')).toBe(await lineCount('argv.log'));
  });

  it('failGit with flood makes the subcommand write over 64 MiB to stdout and exit 0', async () => {
    // Given
    h = await createHarness();
    await h.failGit('show', { flood: true });

    // When
    const result = execFileP(h.git, ['--git-dir=/nowhere', 'show', 'x'], {
      maxBuffer: 128 * 1024 * 1024,
      encoding: 'buffer',
    });

    // Then
    const { stdout } = await result;
    expect(stdout.length).toBeGreaterThanOrEqual(68157440);
  }, 20000);

  it('clearGitFailures removes all injected failures so subcommands run real git again', async () => {
    // Given
    h = await createHarness();
    await h.failGit('rev-parse', { stderr: 'fatal: x' });
    await h.failGit('log', { signal: 'KILL' });
    await h.failGit('show', { flood: true });
    const gitDir = '--git-dir=' + h.upstreamUrl;

    // When
    await h.clearGitFailures();

    // Then
    const { stdout: bare } = await execFileP(h.git, [gitDir, 'rev-parse', '--is-bare-repository']);
    expect(bare).toBe('true\n');
    const { stdout: subject } = await execFileP(h.git, [gitDir, 'log', '-1', '--format=%s', 'Cog']);
    expect(subject).toBe('initial\n');
    const { stdout: shown } = await execFileP(h.git, [gitDir, 'show', '--format=%s', '-s', 'Cog']);
    expect(shown).toBe('initial\n');
  });
});
