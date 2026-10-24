import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHeadless } from './runner.js';
import { fakeShScript, writeFakeVm } from './testSupport/fakeVm.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('runHeadless', () => {
  let tmp: { home: string; cleanup(): Promise<void> };

  beforeEach(async () => {
    tmp = await makeTempHome();
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('returns setup_error (exit 2) without starting the VM when the script file does not exist', async () => {
    // Given a valid VM (sentinel-writing), a baseDir with one image, and a missing script
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    const sentinel = path.join(tmp.home, 'vm-was-started');
    const vm = path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak');
    await fs.writeFile(vm, `#!/bin/sh\ntouch "${sentinel}"\nexit 0\n`);
    await fs.chmod(vm, 0o755);
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const scriptPath = path.join(tmp.home, 'missing.st');

    // When
    const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 5000 });

    // Then
    expect(result.outcome).toBe('setup_error');
    expect(result.exitCode).toBe(2);
    await expect(fs.access(sentinel)).rejects.toThrow();
  });

  it('returns setup_error (exit 2) when the VM path does not exist', async () => {
    // Given an existing script, a baseDir with one image, and no CuisVM.app under cuisDir
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(cuisDir, { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const scriptPath = path.join(tmp.home, 'script.st');
    await fs.writeFile(scriptPath, '');

    // When
    const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 5000 });

    // Then
    expect(result.outcome).toBe('setup_error');
    expect(result.exitCode).toBe(2);
  });

  it('returns setup_error (exit 2) without starting the VM when baseDir contains no .image file', async () => {
    // Given a valid VM (sentinel-writing), an existing script, and a baseDir with only a .sources file
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    const sentinel = path.join(tmp.home, 'vm-was-started');
    const vm = path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak');
    await fs.writeFile(vm, `#!/bin/sh\ntouch "${sentinel}"\nexit 0\n`);
    await fs.chmod(vm, 0o755);
    await fs.writeFile(path.join(baseDir, 'Cuis.sources'), '');
    const scriptPath = path.join(tmp.home, 'script.st');
    await fs.writeFile(scriptPath, '');

    // When
    const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 5000 });

    // Then
    expect(result.outcome).toBe('setup_error');
    expect(result.exitCode).toBe(2);
    await expect(fs.access(sentinel)).rejects.toThrow();
  });

  it('returns passed (exit 0) with VM output when the script prints a DONE exitCode=0 line', async () => {
    // Given a fake VM, a baseDir with one image, and a script that echoes then reports DONE exitCode=0
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const scriptPath = path.join(tmp.home, 'script.st');
    await fs.writeFile(scriptPath, fakeShScript('echo hello-from-vm; echo "DONE exitCode=0"'));

    // When
    const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 10000 });

    // Then
    expect(result.outcome).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hello-from-vm');
    expect(result.output.indexOf('hello-from-vm')).toBeLessThan(result.output.indexOf('DONE exitCode=0'));
  });

  it('returns failed (exit 1) with VM output when the script prints a DONE exitCode=1 line', async () => {
    // Given a fake VM, a baseDir with one image, and a script that echoes then reports DONE exitCode=1
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const scriptPath = path.join(tmp.home, 'script.st');
    await fs.writeFile(scriptPath, fakeShScript('echo "boom"; echo "DONE exitCode=1"; exit 1'));

    // When
    const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 10000 });

    // Then
    expect(result.outcome).toBe('failed');
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('boom');
    expect(result.output).toContain('DONE exitCode=1');
  });

  it.each([
    ['passed', 0, 'echo "$FAKE_MARKER_PREFIX""DONE exitCode=0"'],
    ['failed', 1, 'echo "$FAKE_MARKER_PREFIX""DONE exitCode=1"; exit 1'],
  ] as const)(
    'returns %s (exit %i) when the DONE marker line is preceded by a Transcript timestamp prefix',
    async (expectedOutcome, expectedExit, body) => {
      // Given a fake VM that prefixes the DONE line with a real-VM style timestamp
      const cuisDir = path.join(tmp.home, 'cuis');
      const baseDir = path.join(tmp.home, 'base');
      await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
      await fs.mkdir(baseDir, { recursive: true });
      await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'), {
        markerPrefix: '2026-10-24T06:29:23.448 process:40 1846027 ',
      });
      await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
      const scriptPath = path.join(tmp.home, 'script.st');
      await fs.writeFile(scriptPath, fakeShScript(body));

      // When
      const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 10000 });

      // Then
      expect(result.outcome).toBe(expectedOutcome);
      expect(result.exitCode).toBe(expectedExit);
      expect(result.output).toContain(`process:40 1846027 DONE exitCode=${expectedExit}`);
    },
  );

  it('returns timeout_or_crash (exit 124) with VM output when the VM exits without printing a DONE line', async () => {
    // Given a fake VM, a baseDir with one image, and a script that exits 0 without a DONE marker
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const scriptPath = path.join(tmp.home, 'script.st');
    await fs.writeFile(scriptPath, fakeShScript('echo "dying"; exit 0'));

    // When
    const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 10000 });

    // Then
    expect(result.outcome).toBe('timeout_or_crash');
    expect(result.exitCode).toBe(124);
    expect(result.output).toContain('dying');
  });

  it('terminates a hanging VM and its grandchild at the time limit and returns timeout_or_crash (exit 124) without waiting for the hang', async () => {
    // Given a fake VM whose script spawns a grandchild sleep, records its pid, then hangs
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const pidFile = path.join(tmp.home, 'grandchild.pid');
    const scriptPath = path.join(tmp.home, 'script.st');
    await fs.writeFile(
      scriptPath,
      fakeShScript(`sleep 300 & echo $! > "${pidFile}"; echo started; sleep 300`),
    );
    let pid: number | undefined;

    try {
      // When the time limit is 3 s (generous so the script has certainly started)
      const startedAt = Date.now();
      const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 3000 });
      const elapsed = Date.now() - startedAt;
      pid = Number((await fs.readFile(pidFile, 'utf8')).trim());

      // Then it is reported as timeout_or_crash promptly, with output captured
      expect(result.outcome).toBe('timeout_or_crash');
      expect(result.exitCode).toBe(124);
      expect(elapsed).toBeLessThan(10000);
      expect(result.output).toContain('started');

      // And the grandchild process is gone (ESRCH) within ~2 s
      let code: string | undefined = 'alive';
      for (let i = 0; i < 20 && code === 'alive'; i++) {
        try {
          process.kill(pid, 0);
          await new Promise((r) => setTimeout(r, 100));
        } catch (e) {
          code = (e as NodeJS.ErrnoException).code;
        }
      }
      expect(code).toBe('ESRCH');
    } finally {
      if (pid === undefined) {
        try {
          pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
        } catch {
          // pid file never written
        }
      }
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  }, 15000);

  it('terminates a hanging VM process group and cleans up scratch when the abort signal fires, returning timeout_or_crash (exit 124) promptly', async () => {
    // Given a fake VM whose script records a sleep pid, then hangs, and a private TMPDIR
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const pidFile = path.join(tmp.home, 'sleep.pid');
    const scriptPath = path.join(tmp.home, 'script.st');
    await fs.writeFile(
      scriptPath,
      fakeShScript(`sleep 300 & echo $! > "${pidFile}"; echo started; wait`),
    );
    const originalTmpdir = process.env.TMPDIR;
    const privateTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-test-tmp-'));
    const controller = new AbortController();
    let pid: number | undefined;

    try {
      process.env.TMPDIR = privateTmp;

      // When the signal is aborted once the script has started (pid file exists), with a 60 s time limit
      const aborter = (async () => {
        for (let i = 0; i < 100; i++) {
          try {
            if ((await fs.readFile(pidFile, 'utf8')).trim() !== '') break;
          } catch {
            // not written yet
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((r) => setTimeout(r, 200));
        controller.abort();
      })();
      const startedAt = Date.now();
      const result = await runHeadless({
        cuisDir,
        baseDir,
        scriptPath,
        timeoutMs: 60000,
        signal: controller.signal,
      });
      const elapsed = Date.now() - startedAt;
      await aborter;
      pid = Number((await fs.readFile(pidFile, 'utf8')).trim());

      // Then it returns promptly as timeout_or_crash with output captured
      expect(result.outcome).toBe('timeout_or_crash');
      expect(result.exitCode).toBe(124);
      expect(elapsed).toBeLessThan(10000);
      expect(result.output).toContain('started');

      // And the sleep process is gone (ESRCH) within ~2 s
      let code: string | undefined = 'alive';
      for (let i = 0; i < 20 && code === 'alive'; i++) {
        try {
          process.kill(pid, 0);
          await new Promise((r) => setTimeout(r, 100));
        } catch (e) {
          code = (e as NodeJS.ErrnoException).code;
        }
      }
      expect(code).toBe('ESRCH');

      // And no scratch directory lingers
      expect((await fs.readdir(privateTmp)).filter((n) => n.startsWith('cuis-run-'))).toEqual([]);
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
      if (pid === undefined) {
        try {
          pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
        } catch {
          // pid file never written
        }
      }
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
      await fs.rm(privateTmp, { recursive: true, force: true });
    }
  }, 15000);

  it('runs the VM on a scratch copy of baseDir and leaves every file in baseDir byte-identical', async () => {
    // Given a fake VM, a baseDir with image/sources/changes, and a script that scribbles on the image it is given
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), 'pristine image');
    await fs.writeFile(path.join(baseDir, 'Cuis.sources'), 'pristine sources');
    await fs.writeFile(path.join(baseDir, 'Cuis.changes'), 'pristine changes');
    const scriptPath = path.join(tmp.home, 'script.st');
    await fs.writeFile(
      scriptPath,
      fakeShScript('echo scribbled >> "$FAKE_IMAGE"; echo "$FAKE_IMAGE"; echo "DONE exitCode=0"'),
    );
    const snapshot = async () => {
      const names = (await fs.readdir(baseDir)).sort();
      return Promise.all(
        names.map(async (n) => [n, (await fs.readFile(path.join(baseDir, n))).toString('base64')]),
      );
    };
    const before = await snapshot();

    // When
    const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 10000 });

    // Then baseDir is untouched and the VM was given a Cuis.image outside baseDir
    expect(result.outcome).toBe('passed');
    expect(await snapshot()).toEqual(before);
    const imagePath = result.output
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.endsWith('Cuis.image'));
    expect(imagePath).toBeDefined();
    expect(path.basename(imagePath!)).toBe('Cuis.image');
    expect(path.resolve(imagePath!).startsWith(path.resolve(baseDir) + path.sep)).toBe(false);
  });

  it('leaves no cuis-run-* scratch directory in the OS temp dir after passed, failed, crash, timeout and setup_error outcomes', async () => {
    // Given a fake VM, a baseDir with one image, and the current count of cuis-run-* scratch dirs
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const originalTmpdir = process.env.TMPDIR;
    const privateTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-test-tmp-'));
    const countScratch = async () =>
      (await fs.readdir(privateTmp)).filter((n) => n.startsWith('cuis-run-')).length;
    const cases: Array<[string, string | undefined, number, string]> = [
      ['passed', 'echo "DONE exitCode=0"', 10000, 'passed'],
      ['failed', 'echo "DONE exitCode=1"; exit 1', 10000, 'failed'],
      ['crash', 'echo dying; exit 0', 10000, 'timeout_or_crash'],
      ['timeout', 'sleep 300', 300, 'timeout_or_crash'],
      ['setup_error', undefined, 5000, 'setup_error'],
    ];

    try {
      process.env.TMPDIR = privateTmp;
      for (const [name, body, timeoutMs, expectedOutcome] of cases) {
        const scriptPath = path.join(tmp.home, `${name}.st`);
        if (body !== undefined) await fs.writeFile(scriptPath, fakeShScript(body));

        // When
        const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs });

        // Then the outcome is the expected one and no scratch dir lingers in the private temp dir
        expect(result.outcome).toBe(expectedOutcome);
        expect(await countScratch()).toBe(0);
      }
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
      await fs.rm(privateTmp, { recursive: true, force: true });
    }
  }, 30000);

  it('isolates two concurrent runs on the same cuisDir and baseDir so neither sees the other\'s files and baseDir stays clean', async () => {
    // Given a fake VM, a shared baseDir, and two scripts that each touch a unique file, sleep, then list their image dir
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const scriptFor = async (name: string, marker: string) => {
      const p = path.join(tmp.home, `${name}.st`);
      await fs.writeFile(
        p,
        fakeShScript(
          `touch "$(dirname "$FAKE_IMAGE")/${marker}"; sleep 1; ls "$(dirname "$FAKE_IMAGE")"; echo "DONE exitCode=0"`,
        ),
      );
      return p;
    };
    const scriptA = await scriptFor('a', 'only-a');
    const scriptB = await scriptFor('b', 'only-b');

    // When both runs start at the same time
    const [a, b] = await Promise.all([
      runHeadless({ cuisDir, baseDir, scriptPath: scriptA, timeoutMs: 20000 }),
      runHeadless({ cuisDir, baseDir, scriptPath: scriptB, timeoutMs: 20000 }),
    ]);

    // Then each sees only its own file, both passed, and baseDir has neither
    expect(a.outcome).toBe('passed');
    expect(b.outcome).toBe('passed');
    expect(a.output).toContain('only-a');
    expect(a.output).not.toContain('only-b');
    expect(b.output).toContain('only-b');
    expect(b.output).not.toContain('only-a');
    const remaining = await fs.readdir(baseDir);
    expect(remaining).not.toContain('only-a');
    expect(remaining).not.toContain('only-b');
  }, 30000);

  it('returns every line of more than 1 MB of interleaved stdout and stderr output, in order, with the DONE marker last', async () => {
    // Given a fake VM and a script that alternates 20000 stdout and stderr lines, then prints DONE
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const scriptPath = path.join(tmp.home, 'script.st');
    const pad = '.'.repeat(64);
    await fs.writeFile(
      scriptPath,
      fakeShScript(
        `i=0; while [ $i -lt 20000 ]; do echo "out line $i ${pad}"; echo "err line $i ${pad}" 1>&2; i=$((i+1)); done; echo "DONE exitCode=0"`,
      ),
    );

    // When
    const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 50000 });

    // Then it passed, the output exceeds 1 MB, and every line is present in the order produced
    expect(result.outcome).toBe('passed');
    expect(result.output.length).toBeGreaterThan(1_000_000);
    const lines = result.output.split('\n').filter((l) => l !== '');
    expect(lines.length).toBe(40001);
    for (let i = 0; i < 20000; i++) {
      if (lines[2 * i] !== `out line ${i} ${pad}` || lines[2 * i + 1] !== `err line ${i} ${pad}`) {
        expect(lines.slice(2 * i, 2 * i + 2)).toEqual([`out line ${i} ${pad}`, `err line ${i} ${pad}`]);
      }
    }
    expect(lines[40000]).toBe('DONE exitCode=0');
  }, 60000);

  it('runs the VM with cwd defaulting to cuisDir, and with opts.cwd when given', async () => {
    // Given a fake VM whose script prints its working directory, and another existing directory
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    const otherDir = path.join(tmp.home, 'other');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(otherDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const scriptPath = path.join(tmp.home, 'script.st');
    await fs.writeFile(scriptPath, fakeShScript('pwd; echo "DONE exitCode=0"'));
    const pwdOf = (output: string) => output.split('\n').map((l) => l.trim())[0];

    // When run without and then with opts.cwd
    const byDefault = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 10000 });
    const overridden = await runHeadless({
      cuisDir,
      baseDir,
      scriptPath,
      timeoutMs: 10000,
      cwd: otherDir,
    });

    // Then the VM's pwd is cuisDir by default and the override otherwise
    expect(byDefault.outcome).toBe('passed');
    expect(pwdOf(byDefault.output)).toBe(await fs.realpath(cuisDir));
    expect(overridden.outcome).toBe('passed');
    expect(pwdOf(overridden.output)).toBe(await fs.realpath(otherDir));
  });

  it('resolves a relative scriptPath against the caller cwd so the VM finds the script regardless of its own cwd', async () => {
    // Given a fake VM, a cuisDir/baseDir apart from the script's directory, and a script given as a path relative to process.cwd()
    const cuisDir = path.join(tmp.home, 'cuis');
    const baseDir = path.join(tmp.home, 'base');
    const scriptDir = path.join(tmp.home, 'scripts');
    await fs.mkdir(path.join(cuisDir, 'CuisVM.app/Contents/MacOS'), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(scriptDir, { recursive: true });
    await writeFakeVm(path.join(cuisDir, 'CuisVM.app/Contents/MacOS/Squeak'));
    await fs.writeFile(path.join(baseDir, 'Cuis.image'), '');
    const absoluteScript = path.join(scriptDir, 'script.st');
    await fs.writeFile(absoluteScript, fakeShScript('echo script-was-found; echo "DONE exitCode=0"'));
    const scriptPath = path.relative(process.cwd(), absoluteScript);

    // When
    const result = await runHeadless({ cuisDir, baseDir, scriptPath, timeoutMs: 10000 });

    // Then
    expect(path.isAbsolute(scriptPath)).toBe(false);
    expect(result.outcome).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('script-was-found');
    expect(result.output).toContain('DONE exitCode=0');
  });
});
