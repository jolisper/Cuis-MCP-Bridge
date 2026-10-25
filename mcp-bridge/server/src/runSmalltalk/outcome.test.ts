import { describe, expect, it } from 'vitest';
import { buildOutcome, parseRun } from './outcome.js';

describe('parseRun', () => {
  it('extracts result and errors from nonce markers and strips marker lines from the output', () => {
    // Given
    const output = [
      'ordinary line 1',
      '2026-10-24T10:00:00 process:40 N0NCE RESULT a\\nb\\\\c',
      'OTHER RESULT x',
      'N0NCE ERROR code: boom\\nline2',
      'ordinary line 2',
      'DONE exitCode=1',
    ].join('\n');

    // When
    const run = parseRun(output, 'N0NCE');

    // Then
    expect(run.result).toBe('a\nb\\c');
    expect(run.errors).toEqual([{ stage: 'code', message: 'boom\nline2' }]);
    expect(run.output).toBe(
      ['ordinary line 1', 'OTHER RESULT x', 'ordinary line 2', 'DONE exitCode=1'].join('\n'),
    );
  });

  it('extracts the tests summary from TESTS/FAILING/ERRORING markers and yields none without a TESTS marker', () => {
    // Given
    const output = [
      'ordinary line',
      '2026-10-24T10:00:00 process:40 N0NCE TESTS run=4 passed=1 failures=1 errors=2',
      'N0NCE FAILING ZzSample>>#testFail',
      'N0NCE ERRORING ZzSample>>#testErr',
      '2026-10-24T10:00:01 process:40 N0NCE ERRORING ZzSample>>#testErr2',
    ].join('\n');

    // When
    const run = parseRun(output, 'N0NCE');
    const without = parseRun('just output', 'N0NCE');

    // Then
    expect(run.tests).toEqual({
      run: 4,
      passed: 1,
      failures: 1,
      errors: 2,
      failing: ['ZzSample>>#testFail'],
      erroring: ['ZzSample>>#testErr', 'ZzSample>>#testErr2'],
    });
    expect(run.output).toBe('ordinary line');
    expect(without.tests).toBeUndefined();
  });
});

