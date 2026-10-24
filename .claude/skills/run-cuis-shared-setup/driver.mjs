#!/usr/bin/env node
// Drives the shared Cuis home (status, prepare, wait, run) from the built server code.
// Usage: node driver.mjs status | prepare | wait | run <scriptPath> [timeoutSec=60]
//        | runhl <cuisDir> <baseDir> <script> [timeoutSec=60]
// Env, each passed as a CuisHomeOptions field only when set: CUIS_HOME_DIR -> home (use a
// throwaway directory), CUIS_ARCHIVE_URL -> archiveUrl, CUIS_ARCHIVE_SHA256 -> archiveSha256,
// CUIS_PLATFORM -> platform. `runhl` runs a script on any directory pair, without a shared home.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../../../mcp-bridge/server/dist/cuisHome');
const load = (file) => import(pathToFileURL(path.join(distDir, file)).href);

const WAIT_POLL_MS = 2000;
const WAIT_MAX_MS = 15 * 60 * 1000;

const print = (value) => console.log(JSON.stringify(value));

function errorJson(err) {
  return {
    ok: false,
    error: { code: err?.code ?? 'internal_error', message: err instanceof Error ? err.message : String(err) },
  };
}

async function main() {
  const [command, scriptArg, timeoutArg] = process.argv.slice(2);
  const { cuisHomeStatus, prepareCuisHome } = await load('cuisHome.js');
  const { runWithSharedCuis } = await load('run.js');
  const env = process.env;
  const opts = {
    ...(env.CUIS_HOME_DIR ? { home: env.CUIS_HOME_DIR } : {}),
    ...(env.CUIS_ARCHIVE_URL ? { archiveUrl: env.CUIS_ARCHIVE_URL } : {}),
    ...(env.CUIS_ARCHIVE_SHA256 ? { archiveSha256: env.CUIS_ARCHIVE_SHA256 } : {}),
    ...(env.CUIS_PLATFORM ? { platform: env.CUIS_PLATFORM } : {}),
  };

  switch (command) {
    case 'status': {
      print(await cuisHomeStatus(opts));
      return 0;
    }
    case 'prepare': {
      const result = await prepareCuisHome(opts);
      print({ ok: true, result });
      return 0;
    }
    case 'wait': {
      const deadline = Date.now() + WAIT_MAX_MS;
      for (;;) {
        const status = await cuisHomeStatus(opts);
        if (status.state === 'ready') {
          print(status);
          return 0;
        }
        if (status.state === 'failed') {
          print(status);
          return 1;
        }
        if (Date.now() >= deadline) {
          print({ ok: false, error: { code: 'wait_timeout', message: `still ${status.state} after 15 minutes` } });
          return 1;
        }
        await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
      }
    }
    case 'run': {
      if (!scriptArg) {
        print({ ok: false, error: { code: 'invalid_request', message: 'usage: run <scriptPath> [timeoutSec=60]' } });
        return 1;
      }
      const timeoutSec = timeoutArg === undefined ? 60 : Number(timeoutArg);
      if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
        print({ ok: false, error: { code: 'invalid_request', message: `invalid timeoutSec: ${timeoutArg}` } });
        return 1;
      }
      const result = await runWithSharedCuis(opts, {
        scriptPath: path.resolve(scriptArg),
        timeoutMs: timeoutSec * 1000,
      });
      print({ outcome: result.outcome, exitCode: result.exitCode, output: result.output });
      return result.outcome === 'passed' ? 0 : 1;
    }
    case 'runhl': {
      const [, cuisDir, baseDir, script, timeout] = process.argv.slice(2);
      if (!cuisDir || !baseDir || !script) {
        print({ ok: false, error: { code: 'invalid_request', message: 'usage: runhl <cuisDir> <baseDir> <script> [timeoutSec=60]' } });
        return 1;
      }
      const timeoutSec = timeout === undefined ? 60 : Number(timeout);
      if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
        print({ ok: false, error: { code: 'invalid_request', message: `invalid timeoutSec: ${timeout}` } });
        return 1;
      }
      const { runHeadless } = await load('runner.js');
      const result = await runHeadless({
        cuisDir: path.resolve(cuisDir),
        baseDir: path.resolve(baseDir),
        scriptPath: path.resolve(script),
        timeoutMs: timeoutSec * 1000,
      });
      print({ outcome: result.outcome, exitCode: result.exitCode, output: result.output });
      return result.outcome === 'passed' ? 0 : 1;
    }
    default:
      print({ ok: false, error: { code: 'invalid_request', message: 'usage: status | prepare | wait | run <scriptPath> [timeoutSec] | runhl <cuisDir> <baseDir> <script> [timeoutSec]' } });
      return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    print(errorJson(err));
    process.exitCode = 1;
  },
);
