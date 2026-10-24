import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASE_DIR, cuisHomeStatus, DIST_DIR, layoutDir, prepareCuisHome } from './cuisHome.js';
import { CUIS_CHANGES_FILE, CUIS_IMAGE_FILE, CUIS_LAYOUT_KEY, CUIS_SOURCES_FILE, CUIS_VM_PATH } from './pin.js';
import { runWithSharedCuis } from './run.js';
import { makeTempHome } from './testSupport/tempHome.js';

const PREPARE_TIMEOUT_MS = 10 * 60 * 1000;
const TEST_TIMEOUT_MS = 15 * 60 * 1000;

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

describe.skipIf(process.env.CUIS_INTEGRATION !== '1' || process.platform !== 'darwin')(
  'real pinned Cuis',
  () => {
    let tmp: { home: string; cleanup(): Promise<void> };

    beforeEach(async () => {
      tmp = await makeTempHome();
    });

    afterEach(async () => {
      await tmp.cleanup();
    });

    it(
      'fetches, builds the base and runs scripts without modifying it',
      async () => {
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

        const setupDir = layoutDir({ home });
        expect(path.basename(setupDir)).toBe(CUIS_LAYOUT_KEY);
        expect(setupDir).toBe(path.join(home, 'cuis', '7.8-d4f9cc1'));
        await fs.access(path.join(setupDir, DIST_DIR, CUIS_VM_PATH));
        for (const name of [CUIS_IMAGE_FILE, CUIS_SOURCES_FILE, CUIS_CHANGES_FILE]) {
          await fs.access(path.join(setupDir, BASE_DIR, name));
        }

        const before = await snapshot(path.join(setupDir, BASE_DIR));

        const scriptDir = path.join(home, 'scripts');
        await fs.mkdir(scriptDir);
        // A headless Cuis keeps Transcript output in memory unless logToStdout: true runs first.
        const hello = path.join(scriptDir, 'hello.st');
        await fs.writeFile(
          hello,
          [
            "Transcript logToStdout: true.",
            "Transcript show: 'integration hello'; newLine.",
            "Transcript show: 'DONE exitCode=0'; newLine.",
            'Smalltalk quitPrimitive: 0',
            '',
          ].join('\n'),
        );
        const helloResult = await runWithSharedCuis({ home }, { scriptPath: hello, timeoutMs: 120000 });
        expect(helloResult.outcome).toBe('passed');
        expect(helloResult.exitCode).toBe(0);
        expect(helloResult.output).toContain('integration hello');
        expect(helloResult.output).toContain('DONE exitCode=0');

        // In Cuis, `/` addresses a directory entry and `//` a file entry.
        const cwdScript = path.join(scriptDir, 'cwd.st');
        await fs.writeFile(
          cwdScript,
          [
            "Transcript logToStdout: true.",
            "Transcript show: 'packages exist: ', (DirectoryEntry currentDirectory / 'Packages') exists printString; newLine.",
            "Transcript show: 'DONE exitCode=0'; newLine.",
            'Smalltalk quitPrimitive: 0',
            '',
          ].join('\n'),
        );
        const cwdResult = await runWithSharedCuis({ home }, { scriptPath: cwdScript, timeoutMs: 120000 });
        expect(cwdResult.outcome).toBe('passed');
        expect(cwdResult.exitCode).toBe(0);
        expect(cwdResult.output).toContain('packages exist: true');
        expect(cwdResult.output).toContain('DONE exitCode=0');

        expect(await snapshot(path.join(setupDir, BASE_DIR))).toEqual(before);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