describe('buildOutcome', () => {
  it('maps the runner result and parsed markers to a status, result, tests and a typed error', () => {
    // Given
    const nonce = 'N0NCE';
    const lines = (...l: string[]) => l.join('\n');
    const passedOut = lines('N0NCE RESULT 7', 'DONE exitCode=0');
    const testsOut = lines(
      'N0NCE TESTS run=2 passed=1 failures=1 errors=0',
      'N0NCE FAILING ZzSample>>#testFail',
      'DONE exitCode=1',
    );
    const evalOut = lines('N0NCE ERROR code: boom', 'DONE exitCode=1');
    const pkgOut = lines('N0NCE ERROR package /p/x.pck.st: cannot load', 'DONE exitCode=1');
    const harnessResultOut = lines('N0NCE ERROR result: printing failed', 'DONE exitCode=1');
    const harnessTestsOut = lines('N0NCE ERROR tests: runner failed', 'DONE exitCode=1');
    const inconsistentOut = lines('N0NCE ERROR code: boom', 'DONE exitCode=0');

    // When
    const passed = buildOutcome({ outcome: 'passed', exitCode: 0, output: passedOut }, nonce);
    const testsFailed = buildOutcome({ outcome: 'failed', exitCode: 1, output: testsOut }, nonce);
    const evalError = buildOutcome({ outcome: 'failed', exitCode: 1, output: evalOut }, nonce);
    const pkgError = buildOutcome({ outcome: 'failed', exitCode: 1, output: pkgOut }, nonce);
    const harnessResult = buildOutcome({ outcome: 'failed', exitCode: 1, output: harnessResultOut }, nonce);
    const harnessTests = buildOutcome({ outcome: 'failed', exitCode: 1, output: harnessTestsOut }, nonce);
    const inconsistent = buildOutcome({ outcome: 'passed', exitCode: 0, output: inconsistentOut }, nonce);

    // Then
    expect(passed.status).toBe('passed');
    expect(passed.exitCode).toBe(0);
    expect(passed.result).toBe('7');
    expect(passed.error).toBeUndefined();
    expect(passed.output).toBe('DONE exitCode=0');

    expect(testsFailed.status).toBe('failed');
    expect(testsFailed.tests).toEqual({
      run: 2,
      passed: 1,
      failures: 1,
      errors: 0,
      failing: ['ZzSample>>#testFail'],
      erroring: [],
    });
    expect(testsFailed.error).toMatch(/^tests_failed: /);
    expect(testsFailed.error).toContain('1 failure');
    expect(testsFailed.error).toContain('0 error');
    expect(testsFailed.error).toContain('2');

    expect(evalError.status).toBe('failed');
    expect(evalError.error).toBe('evaluation_error: boom');

    expect(pkgError.error).toBe('package_load_error: /p/x.pck.st: cannot load');

    expect(harnessResult.error).toMatch(/^harness_error: /);
    expect(harnessTests.error).toMatch(/^harness_error: /);

    expect(inconsistent.status).toBe('failed');
  });

  it('maps timeout_or_crash to timeout without trusting a result, and setup_error to setup_error', () => {
    // Given
    const nonce = 'N0NCE';

    // When
    const timeout = buildOutcome(
      { outcome: 'timeout_or_crash', exitCode: 124, output: 'partial output\nN0NCE RESULT 5' },
      nonce,
    );
    const setup = buildOutcome({ outcome: 'setup_error', exitCode: 2, output: 'Script not found: /x' }, nonce);

    // Then
    expect(timeout.status).toBe('timeout');
    expect(timeout.exitCode).toBe(124);
    expect(timeout.error).toMatch(/^timeout: /);
    expect(timeout.output).toBe('partial output');
    expect(timeout.result).toBeUndefined();

    expect(setup.status).toBe('setup_error');
    expect(setup.exitCode).toBe(2);
    expect(setup.error).toBe('setup_error: Script not found: /x');
    expect(setup.result).toBeUndefined();
    expect(setup.tests).toBeUndefined();
  });

  it('caps a huge output to first 16 KB + last 48 KB with a cut marker and caps a long result to 4 KB, reporting truncation and full size', () => {
    // Given
    const nonce = 'N0NCE';
    const filler = Array.from({ length: 20000 }, (_, i) => `filler line ${String(i).padStart(6, '0')} ${'.'.repeat(30)}`);
    const cleanedLines = ['FIRST-LINE', ...filler, 'LAST-LINE', 'DONE exitCode=0'];
    const middle = Math.floor(cleanedLines.length / 2);
    const rawLines = [...cleanedLines.slice(0, middle), `${nonce} RESULT 42`, ...cleanedLines.slice(middle)];
    const cleaned = cleanedLines.join('\n');
    const longResult = 'x'.repeat(10000);
    const shortOut = ['short line', 'DONE exitCode=0'].join('\n');

    // When
    const huge = buildOutcome({ outcome: 'passed', exitCode: 0, output: rawLines.join('\n') }, nonce);
    const longRes = buildOutcome(
      { outcome: 'passed', exitCode: 0, output: `${nonce} RESULT ${longResult}\nDONE exitCode=0` },
      nonce,
    );
    const short = buildOutcome({ outcome: 'passed', exitCode: 0, output: shortOut }, nonce);

    // Then
    expect(cleaned.length).toBeGreaterThan(900 * 1024);
    expect(huge.output.startsWith(cleaned.slice(0, 16 * 1024))).toBe(true);
    expect(huge.output.endsWith(cleaned.slice(-48 * 1024))).toBe(true);
    expect(huge.output).toMatch(/truncated/i);
    expect(huge.output.length).toBeLessThanOrEqual(64 * 1024 + 200);
    expect(huge.truncated).toBe(true);
    expect(huge.outputBytes).toBe(cleaned.length);
    expect(huge.status).toBe('passed');
    expect(huge.result).toBe('42');

    expect(longRes.result!.length).toBeLessThanOrEqual(4 * 1024 + 50);
    expect(longRes.resultTruncated).toBe(true);

    expect(short.truncated).toBe(false);
    expect(short.outputBytes).toBe(shortOut.length);
    expect(short.resultTruncated ?? false).toBe(false);
  });
});
