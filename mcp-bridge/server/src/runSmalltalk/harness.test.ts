import { describe, expect, it } from 'vitest';
import { buildHarness } from './harness.js';

const GUARD = 'on: UnhandledError, Halt, Warning, SyntaxErrorNotification do:';

describe('buildHarness', () => {
  it('starts with Transcript stdout logging followed by author setup', () => {
    // Given
    const opts = { nonce: 'abc123', codePath: '/tmp/code.st', packagePaths: [] };

    // When
    const lines = buildHarness(opts).split('\n');

    // Then
    expect(lines[0]).toBe('Transcript logToStdout: true.');
    expect(lines[1]).toBe("Utilities setAuthorName: 'MCP Bridge' initials: 'mcp'.");
  });

  it('installs each package inside a block guarded by UnhandledError, Halt, Warning, SyntaxErrorNotification',() => {
    // Given
    const opts = {
      nonce: 'N0NCE',
      codePath: '/tmp/code.st',
      packagePaths: ['/p/JSON.pck.st', "/p/it's.pck.st"],
    };
    const handler = GUARD;
    const first = "CodePackageFile installPackage: '/p/JSON.pck.st' asFileEntry";
    const second = "CodePackageFile installPackage: '/p/it''s.pck.st' asFileEntry";

    // When
    const script = buildHarness(opts);

    // Then
    const firstAt = script.indexOf(first);
    const secondAt = script.indexOf(second);
    expect(firstAt).toBeGreaterThan(-1);
    expect(secondAt).toBeGreaterThan(firstAt);
    expect(script.indexOf(handler, firstAt)).toBeGreaterThan(firstAt);
    expect(script.indexOf(handler, secondAt)).toBeGreaterThan(secondAt);
    expect(script).toContain('N0NCE ERROR');
    // Narrow on purpose: statement guards bind `:ex`; the nested safe-describe helper inside the handler body legitimately uses `on: Error do: [ :e |`.
    expect(script).not.toMatch(/\] on: Error do: \[ :ex/);
    const guardLines = script.split('\n').filter((line) => line.includes(' do: [ :ex |'));
    expect(guardLines.length).toBeGreaterThan(0);
    for (const line of guardLines) expect(line).toContain(GUARD);
  });

  it('evaluates the code file after package installs, guarded, assigning the result to value', () => {
    // Given
    const opts = {
      nonce: 'N0NCE',
      codePath: "/tmp/it's code.st",
      packagePaths: ['/p/JSON.pck.st'],
    };
    const install = "CodePackageFile installPackage: '/p/JSON.pck.st' asFileEntry";
    const read = "'/tmp/it''s code.st' asFileEntry fileContents";
    const evaluate = 'Compiler new evaluate:';
    const evalTail = 'in: nil to: nil notifying: nil ifFail: [nil]';
    const handler = GUARD;

    // When
    const script = buildHarness(opts);

    // Then
    const installAt = script.indexOf(install);
    const readAt = script.indexOf(read);
    const evalAt = script.indexOf(evaluate);
    expect(installAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(installAt);
    expect(evalAt).toBeGreaterThan(installAt);
    expect(script.indexOf(evalTail, evalAt)).toBeGreaterThan(evalAt);
    expect(script.indexOf(handler, evalAt)).toBeGreaterThan(evalAt);
    expect(script.indexOf('N0NCE ERROR code', evalAt)).toBeGreaterThan(evalAt);
    expect(script).toContain('value := ');
    expect(script).not.toContain('Compiler evaluate:');
    // Narrow on purpose: statement guards bind `:ex`; the nested safe-describe helper inside the handler body legitimately uses `on: Error do: [ :e |`.
    expect(script).not.toMatch(/\] on: Error do: \[ :ex/);
  });

  it('prints the escaped printString of McpRunValue after the evaluation, behind a RESULT marker', () => {
    // Given
    const opts = { nonce: 'N0NCE', codePath: '/tmp/code.st', packagePaths: [] };
    const store = 'Smalltalk at: #McpRunValue put: value';
    const guard = 'Smalltalk includesKey: #McpRunValue';
    const marker = "Transcript show: 'N0NCE RESULT ', ";
    const backslash = "copyReplaceAll: '\\' with: '\\\\'";
    const lineFeed = "copyReplaceAll: (String with: Character lf) with: '\\n'";
    const carriageReturn = "copyReplaceAll: (String with: Character cr) with: '\\r'";

    // When
    const script = buildHarness(opts);

    // Then
    const storeAt = script.indexOf(store);
    expect(storeAt).toBeGreaterThan(-1);
    const guardAt = script.indexOf(guard, storeAt);
    expect(guardAt).toBeGreaterThan(storeAt);
    const markerAt = script.indexOf(marker, storeAt);
    expect(markerAt).toBeGreaterThan(storeAt);
    const tail = script.slice(markerAt);
    expect(tail).toContain('(Smalltalk at: #McpRunValue) printString');
    expect(tail).toContain(backslash);
    expect(tail).toContain(lineFeed);
    expect(tail).toContain(carriageReturn);
    expect(tail).toContain('; newLine');
  });

  it('prints TESTS, FAILING and ERRORING markers when McpRunValue is a TestResult, guarded', () => {
    // Given
    const opts = { nonce: 'N0NCE', codePath: '/tmp/code.st', packagePaths: [] };
    const resultMarker = "Transcript show: 'N0NCE RESULT ', ";
    const guardKey = 'Smalltalk includesKey: #McpRunValue';
    const guardKind = '(Smalltalk at: #McpRunValue) isKindOf: TestResult';
    const handler = GUARD;
    const backslash = "copyReplaceAll: '\\' with: '\\\\'";

    // When
    const script = buildHarness(opts);

    // Then
    const resultAt = script.indexOf(resultMarker);
    expect(resultAt).toBeGreaterThan(-1);
    const kindAt = script.indexOf(guardKind, resultAt);
    expect(kindAt).toBeGreaterThan(resultAt);
    const section = script.slice(kindAt);
    expect(script.slice(resultAt, kindAt + guardKind.length)).toContain(guardKey);
    expect(section).toContain("N0NCE TESTS run=");
    expect(section).toContain('runCount');
    expect(section).toContain(' passed=');
    expect(section).toContain('passedCount');
    expect(section).toContain(' failures=');
    expect(section).toContain('failureCount');
    expect(section).toContain(' errors=');
    expect(section).toContain('errorCount');
    expect(section).toContain('failures do:');
    expect(section).toContain('N0NCE FAILING ');
    expect(section).toContain('errors do:');
    expect(section).toContain('N0NCE ERRORING ');
    expect(section).toContain('printString');
    expect(section).toContain(handler);
    expect(section).toContain('N0NCE ERROR tests');
    expect(script.split(backslash).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('escapes backslashes in the text printed by every ERROR marker handler', () => {
    // Given
    const opts = { nonce: 'N0NCE', codePath: '/tmp/code.st', packagePaths: ['/p/JSON.pck.st'] };
    const backslash = "copyReplaceAll: '\\' with: '\\\\'";

    // When
    const script = buildHarness(opts);

    // Then
    const segments = script.split('N0NCE ERROR ').slice(1);
    expect(segments.length).toBe(4);
    for (const segment of segments) {
      const statement = segment.slice(0, segment.indexOf('; newLine'));
      expect(statement).toContain(backslash);
    }
  });

  it('terminates every guarded statement with a period and parenthesizes the McpRunValue key test', () => {
    // Given
    const opts = { nonce: 'N0NCE', codePath: '/tmp/code.st', packagePaths: ['/p/JSON.pck.st'] };
    const handler = GUARD;
    const keyTest = 'Smalltalk includesKey: #McpRunValue';

    // When
    const script = buildHarness(opts);

    // Then
    const guardedLines = script.split('\n').filter((line) => line.includes(handler));
    expect(guardedLines.length).toBeGreaterThan(0);
    for (const line of guardedLines) {
      expect(line.trimEnd().endsWith('].'), line).toBe(true);
    }
    expect(script).not.toContain('includesKey: #McpRunValue ifTrue:');
    let at = script.indexOf(keyTest);
    expect(at).toBeGreaterThan(-1);
    while (at !== -1) {
      expect(script[at - 1]).toBe('(');
      expect(script[at + keyTest.length]).toBe(')');
      at = script.indexOf(keyTest, at + 1);
    }
  });

  it('guards Halt too and converts a non-string description before escaping it', () => {
    // Given
    const opts = { nonce: 'N0NCE', codePath: '/tmp/code.st', packagePaths: ['/p/JSON.pck.st'] };

    // When
    const script = buildHarness(opts);

    // Then
    const guardedLines = script.split('\n').filter((line) => /\bon: .* do: \[ :ex \|/.test(line));
    expect(guardedLines.length).toBe(4);
    for (const line of guardedLines) {
      const selectors = line.match(/\bon: (.*?) do: \[ :ex \|/)![1].split(',').map((s) => s.trim());
      expect(selectors, line).toContain('Halt');
    }
    const segments = script.split('N0NCE ERROR ').slice(1);
    expect(segments.length).toBe(4);
    for (const segment of segments) {
      const statement = segment.slice(0, segment.indexOf('; newLine'));
      expect(statement).toContain('isString');
      expect(statement).toContain('printString');
    }
  });

  it('tracks failure in McpRunFailed and finishes with a DONE exitCode line followed by quitPrimitive', () => {
    // Given
    const opts = { nonce: 'N0NCE', codePath: '/tmp/code.st', packagePaths: ['/p/JSON.pck.st'] };
    const handler = `${GUARD} [`;
    const setFailed = 'Smalltalk at: #McpRunFailed put: true';

    // When
    const script = buildHarness(opts);

    // Then
    const lines = script.split('\n');
    expect(lines[2]).toBe('Smalltalk at: #McpRunFailed put: false.');

    const handlerBodies = script.split(handler).slice(1);
    expect(handlerBodies.length).toBe(4);
    for (const body of handlerBodies) {
      expect(body.split('\n')[0]).toContain(setFailed);
    }

    const testsAt = script.indexOf('isKindOf: TestResult');
    expect(testsAt).toBeGreaterThan(-1);
    const doneAt = script.indexOf('DONE exitCode=');
    expect(doneAt).toBeGreaterThan(testsAt);
    const testsRegion = script.slice(testsAt, doneAt);
    expect(testsRegion).toContain('failureCount');
    expect(testsRegion).toContain('errorCount');
    expect(testsRegion).toContain('McpRunFailed put: true');

    expect(script.slice(doneAt)).toContain('McpRunFailed');
    const quitAt = script.indexOf('quitPrimitive:', doneAt);
    expect(quitAt).toBeGreaterThan(doneAt);
    expect(lines[lines.length - 1].trim()).toMatch(/^Smalltalk quitPrimitive: /);
  });
});
