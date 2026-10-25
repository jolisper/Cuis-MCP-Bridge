/**
 * Builds the Smalltalk script that Cuis runs headless for run_smalltalk.
 *
 * Marker protocol: the script writes one line per marker to the Transcript
 * (which is logged to stdout), each prefixed by a per-run nonce so that user
 * output cannot forge markers:
 *
 *   <nonce> RESULT <printString>          value of the evaluated code
 *   <nonce> ERROR <where>: <description>  a guarded step failed
 *   <nonce> TESTS run=N passed=N failures=N errors=N
 *   <nonce> FAILING <printString>         one per failed test
 *   <nonce> ERRORING <printString>        one per errored test
 *
 * Payloads are escaped to stay on a single line (backslash, LF and CR become
 * `\\`, `\n` and `\r`). The final line, not nonce-prefixed, is
 * `DONE exitCode=<0|1>`; the image then quits through `quitPrimitive:` with
 * the same exit code (1 if any step failed or any test failed/errored).
 *
 * State is shared between steps via Smalltalk globals: McpRunValue holds the
 * evaluated value, McpRunFailed the failure flag.
 */
export interface HarnessOptions {
  nonce: string;
  codePath: string;
  packagePaths: string[];
}

/** Exceptions every guarded step reports instead of letting them abort the run. */
const GUARD_EXCEPTIONS = 'on: UnhandledError, Halt, Warning, SyntaxErrorNotification do: ';

const VALUE_KEY = '#McpRunValue';
const FAILED_KEY = '#McpRunFailed';

const markFailed = `Smalltalk at: ${FAILED_KEY} put: true.`;
const hasValue = `(Smalltalk includesKey: ${VALUE_KEY})`;
const readValue = `(Smalltalk at: ${VALUE_KEY})`;
const exitCodeExpr = `((Smalltalk at: ${FAILED_KEY}) ifTrue: [1] ifFalse: [0])`;

/** Escapes a string for use inside a Smalltalk string literal. */
function stString(s: string): string {
  return s.replace(/'/g, "''");
}

/** Wraps a Smalltalk expression so its string value is single-line (see header). */
function escaped(expr: string): string {
  return (
    `(((${expr} copyReplaceAll: '\\' with: '\\\\') ` +
    "copyReplaceAll: (String with: Character lf) with: '\\n') " +
    "copyReplaceAll: (String with: Character cr) with: '\\r')"
  );
}

const errorText = escaped(
  '([ :d | d isString ifTrue: [d] ifFalse: [d printString] ] value: ' +
    '([ :x | [x description] on: Error do: [ :e | x class name asString, \': \', x messageText printString ] ] value: ' +
    '((ex isKindOf: UnhandledError) ifTrue: [ex exception] ifFalse: [ex])))',
);

/** Handler block: flag the run as failed and emit an `ERROR <where>:` marker. */
function reportError(nonce: string, where: string): string {
  return `[ :ex | ${markFailed} Transcript show: '${stString(nonce)} ERROR ${where}: ', ${errorText}; newLine. ].`;
}

function evaluateCode(nonce: string, codePath: string): string {
  return (
    `[ | value src | src := '${stString(codePath)}' asFileEntry fileContents. ` +
    'value := Compiler new evaluate: src in: nil to: nil notifying: nil ifFail: [nil]. ' +
    `Smalltalk at: ${VALUE_KEY} put: value ] ` +
    GUARD_EXCEPTIONS +
    reportError(nonce, 'code')
  );
}

function installPackage(nonce: string, path: string): string {
  const literal = stString(path);
  return (
    `[ CodePackageFile installPackage: '${literal}' asFileEntry ] ` +
    GUARD_EXCEPTIONS +
    reportError(nonce, `package ${literal}`)
  );
}

function printResult(nonce: string): string {
  return (
    `[ ${hasValue} ifTrue: [ ` +
    `Transcript show: '${stString(nonce)} RESULT ', ` +
    `${escaped(`${readValue} printString`)}; newLine ] ] ` +
    GUARD_EXCEPTIONS +
    reportError(nonce, 'result')
  );
}

function printTests(nonce: string): string {
  const n = stString(nonce);
  return (
    `[ (${hasValue} and: [ ${readValue} isKindOf: TestResult ]) ifTrue: [ | r | ` +
    `r := ${readValue}. ` +
    `(r failureCount + r errorCount > 0) ifTrue: [ ${markFailed} ]. ` +
    `Transcript show: '${n} TESTS run=', r runCount printString, ' passed=', r passedCount printString, ` +
    "' failures=', r failureCount printString, ' errors=', r errorCount printString; newLine. " +
    `r failures do: [ :t | Transcript show: '${n} FAILING ', ${escaped('t printString')}; newLine ]. ` +
    `r errors do: [ :t | Transcript show: '${n} ERRORING ', ${escaped('t printString')}; newLine ] ] ] ` +
    GUARD_EXCEPTIONS +
    reportError(nonce, 'tests')
  );
}

export function buildHarness(opts: HarnessOptions): string {
  return [
    'Transcript logToStdout: true.',
    "Utilities setAuthorName: 'MCP Bridge' initials: 'mcp'.",
    `Smalltalk at: ${FAILED_KEY} put: false.`,
    ...opts.packagePaths.map((p) => installPackage(opts.nonce, p)),
    evaluateCode(opts.nonce, opts.codePath),
    printResult(opts.nonce),
    printTests(opts.nonce),
    `Transcript show: 'DONE exitCode=', ${exitCodeExpr} printString; newLine.`,
    `Smalltalk quitPrimitive: ${exitCodeExpr}`,
  ].join('\n');
}
