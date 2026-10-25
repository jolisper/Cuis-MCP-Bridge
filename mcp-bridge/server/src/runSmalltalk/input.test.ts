import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RunInputError } from './errors.js';
import { validateInput } from './input.js';

describe('validateInput', () => {
  it('rejects with invalid_code when code is missing, not a string, empty or whitespace-only', async () => {
    // Given
    const cwd = '/tmp';
    const invalidArgs: Record<string, unknown>[] = [
      {},
      { code: 42 },
      { code: '' },
      { code: '   \n\t ' },
    ];

    for (const args of invalidArgs) {
      // When
      const result = validateInput(args, cwd);

      // Then
      await expect(result).rejects.toBeInstanceOf(RunInputError);
      await expect(result).rejects.toMatchObject({ code: 'invalid_code' });
    }
  });

  it('defaults timeoutMs to 60000, converts valid timeoutSeconds, and rejects invalid ones with invalid_timeout', async () => {
    // Given
    const cwd = '/tmp';
    const code = '1 + 1';
    const validCases: [unknown, number][] = [
      [undefined, 60000],
      [5, 5000],
      [300, 300000],
    ];
    const invalidTimeouts: unknown[] = [0, 301, 1.5, -1, '10'];

    for (const [timeoutSeconds, expectedMs] of validCases) {
      // When
      const result = await validateInput({ code, timeoutSeconds }, cwd);

      // Then
      expect(result.timeoutMs).toBe(expectedMs);
    }

    for (const timeoutSeconds of invalidTimeouts) {
      // When
      const rejected = validateInput({ code, timeoutSeconds }, cwd);

      // Then
      await expect(rejected).rejects.toBeInstanceOf(RunInputError);
      await expect(rejected).rejects.toMatchObject({ code: 'invalid_timeout' });
    }
  });

  it('resolves packages to absolute paths, preserving order, for relative and absolute existing files', async () => {
    // Given
    const cwd = await mkdtemp(path.join(tmpdir(), 'run-smalltalk-input-'));
    try {
      await mkdir(path.join(cwd, 'sub'));
      await writeFile(path.join(cwd, 'a.pck.st'), '');
      const absoluteB = path.join(cwd, 'sub', 'b.pck.st');
      await writeFile(absoluteB, '');

      // When
      const result = await validateInput(
        { code: '1', packages: ['a.pck.st', absoluteB] },
        cwd,
      );

      // Then
      expect(result.packages).toEqual([path.join(cwd, 'a.pck.st'), absoluteB]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects with package_not_found naming the absolute path of the first missing package', async () => {
    // Given
    const cwd = await mkdtemp(path.join(tmpdir(), 'run-smalltalk-input-'));
    try {
      const missing = path.join(cwd, 'missing.pck.st');
      await writeFile(path.join(cwd, 'a.pck.st'), '');
      const second = path.join(cwd, 'also-missing.pck.st');

      // When
      const onlyMissing = validateInput(
        { code: '1', packages: ['missing.pck.st'] },
        cwd,
      );
      const secondMissing = validateInput(
        { code: '1', packages: ['a.pck.st', 'also-missing.pck.st'] },
        cwd,
      );

      // Then
      await expect(onlyMissing).rejects.toBeInstanceOf(RunInputError);
      await expect(onlyMissing).rejects.toMatchObject({
        code: 'package_not_found',
        message: expect.stringContaining(missing),
      });
      await expect(secondMissing).rejects.toBeInstanceOf(RunInputError);
      await expect(secondMissing).rejects.toMatchObject({
        code: 'package_not_found',
        message: expect.stringContaining(second),
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects with package_not_pck naming the absolute path when a package is a directory or lacks the .pck.st extension', async () => {
    // Given
    const cwd = await mkdtemp(path.join(tmpdir(), 'run-smalltalk-input-'));
    try {
      await mkdir(path.join(cwd, 'dir.pck.st'));
      await writeFile(path.join(cwd, 'notes.txt'), '');

      for (const name of ['dir.pck.st', 'notes.txt']) {
        // When
        const result = validateInput({ code: '1', packages: [name] }, cwd);

        // Then
        await expect(result).rejects.toBeInstanceOf(RunInputError);
        await expect(result).rejects.toMatchObject({
          code: 'package_not_pck',
          message: expect.stringContaining(path.join(cwd, name)),
        });
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'rejects with package_unreadable naming the absolute path when a package file has no read permission',
    async () => {
      // Given
      const cwd = await mkdtemp(path.join(tmpdir(), 'run-smalltalk-input-'));
      const locked = path.join(cwd, 'locked.pck.st');
      try {
        await writeFile(locked, '');
        await chmod(locked, 0o000);

        // When
        const result = validateInput(
          { code: '1', packages: ['locked.pck.st'] },
          cwd,
        );

        // Then
        await expect(result).rejects.toBeInstanceOf(RunInputError);
        await expect(result).rejects.toMatchObject({
          code: 'package_unreadable',
          message: expect.stringContaining(locked),
        });
      } finally {
        await chmod(locked, 0o600).catch(() => {});
        await rm(cwd, { recursive: true, force: true });
      }
    },
  );

  it('rejects with invalid_packages when packages is present but not an array of non-empty strings, and accepts absent packages', async () => {
    // Given
    const cwd = '/tmp';
    const invalidPackages: unknown[] = ['a.pck.st', [42], [''], {}];

    for (const packages of invalidPackages) {
      // When
      const result = validateInput({ code: '1', packages }, cwd);

      // Then
      await expect(result).rejects.toBeInstanceOf(RunInputError);
      await expect(result).rejects.toMatchObject({ code: 'invalid_packages' });
    }

    // When
    const absent = await validateInput({ code: '1', packages: undefined }, cwd);

    // Then
    expect(absent.packages).toEqual([]);
  });
});
