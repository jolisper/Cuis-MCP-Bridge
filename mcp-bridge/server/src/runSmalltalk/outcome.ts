/**
 * Turns the raw output of a headless Cuis run into the final outcome reported to the caller.
 *
 * Pipeline: parse -> status -> caps
 *  1. parseRun:             extract nonce-tagged marker lines (RESULT, ERROR, TESTS, FAILING, ERRORING)
 *                           from the raw output; remaining lines are the user-visible output.
 *  2. buildUncappedOutcome: combine the parsed data with the runner's outcome to decide the status
 *                           (passed / failed / timeout / setup_error) and the error message.
 *  3. withCaps:             truncate output and result to their size limits and record the original size.
 */
import type { RunHeadlessResult } from '../cuisHome/runner.js';

export interface TestSummary {
  run: number;
  passed: number;
  failures: number;
  errors: number;
  failing: string[];
  erroring: string[];
}

export interface StageError {
  stage: string;
  message: string;
}

/** What parseRun extracts from the raw output. */
export interface ParsedRun {
  result?: string;
  errors: StageError[];
  output: string;
  tests?: TestSummary;
}

/** Final outcome of a run, after status resolution and size caps. */
export interface RunOutcome {
  status: string;
  exitCode: number;
  output: string;
  outputBytes: number;
  truncated: boolean;
  result?: string;
  resultTruncated: boolean;
  tests?: TestSummary;
  error?: string;
}

type UncappedOutcome = Omit<RunOutcome, 'outputBytes' | 'truncated' | 'resultTruncated'>;

const TIMEOUT_MESSAGE = 'timeout: the run did not complete within the time limit or ended without reporting';
const PACKAGE_STAGE_PREFIX = 'package ';

const OUTPUT_HEAD_CHARS = 16 * 1024;
const OUTPUT_TAIL_CHARS = 48 * 1024;
const OUTPUT_MAX_CHARS = OUTPUT_HEAD_CHARS + OUTPUT_TAIL_CHARS;
const OUTPUT_CUT_MARKER = '\n[... truncated ...]\n';
const RESULT_MAX_CHARS = 4 * 1024;

function unescape(text: string): string {
  return text.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c));
}

/** Separates nonce-tagged marker lines from ordinary output. */
export function parseRun(output: string, nonce: string): ParsedRun {
  const resultMarker = `${nonce} RESULT `;
  const errorMarker = `${nonce} ERROR `;
  const errors: StageError[] = [];
  const kept: string[] = [];
  const testsMarker = `${nonce} TESTS `;
  const failingMarker = `${nonce} FAILING `;
  const erroringMarker = `${nonce} ERRORING `;
  const failing: string[] = [];
  const erroring: string[] = [];
  let tests: TestSummary | undefined;
  let result: string | undefined;
  for (const line of output.split('\n')) {
    const r = line.indexOf(resultMarker);
    const e = line.indexOf(errorMarker);
    const t = line.indexOf(testsMarker);
    const f = line.indexOf(failingMarker);
    const g = line.indexOf(erroringMarker);
    if (t >= 0) {
      const m = /run=(\d+) passed=(\d+) failures=(\d+) errors=(\d+)/.exec(line.slice(t + testsMarker.length));
      if (m) {
        tests = { run: +m[1], passed: +m[2], failures: +m[3], errors: +m[4], failing, erroring };
      }
    } else if (f >= 0) {
      failing.push(unescape(line.slice(f + failingMarker.length)));
    } else if (g >= 0) {
      erroring.push(unescape(line.slice(g + erroringMarker.length)));
    } else if (r >= 0) {
      result = unescape(line.slice(r + resultMarker.length));
    } else if (e >= 0) {
      const rest = line.slice(e + errorMarker.length);
      const sep = rest.indexOf(': ');
      errors.push({ stage: rest.slice(0, sep), message: unescape(rest.slice(sep + 2)) });
    } else {
      kept.push(line);
    }
  }
  return { result, errors, output: kept.join('\n'), tests };
}

/** Maps a failing stage reported by the harness to a prefixed error message. */
function errorFor(stage: string, message: string): string {
  if (stage === 'code') return `evaluation_error: ${message}`;
  if (stage.startsWith(PACKAGE_STAGE_PREFIX)) {
    return `package_load_error: ${stage.slice(PACKAGE_STAGE_PREFIX.length)}: ${message}`;
  }
  return `harness_error: ${stage}: ${message}`;
}

function testsFailedMessage(t: TestSummary): string {
  return `tests_failed: ${t.failures} failure(s), ${t.errors} error(s) of ${t.run} run`;
}

/** Resolves status and error from the runner outcome and the parsed markers. */
function buildUncappedOutcome(run: RunHeadlessResult, nonce: string): UncappedOutcome {
  const parsed = parseRun(run.output, nonce);
  if (run.outcome === 'timeout_or_crash') {
    return {
      status: 'timeout',
      exitCode: run.exitCode,
      output: parsed.output,
      result: undefined,
      tests: undefined,
      error: TIMEOUT_MESSAGE,
    };
  }
  if (run.outcome === 'setup_error') {
    return {
      status: 'setup_error',
      exitCode: run.exitCode,
      output: parsed.output,
      result: undefined,
      tests: undefined,
      error: `setup_error: ${run.output.trim()}`,
    };
  }
  const t = parsed.tests;
  const testsFailed = !!t && (t.failures > 0 || t.errors > 0);
  const failed = run.outcome === 'failed' || parsed.errors.length > 0 || testsFailed;
  let error: string | undefined;
  if (parsed.errors.length > 0) {
    error = errorFor(parsed.errors[0].stage, parsed.errors[0].message);
  } else if (t && testsFailed) {
    error = testsFailedMessage(t);
  }
  return {
    status: failed ? 'failed' : 'passed',
    exitCode: run.exitCode,
    output: parsed.output,
    result: parsed.result,
    tests: parsed.tests,
    error,
  };
}

/** Truncates output (keeping head and tail) and result, recording the original output size. */
function withCaps(outcome: UncappedOutcome): RunOutcome {
  const full = outcome.output;
  const truncated = full.length > OUTPUT_MAX_CHARS;
  const output = truncated ? full.slice(0, OUTPUT_HEAD_CHARS) + OUTPUT_CUT_MARKER + full.slice(-OUTPUT_TAIL_CHARS) : full;
  const resultTruncated = outcome.result !== undefined && outcome.result.length > RESULT_MAX_CHARS;
  const result = resultTruncated ? outcome.result!.slice(0, RESULT_MAX_CHARS) : outcome.result;
  return { ...outcome, output, result, truncated, outputBytes: Buffer.byteLength(full), resultTruncated };
}

export function buildOutcome(run: RunHeadlessResult, nonce: string): RunOutcome {
  return withCaps(buildUncappedOutcome(run, nonce));
}
