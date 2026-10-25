import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { MACOS_ONLY_MESSAGE } from '../cuisHome/cuisHome.js';
import { HeadlessError } from '../cuisHome/errors.js';
import { createRunSmalltalkTool } from './tool.js';

describe('createRunSmalltalkTool', () => {
  it('declares run_smalltalk with its schema and description, and rejects a missing code without touching the host', async () => {
    // Given spy status/prepare/run dependencies
    const status = vi.fn();
    const prepare = vi.fn();
    const run = vi.fn();

    // When creating the tool
    const tool = createRunSmalltalkTool({ status, prepare, run } as never);

    // Then it is named run_smalltalk with the documented input schema
    expect(tool.name).toBe('run_smalltalk');
    const schema = tool.inputSchema as {
      type: string;
      properties: Record<string, { type: unknown; items?: { type: unknown } }>;
      required: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties.code.type).toBe('string');
    expect(schema.properties.packages.type).toBe('array');
    expect(schema.properties.packages.items?.type).toBe('string');
    expect(['integer', 'number']).toContain(schema.properties.timeoutSeconds.type);
    expect(schema.required).toEqual(['code']);

    // And the description warns about host side effects, telling the user, and the live image
    expect(tool.description).toMatch(/side effect/i);
    expect(tool.description).toMatch(/ask the user/i);
    expect(tool.description).toMatch(/explicit/i);
    expect(tool.description).toMatch(/wait/i);
    expect(tool.description).toMatch(/live image/i);

    // When calling the handler without code
    const result = await tool.handler({});

    // Then it returns an invalid_code setup_error
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('setup_error');
    expect(body.error.startsWith('invalid_code: ')).toBe(true);

    // And none of the dependencies were called
    expect(status).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('runs valid code through a transient harness directory and returns the parsed outcome', async () => {
    // Given a ready Cuis and a fake run that inspects the harness files during the call
    const seen: {
      harness?: string;
      userCode?: string;
      scriptPath?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {};
    const status = vi.fn().mockResolvedValue({ state: 'ready' });
    const run = vi.fn(async (_home: unknown, runOpts: { scriptPath: string; timeoutMs: number; signal?: AbortSignal }) => {
      seen.scriptPath = runOpts.scriptPath;
      seen.timeoutMs = runOpts.timeoutMs;
      seen.signal = runOpts.signal;
      seen.harness = readFileSync(runOpts.scriptPath, 'utf8');
      seen.userCode = readFileSync(join(dirname(runOpts.scriptPath), 'user-code.st'), 'utf8');
      const nonce = /(\w+) RESULT /.exec(seen.harness)![1];
      return {
        outcome: 'passed',
        exitCode: 0,
        output: `hello\n${nonce} RESULT 7\nDONE exitCode=0\n`,
      };
    });
    const tool = createRunSmalltalkTool({ status, run } as never);
    const controller = new AbortController();

    // When calling the handler with code, a timeout and a signal
    const result = await (tool.handler as (a: unknown, c: unknown) => Promise<{
      isError?: boolean;
      content: { text: string }[];
    }>)({ code: '3 + 4', timeoutSeconds: 5 }, { signal: controller.signal });

    // Then it returns the parsed outcome without marker lines
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('passed');
    expect(body.result).toBe('7');
    expect(body.exitCode).toBe(0);
    expect(body.output).toContain('hello');
    expect(body.output).not.toContain('RESULT');

    // And the user code was written verbatim next to the harness, which references it
    const dir = dirname(seen.scriptPath!);
    expect(seen.userCode).toBe('3 + 4');
    expect(seen.harness).toContain(join(dir, 'user-code.st'));

    // And run received the timeout in ms and the same signal
    expect(seen.timeoutMs).toBe(5000);
    expect(seen.signal).toBe(controller.signal);

    // And the directory was a temp cuis-mcp-run- directory that is removed afterwards
    expect([tmpdir(), realpathSync(tmpdir())]).toContain(dirname(dir));
    expect(basename(dir).startsWith('cuis-mcp-run-')).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('maps a HeadlessError from run to a setup_error, rethrows other errors, and always removes the scratch directory', async () => {
    const status = vi.fn().mockResolvedValue({ state: 'ready' });
    const recordAndReject = (error: Error) => {
      const seen: { scriptPath?: string } = {};
      const run = vi.fn(async (_home: unknown, runOpts: { scriptPath: string }) => {
        seen.scriptPath = runOpts.scriptPath;
        throw error;
      });
      return { seen, tool: createRunSmalltalkTool({ status, run } as never) };
    };

    // Given a run that rejects with a HeadlessError
    const message = 'The shared Cuis at /x is damaged; delete that directory and prepare it again';
    const headless = recordAndReject(new HeadlessError('cuis_corrupt', message));

    // When calling the handler
    const result = await headless.tool.handler({ code: '3 + 4' });

    // Then it resolves with a setup_error carrying the code and message
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('setup_error');
    expect(body.error).toBe(`cuis_corrupt: ${message}`);

    // And the scratch directory was removed
    expect(existsSync(dirname(headless.seen.scriptPath!))).toBe(false);

    // Given a run that rejects with a plain error
    const plain = recordAndReject(new Error('boom'));

    // When calling the handler, Then it rejects with that error
    await expect(plain.tool.handler({ code: '3 + 4' })).rejects.toThrow('boom');

    // And the scratch directory was still removed
    expect(existsSync(dirname(plain.seen.scriptPath!))).toBe(false);
  });

  it('reports a setup_error for a missing, preparing or failed Cuis, starting preparation only when missing or failed', async () => {
    const callWith = async (state: unknown) => {
      const status = vi.fn().mockResolvedValue(state);
      const prepare = vi.fn().mockResolvedValue('started');
      const run = vi.fn();
      const tool = createRunSmalltalkTool({ status, prepare, run } as never);
      const result = await tool.handler({ code: '3 + 4' });
      return { result, body: JSON.parse(result.content[0].text), prepare, run };
    };

    // Given a missing Cuis, When calling the handler
    const missing = await callWith({ state: 'missing' });

    // Then preparation is started once, nothing runs, and the error asks to retry
    expect(missing.prepare).toHaveBeenCalledTimes(1);
    expect(missing.run).not.toHaveBeenCalled();
    expect(missing.result.isError).toBe(true);
    expect(missing.body.status).toBe('setup_error');
    expect(missing.body.error.startsWith('cuis_missing: ')).toBe(true);
    expect(missing.body.error).toMatch(/started|retry/i);

    // Given a Cuis that is being prepared, When calling the handler
    const preparing = await callWith({ state: 'preparing' });

    // Then neither prepare nor run is called and the error is cuis_initializing
    expect(preparing.prepare).not.toHaveBeenCalled();
    expect(preparing.run).not.toHaveBeenCalled();
    expect(preparing.result.isError).toBe(true);
    expect(preparing.body.status).toBe('setup_error');
    expect(preparing.body.error.startsWith('cuis_initializing: ')).toBe(true);

    // Given a failed previous preparation, When calling the handler
    const failed = await callWith({
      state: 'failed',
      error: { code: 'cuis_checksum_mismatch', message: 'bad hash' },
    });

    // Then a fresh attempt is started, nothing runs, and the recorded error is reported
    expect(failed.prepare).toHaveBeenCalledTimes(1);
    expect(failed.run).not.toHaveBeenCalled();
    expect(failed.result.isError).toBe(true);
    expect(failed.body.status).toBe('setup_error');
    expect(failed.body.error.startsWith('cuis_checksum_mismatch: ')).toBe(true);
    expect(failed.body.error).toContain('bad hash');
  });

  it('rejects a non-macOS platform with unsupported_platform before touching the host, after validating input', async () => {
    // Given a tool on linux with spy status/prepare/run dependencies
    const status = vi.fn();
    const prepare = vi.fn();
    const run = vi.fn();
    const tool = createRunSmalltalkTool({ platform: 'linux', status, prepare, run } as never);

    // When calling the handler with valid code
    const result = await tool.handler({ code: '1' });

    // Then it returns an unsupported_platform setup_error with the macOS-only message
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('setup_error');
    expect(body.error).toBe(`unsupported_platform: ${MACOS_ONLY_MESSAGE}`);

    // And none of the dependencies were called
    expect(status).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();

    // When calling the handler with invalid input on the same tool
    const invalid = await tool.handler({});

    // Then input validation still wins
    expect(invalid.isError).toBe(true);
    expect(JSON.parse(invalid.content[0].text).error.startsWith('invalid_code: ')).toBe(true);
  });

  it('loads a package from where it is: the file and its directory are unchanged and the harness uses its original absolute path (invariant 21)', async () => {
    // Given a package file in its own directory, with its hash, mtime and parent listing recorded
    const pkgDir = realpathSync(mkdtempSync(join(tmpdir(), 'pkg-src-')));
    try {
      const pkg = join(pkgDir, 'Sample.pck.st');
      writeFileSync(pkg, "'sample package content'\n");
      const fingerprint = () => ({
        hash: createHash('sha256').update(readFileSync(pkg)).digest('hex'),
        mtimeMs: statSync(pkg).mtimeMs,
        listing: readdirSync(pkgDir).sort(),
      });
      const before = fingerprint();
      let harness = '';
      const status = vi.fn().mockResolvedValue({ state: 'ready' });
      const run = vi.fn(async (_home: unknown, runOpts: { scriptPath: string }) => {
        harness = readFileSync(runOpts.scriptPath, 'utf8');
        return { outcome: 'passed', exitCode: 0, output: 'DONE exitCode=0\n' };
      });
      const tool = createRunSmalltalkTool({ status, run } as never);

      // When running with that package
      const result = await tool.handler({ code: '1', packages: [pkg] });

      // Then the run passed, the package file and its directory are unchanged, and the harness names the original path
      expect(result.isError).toBeFalsy();
      expect(fingerprint()).toEqual(before);
      expect(harness).toContain(pkg);
    } finally {
      rmSync(pkgDir, { recursive: true, force: true });
    }
  });
});
