/**
 * Opt-in (CUIS_INTEGRATION=1, macOS) checks of the Cuis API behavior the run_smalltalk harness
 * relies on, run as tiny hand-written scripts on the real pinned VM. Each assertion records a
 * behavior CONFIRMED against the real VM, not an assumption.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_DIR, cuisHomeStatus, DIST_DIR, layoutDir, prepareCuisHome } from '../cuisHome/cuisHome.js';
import { createRunSmalltalkTool } from './tool.js';
import { runWithSharedCuis } from '../cuisHome/run.js';
import { makeTempHome } from '../cuisHome/testSupport/tempHome.js';
import { buildHarness } from './harness.js';

const PREPARE_TIMEOUT_MS = 10 * 60 * 1000;
const TEST_TIMEOUT_MS = 5 * 60 * 1000;
const RUN_TIMEOUT_MS = 60 * 1000;

/**
 * Handlers every harness step needs so that nothing opens a debugger (which hangs a headless VM):
 * `UnhandledError` (any Error nobody handled; it does NOT intercept errors raised inside a running
 * TestCase, which SUnit handles itself and counts), `Warning` (includes UndeclaredVariableWarning)
 * and `SyntaxErrorNotification` (an Error, but not an UnhandledError).
 */
const GUARD = 'UnhandledError, Warning, SyntaxErrorNotification';

