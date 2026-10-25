import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cuisHomeStatus,
  MACOS_ONLY_MESSAGE,
  prepareCuisHome,
  type CuisHomeOptions,
} from '../cuisHome/cuisHome.js';
import { HeadlessError } from '../cuisHome/errors.js';
import { runWithSharedCuis } from '../cuisHome/run.js';
import type { ToolCallResult, ToolDefinition } from '../tools.js';
import { RunInputError } from './errors.js';
import { buildHarness } from './harness.js';
import { validateInput } from './input.js';
import { buildOutcome } from './outcome.js';

/** Options of the run_smalltalk tool: Cuis home location plus injectable dependencies. */
export interface RunSmalltalkOptions {
  home?: CuisHomeOptions['home'];
  platform?: CuisHomeOptions['platform'];
  cwd?: string;
  status?: typeof cuisHomeStatus;
  prepare?: typeof prepareCuisHome;
  run?: typeof runWithSharedCuis;
}

/*
 * run_smalltalk: run Smalltalk code in a transient headless Cuis.
 *
 * Flow of a call: validate -> platform -> status -> scratch -> run -> outcome.
 *   1. validate: reject malformed input (RunInputError -> setup_error).
 *   2. platform: only macOS is supported (unsupported_platform).
 *   3. status: the shared Cuis must be ready; a missing or failed one starts
 *      (re)preparation and asks the caller to retry, a preparing one just asks to retry.
 *   4. scratch: a temp directory receives the user code and the generated harness script.
 *   5. run: the harness runs in the shared Cuis (HeadlessError -> setup_error).
 *   6. outcome: the run output is mapped to a JSON outcome; a setup_error outcome is flagged isError.
 * The scratch directory is always removed.
 */

/** Prefix of the per-call scratch directory under the OS temp directory. */
const SCRATCH_PREFIX = 'cuis-mcp-run-';
/** File name of the user code inside the scratch directory. */
const CODE_FILE = 'user-code.st';
/** File name of the generated harness script inside the scratch directory. */
const HARNESS_FILE = 'harness.st';

/** Tool description shown to the model, including the review-before-running warning. */
const DESCRIPTION =
  'Run Smalltalk code (mostly SUnit tests) in a transient headless Cuis built from the pinned shared Cuis. ' +
  'It never touches the live image and works without one. ' +
  'The code is NOT sandboxed: before running, review it for host side effects (file writes, network, ' +
  'processes, quit/snapshot, dynamic evaluation), stop and ask the user for an explicit yes, saying what it will do, ' +
  'and wait for it before running; do not run such code on your own. ' +
  'Relative file writes land in the shared Cuis distribution directory. ' +
  'Packages must list their dependencies explicitly (for example JSON, Network-Kernel) as .pck.st paths. ' +
  'Outcome statuses and error codes: cuis_missing (preparation started, retry later), ' +
  'cuis_initializing (still being prepared), cuis_corrupt (shared Cuis damaged), ' +
  'unsupported_platform (macOS only).';

type ValidatedInput = Awaited<ReturnType<typeof validateInput>>;

/** Build a setup_error result: `{ status: 'setup_error', error }` flagged as an MCP error. */
function setupError(error: string): ToolCallResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ status: 'setup_error', error }) }],
  };
}

/** Validate the raw arguments; a `RunInputError` becomes a setup_error result, anything else is rethrown. */
async function validateOrSetupError(
  args: Record<string, unknown>,
  cwd: string,
): Promise<{ input: ValidatedInput } | { error: ToolCallResult }> {
  try {
    return { input: await validateInput(args, cwd) };
  } catch (err) {
    if (err instanceof RunInputError) {
      return { error: setupError(`${err.code}: ${err.message}`) };
    }
    throw err;
  }
}

/**
 * Check the shared Cuis state. Returns a setup_error result when it is not ready
 * (starting preparation when it is missing or failed), or `undefined` when the run can proceed.
 */
async function checkSharedCuis(
  opts: RunSmalltalkOptions,
  home: CuisHomeOptions,
): Promise<ToolCallResult | undefined> {
  const status = await (opts.status ?? cuisHomeStatus)(home);
  if (status.state === 'missing') {
    await (opts.prepare ?? prepareCuisHome)(home);
    return setupError(
      'cuis_missing: The shared Cuis is not installed; preparation has started in the background, retry shortly',
    );
  }
  if (status.state === 'preparing') {
    return setupError('cuis_initializing: The shared Cuis is still being prepared; retry shortly');
  }
  if (status.state === 'failed') {
    await (opts.prepare ?? prepareCuisHome)(home);
    return setupError(
      `${status.error.code}: ${status.error.message} (a new preparation attempt has started; retry shortly)`,
    );
  }
  return undefined;
}

/** Write the user code and the harness script into `dir`; returns the harness path and the output nonce. */
async function writeScratchFiles(
  dir: string,
  input: ValidatedInput,
): Promise<{ scriptPath: string; nonce: string }> {
  const nonce = randomBytes(8).toString('hex');
  const codePath = join(dir, CODE_FILE);
  const scriptPath = join(dir, HARNESS_FILE);
  await writeFile(codePath, input.code);
  await writeFile(scriptPath, buildHarness({ nonce, codePath, packagePaths: input.packages }));
  return { scriptPath, nonce };
}

/** Run the harness in the shared Cuis and map the result to a tool result; a `HeadlessError` becomes a setup_error. */
async function runHarness(
  opts: RunSmalltalkOptions,
  home: CuisHomeOptions,
  scratch: { scriptPath: string; nonce: string },
  input: ValidatedInput,
  signal: AbortSignal | undefined,
): Promise<ToolCallResult> {
  let runResult;
  try {
    runResult = await (opts.run ?? runWithSharedCuis)(home, {
      scriptPath: scratch.scriptPath,
      timeoutMs: input.timeoutMs,
      signal,
    });
  } catch (err) {
    if (err instanceof HeadlessError) {
      return setupError(`${err.code}: ${err.message}`);
    }
    throw err;
  }
  const outcome = buildOutcome(runResult, scratch.nonce);
  return {
    ...(outcome.status === 'setup_error' ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(outcome) }],
  };
}

/** Builds the run_smalltalk tool. */
export function createRunSmalltalkTool(opts: RunSmalltalkOptions = {}): ToolDefinition {
  return {
    name: 'run_smalltalk',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Smalltalk code to run.' },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths of .pck.st packages to load first, dependencies listed explicitly.',
        },
        timeoutSeconds: {
          type: 'integer',
          description: 'Time limit in seconds (default 60, maximum 300).',
        },
      },
      required: ['code'],
    },
    handler: async (args, extra?: { signal?: AbortSignal }) => {
      const validation = await validateOrSetupError(args, opts.cwd ?? process.cwd());
      if ('error' in validation) return validation.error;
      if ((opts.platform ?? process.platform) !== 'darwin') {
        return setupError(`unsupported_platform: ${MACOS_ONLY_MESSAGE}`);
      }
      const home = { home: opts.home, platform: opts.platform };
      const notReady = await checkSharedCuis(opts, home);
      if (notReady) return notReady;
      const dir = await mkdtemp(join(tmpdir(), SCRATCH_PREFIX));
      try {
        const scratch = await writeScratchFiles(dir, validation.input);
        return await runHarness(opts, home, scratch, validation.input, extra?.signal);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