describe.skipIf(process.env.CUIS_INTEGRATION !== '1' || process.platform !== 'darwin')(
  'real Cuis API assumptions of run_smalltalk',
  () => {
    let tmp: { home: string; cleanup(): Promise<void> };
    let scriptDir: string;
    let distDir: string;

    beforeAll(async () => {
      tmp = await makeTempHome();
      const { home } = tmp;
      expect(await prepareCuisHome({ home })).toBe('started');
      const deadline = Date.now() + PREPARE_TIMEOUT_MS;
      for (;;) {
        const status = await cuisHomeStatus({ home });
        if (status.state === 'ready') break;
        if (status.state === 'failed') {
          throw new Error(`preparation failed: ${status.error.code}: ${status.error.message}`);
        }
        if (Date.now() > deadline) throw new Error('preparation did not finish in 10 minutes');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      distDir = path.join(layoutDir({ home }), DIST_DIR);
      scriptDir = path.join(home, 'scripts');
      await fs.mkdir(scriptDir);
    }, PREPARE_TIMEOUT_MS + 60_000);

    afterAll(async () => {
      await tmp?.cleanup();
    });

    /** Runs `body` between the mandatory prologue and the DONE/quit epilogue; returns the output. */
    async function runScript(name: string, body: string[]): Promise<string> {
      const scriptPath = path.join(scriptDir, `${name}.st`);
      await fs.writeFile(
        scriptPath,
        [
          'Transcript logToStdout: true.',
          // Creating classes/methods asks for an author interactively (hangs) unless one is set.
          "Utilities setAuthorName: 'MCP Bridge' initials: 'mcp'.",
          ...body,
          "Transcript show: 'DONE exitCode=0'; newLine.",
          'Smalltalk quitPrimitive: 0',
          '',
        ].join('\n'),
      );
      const result = await runWithSharedCuis(tmp, { scriptPath, timeoutMs: RUN_TIMEOUT_MS });
      expect(result.outcome, result.output).toBe('passed');
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('DONE exitCode=0');
      return result.output;
    }

    it(
      'evaluates source text and source read from a file; reports syntax and runtime errors',
      async () => {
        await fs.writeFile(path.join(scriptDir, 'code_ok.st'), '| a | a := 5. a + 2');
        await fs.writeFile(path.join(scriptDir, 'code_runtime.st'), '1/0');

        const output = await runScript('evaluate', [
          "Transcript show: 'plain=', (Compiler evaluate: '3 + 4') printString; newLine.",
          // Reading a file: `'/abs' asFileEntry fileContents`; the value is the last statement's.
          `Transcript show: 'file=', (Compiler evaluate: '${scriptDir}/code_ok.st' asFileEntry fileContents) printString; newLine.`,
          // The harness form: the instance-side evaluate raises on syntax errors, so a handler sees them.
          `#('3 +' '1/0' 'foo bar baz' 'self error: ''boom''' '3 + 4' 'Warning signal: ''warn''. 5') do: [:src |`,
          '  [ | v |',
          '    v := Compiler new evaluate: src in: nil to: nil notifying: nil ifFail: [ Transcript show: \'IFFAIL\'; newLine. nil ].',
          "    Transcript show: 'eval ', src printString, ' -> ', v printString; newLine ]",
          `    on: ${GUARD} do: [:ex |`,
          "      Transcript show: 'eval ', src printString, ' RAISED ', ex class name, ' / ', ex description printString, ' / ', ((ex respondsTo: #exception) ifTrue: [ex exception description printString] ifFalse: ['-']); newLine.",
          '      ex return: nil ]].',
          // Class-side evaluate: swallows a syntax error and answers nil: not usable to detect it.
          "Transcript show: 'classSideSyntax=', (Compiler evaluate: '3 +') printString; newLine.",
        ]);

        expect(output).toContain('plain=7');
        expect(output).toContain('file=7');
        expect(output).toContain("eval '3 + 4' -> 7");
        expect(output).toContain("eval 'Warning signal: ''warn''. 5' RAISED Warning / 'Warning: warn'");
        expect(output).toMatch(/eval '3 \+' RAISED SyntaxErrorNotification \/ 'SyntaxErrorNotification: 3 \+Argument expected/);
        expect(output).toContain("eval '1/0' RAISED UnhandledError / 'UnhandledError' / 'ZeroDivide'");
        expect(output).toContain("eval 'foo bar baz' RAISED UndeclaredVariableWarning");
        expect(output).toContain("eval 'self error: ''boom''' RAISED UnhandledError / 'UnhandledError' / 'Error: boom'");
        expect(output).not.toContain('IFFAIL');
        expect(output).toContain('classSideSyntax=nil');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'installs a .pck.st from an absolute path; a missing file is silently ignored',
      async () => {
        const json = path.join(distDir, 'Packages', 'Features', 'JSON.pck.st');
        await fs.access(json);

        const output = await runScript('package', [
          `[ CodePackageFile installPackage: '${json}' asFileEntry.`,
          "  Transcript show: 'json=', (Smalltalk includesKey: #Json) printString; newLine.",
          "  Transcript show: 'decoded=', ((Smalltalk at: #Json) readFrom: '[1,2]' readStream) printString; newLine ]",
          `  on: ${GUARD} do: [:ex | Transcript show: 'RAISED ', ex class name; newLine. ex return: nil ].`,
          // installPackage: does NOT fail on a missing file, so the harness must check existence itself.
          `[ CodePackageFile installPackage: '${scriptDir}/nope.pck.st' asFileEntry.`,
          "  Transcript show: 'missing returned normally'; newLine ]",
          `  on: ${GUARD} do: [:ex | Transcript show: 'missing RAISED ', ex class name; newLine. ex return: nil ].`,
        ]);

        expect(output).toContain('Package JSON successfully installed');
        expect(output).toContain('json=true');
        expect(output).toContain('decoded=#(1 2)');
        expect(output).toContain('missing returned normally');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'exposes TestResult counts and ClassName>>#selector ids; test errors are counted, not raised',
      async () => {
        const output = await runScript('testresult', [
          "(Compiler evaluate: 'TestCase subclass: #ZzSample instanceVariableNames: '''' classVariableNames: '''' poolDictionaries: '''' category: ''Zz''').",
          "(Smalltalk at: #ZzSample) compile: 'testOk self assert: true'.",
          "(Smalltalk at: #ZzSample) compile: 'testFail self assert: false'.",
          "(Smalltalk at: #ZzSample) compile: 'testErr 1/0'.",
          "(Smalltalk at: #ZzSample) compile: 'testErr2 self foo'.",
          // The guard is UnhandledError, not Error: an `on: Error` here would catch the error raised
          // inside a test before SUnit does and abort the suite.
          `[ | r |`,
          "  r := (Smalltalk at: #ZzSample) buildSuite run.",
          "  Transcript show: 'kind=', (r isKindOf: TestResult) printString; newLine.",
          "  Transcript show: 'counts run=', r runCount printString, ' passed=', r passedCount printString, ' failures=', r failureCount printString, ' errors=', r errorCount printString; newLine.",
          "  Transcript show: 'flags hasFailures=', r hasFailures printString, ' hasErrors=', r hasErrors printString; newLine.",
          // A TestCase prints as its id.
          "  r failures do: [:t | Transcript show: 'FAILING ', t printString; newLine].",
          "  r errors do: [:t | Transcript show: 'ERRORING ', t printString; newLine].",
          "  r passed do: [:t | Transcript show: 'PASSING ', t printString; newLine].",
          "  r failures do: [:t | Transcript show: 'BUILT ', t class name, '>>#', t selector; newLine] ]",
          `  on: ${GUARD} do: [:ex | Transcript show: 'RAISED ', ex class name; newLine. ex return: nil ].`,
        ]);

        expect(output).toContain('kind=true');
        expect(output).toContain('counts run=4 passed=1 failures=1 errors=2');
        expect(output).toContain('flags hasFailures=true hasErrors=true');
        expect(output).toContain('FAILING ZzSample>>#testFail');
        expect(output).toContain('ERRORING ZzSample>>#testErr');
        expect(output).toContain('ERRORING ZzSample>>#testErr2');
        expect(output).toContain('PASSING ZzSample>>#testOk');
        expect(output).toContain('BUILT ZzSample>>#testFail');
        expect(output).not.toContain('RAISED');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'runs the generated harness end to end on the real VM',
      async () => {
        const nonce = 'N0NCE';
        const HARNESS_TIMEOUT_MS = 120 * 1000;
        async function runHarness(name: string, code: string, packagePaths: string[] = []) {
          const codePath = path.join(scriptDir, `${name}-user-code.st`);
          const scriptPath = path.join(scriptDir, `${name}-harness.st`);
          await fs.writeFile(codePath, code);
          await fs.writeFile(scriptPath, buildHarness({ nonce, codePath, packagePaths }));
          const started = Date.now();
          const result = await runWithSharedCuis(tmp, { scriptPath, timeoutMs: HARNESS_TIMEOUT_MS });
          return { ...result, elapsedMs: Date.now() - started };
        }

        // Given/When/Then (1): a plain expression
        const ok = await runHarness('h-ok', '3 + 4');
        expect(ok.output, ok.output).toMatch(/N0NCE RESULT (.*)$/m);
        expect(ok.output.match(/N0NCE RESULT (.*)$/m)?.[1], ok.output).toBe('7');
        expect(ok.output, ok.output).toContain('DONE exitCode=0');
        expect(ok.outcome, ok.output).toBe('passed');

        // (2): syntax error and runtime error
        for (const [name, code] of [
          ['h-syntax', '3 +'],
          ['h-runtime', '1/0'],
        ] as const) {
          const bad = await runHarness(name, code);
          expect(bad.output, `${name}: ${bad.output}`).toMatch(/N0NCE ERROR code: /);
          expect(bad.output, `${name}: ${bad.output}`).toContain('DONE exitCode=1');
          expect(bad.outcome, `${name}: ${bad.output}`).toBe('failed');
          expect(bad.elapsedMs, `${name}: ${bad.output}`).toBeLessThan(HARNESS_TIMEOUT_MS - 30_000);
        }

        // (3): a multi-line string result is escaped onto exactly one line
        const multi = await runHarness('h-multi', "'a', String newLineString, 'b'");
        const resultLines = multi.output.split('\n').filter((l) => l.includes('N0NCE RESULT'));
        expect(resultLines, multi.output).toHaveLength(1);
        expect(resultLines[0], multi.output).toContain("'a\\nb'");

        // (4): a SUnit suite
        const suite = await runHarness(
          'h-suite',
          [
            "TestCase subclass: #ZzHarnessSample instanceVariableNames: '' classVariableNames: '' poolDictionaries: '' category: 'Zz'.",
            "(Smalltalk at: #ZzHarnessSample) compile: 'testOk self assert: true'.",
            "(Smalltalk at: #ZzHarnessSample) compile: 'testFail self assert: false'.",
            "(Smalltalk at: #ZzHarnessSample) compile: 'testErr 1/0'.",
            "(Smalltalk at: #ZzHarnessSample) compile: 'testErr2 self foo'.",
            '(Smalltalk at: #ZzHarnessSample) buildSuite run',
          ].join('\n'),
        );
        expect(suite.output, suite.output).toContain('N0NCE TESTS run=4 passed=1 failures=1 errors=2');
        expect(suite.output, suite.output).toContain('N0NCE FAILING ZzHarnessSample>>#testFail');
        expect(suite.output, suite.output).toContain('N0NCE ERRORING ZzHarnessSample>>#testErr');
        expect(suite.output, suite.output).toContain('N0NCE ERRORING ZzHarnessSample>>#testErr2');
        expect(suite.output, suite.output).toContain('DONE exitCode=1');
        expect(suite.outcome, suite.output).toBe('failed');

        // (5): a package by absolute path, then code using it
        const json = path.join(distDir, 'Packages', 'Features', 'JSON.pck.st');
        const pkg = await runHarness('h-pkg', "(Smalltalk at: #Json) readFrom: '[1,2]' readStream", [json]);
        expect(pkg.output.match(/N0NCE RESULT (.*)$/m)?.[1], pkg.output).toBe('#(1 2)');
        expect(pkg.output, pkg.output).toContain('DONE exitCode=0');
      },
      15 * 60 * 1000,
    );

    it(
      'fails promptly, reporting an ERROR, for Halt and errors with a non-string description',
      async () => {
        const nonce = 'N0NCE';
        const TIMEOUT_MS = 60 * 1000;
        const cases = [
          ['halt', 'self halt', /halt/i],
          ['signal5', 'Error signal: 5', /Error|5/],
          ['error3', 'self error: 3', /Error|3/],
          ['errornew', 'Error new signal', /Error/],
        ] as const;
        for (const [name, code, mention] of cases) {
          // Given user code that raises an exception which is not a plain UnhandledError string error
          const codePath = path.join(scriptDir, `${name}-user-code.st`);
          const scriptPath = path.join(scriptDir, `${name}-harness.st`);
          await fs.writeFile(codePath, code);
          await fs.writeFile(scriptPath, buildHarness({ nonce, codePath, packagePaths: [] }));

          // When it runs on the real VM
          const started = Date.now();
          const result = await runWithSharedCuis(tmp, { scriptPath, timeoutMs: TIMEOUT_MS });
          const elapsedMs = Date.now() - started;

          // Then it fails promptly with an ERROR marker, instead of hanging until the timeout
          const ctx = `${name} (${code}) after ${elapsedMs} ms, outcome ${result.outcome}: ${JSON.stringify(result.output)}`;
          expect(result.outcome, ctx).toBe('failed');
          expect(result.exitCode, ctx).toBe(1);
          expect(result.output, ctx).toMatch(/N0NCE ERROR code: /);
          expect(result.output.match(/N0NCE ERROR code: (.*)$/m)?.[1] ?? '', ctx).toMatch(mention);
          expect(result.output, ctx).toContain('DONE exitCode=1');
          expect(elapsedMs, ctx).toBeLessThan(30_000);
        }
      },
      15 * 60 * 1000,
    );

    it(
      'runs scenarios through the real run_smalltalk tool: pass, fail, timeout, concurrency, cleanliness, package',
      async () => {
        // Given the tool over the prepared home, and the pre-run state of tmpdir and the base directory
        const tool = createRunSmalltalkTool({ home: tmp.home });
        const call = async (args: Record<string, unknown>) => {
          const res = await tool.handler(args, {});
          const raw = res.content[0].text;
          return { raw, json: JSON.parse(raw) as Record<string, any> };
        };
        const leftovers = async () =>
          (await fs.readdir(tmpdir())).filter((n) => n.startsWith('cuis-mcp-run-') || n.startsWith('cuis-run-'));
        const dirsBefore = new Set(await leftovers());
        const baseDir = path.join(layoutDir({ home: tmp.home }), BASE_DIR);
        const baseBefore = await snapshot(baseDir);

        // (1) a plain expression
        const ok = await call({ code: '3 + 4' });
        expect(ok.json.status, ok.raw).toBe('passed');
        expect(ok.json.result, ok.raw).toBe('7');
        expect(ok.json.exitCode, ok.raw).toBe(0);

        // (2) a failing SUnit suite
        const suite = await call({
          code: [
            "TestCase subclass: #ZzToolSample instanceVariableNames: '' classVariableNames: '' poolDictionaries: '' category: 'Zz'.",
            "(Smalltalk at: #ZzToolSample) compile: 'testOk self assert: true'.",
            "(Smalltalk at: #ZzToolSample) compile: 'testFail self assert: false'.",
            "(Smalltalk at: #ZzToolSample) compile: 'testErr 1/0'.",
            "(Smalltalk at: #ZzToolSample) compile: 'testErr2 self foo'.",
            '(Smalltalk at: #ZzToolSample) buildSuite run',
          ].join('\n'),
        });
        expect(suite.json.status, suite.raw).toBe('failed');
        expect(suite.json.error, suite.raw).toMatch(/^tests_failed: /);
        expect(JSON.stringify(suite.json.tests), suite.raw).toContain('"run":4');
        expect(JSON.stringify(suite.json.tests), suite.raw).toContain('"passed":1');
        expect(JSON.stringify(suite.json.tests), suite.raw).toContain('ZzToolSample>>#testFail');
        expect(JSON.stringify(suite.json.tests), suite.raw).toContain('ZzToolSample>>#testErr');
        expect(JSON.stringify(suite.json.tests), suite.raw).toContain('ZzToolSample>>#testErr2');

        // (3) a never-ending loop hits the timeout
        const started = Date.now();
        const hang = await call({ code: '[true] whileTrue', timeoutSeconds: 3 });
        const elapsed = Date.now() - started;
        expect(hang.json.status, hang.raw).toBe('timeout');
        expect(hang.json.error, hang.raw).toMatch(/^timeout: /);
        expect(elapsed, hang.raw).toBeLessThan(20000);

        // (4) two simultaneous calls keep their own results
        const [a, b] = await Promise.all([call({ code: '3 + 4' }), call({ code: '10 factorial' })]);
        expect(a.json.status, a.raw).toBe('passed');
        expect(a.json.result, a.raw).toBe('7');
        expect(b.json.status, b.raw).toBe('passed');
        expect(b.json.result, b.raw).toBe('3628800');

        // (6) a package by absolute path
        const json = path.join(distDir, 'Packages', 'Features', 'JSON.pck.st');
        const jsonBefore = { bytes: await fs.readFile(json), mtimeMs: (await fs.stat(json)).mtimeMs };
        const pkg = await call({ code: "(Smalltalk at: #Json) readFrom: '[1,2]' readStream", packages: [json] });
        expect(pkg.json.status, pkg.raw).toBe('passed');
        expect(pkg.json.result, pkg.raw).toBe('#(1 2)');
        // the package is loaded in place and never modified
        expect(await fs.readFile(json)).toEqual(jsonBefore.bytes);
        expect((await fs.stat(json)).mtimeMs).toBe(jsonBefore.mtimeMs);

        // (5) nothing left behind in tmpdir, and the base directory is untouched
        const newDirs = (await leftovers()).filter((n) => !dirsBefore.has(n));
        expect(newDirs).toEqual([]);
        expect(await snapshot(baseDir)).toEqual(baseBefore);
      },
      15 * 60 * 1000,
    );
  },
);

/** Sorted `path sha256` lines for every file under `dir`. */
async function snapshot(dir: string): Promise<string[]> {
  const lines: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const hash = createHash('sha256').update(await fs.readFile(full)).digest('hex');
        lines.push(`${path.relative(dir, full)} ${hash}`);
      }
    }
  }
  await walk(dir);
  return lines.sort();
}
