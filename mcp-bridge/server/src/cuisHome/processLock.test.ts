import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, isLockLive, releaseLock } from './processLock.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('processLock', () => {
  let tmp: Awaited<ReturnType<typeof makeTempHome>>;

  beforeEach(async () => {
    tmp = await makeTempHome();
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('acquireLock on a path with no existing lock resolves true and writes {pid, startTime}', async () => {
    // Given
    const lockFile = path.join(tmp.home, 'x.lock');

    // When
    const acquired = await acquireLock(lockFile);

    // Then
    expect(acquired).toBe(true);
    const content = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    expect(content.pid).toBe(process.pid);
    expect(typeof content.startTime).toBe('string');
    expect(content.startTime.length).toBeGreaterThan(0);
  });

  it('isLockLive is true for a freshly acquired lock and false for a path with no file', async () => {
    // Given
    const lockFile = path.join(tmp.home, 'live.lock');
    const missingFile = path.join(tmp.home, 'missing.lock');
    await acquireLock(lockFile);

    // When
    const liveResult = await isLockLive(lockFile);
    const missingResult = await isLockLive(missingFile);

    // Then
    expect(liveResult).toBe(true);
    expect(missingResult).toBe(false);
  });

  it('second acquireLock on a live lock resolves false, leaves the file unchanged and no temp siblings', async () => {
    // Given
    const lockFile = path.join(tmp.home, 'held.lock');
    await acquireLock(lockFile);
    const before = await fs.readFile(lockFile);

    // When
    const second = await acquireLock(lockFile);

    // Then
    expect(second).toBe(false);
    const after = await fs.readFile(lockFile);
    expect(after.equals(before)).toBe(true);
    expect(await fs.readdir(tmp.home)).toEqual(['held.lock']);
  });

  it.each([
    ['dead pid'],
    ['pid reuse (live pid, wrong start time)'],
    ['corrupt content'],
  ])('acquireLock takes over a stale lock (%s), rewrites it for this process and leaves no siblings', async (shape) => {
    // Given
    const lockFile = path.join(tmp.home, 'stale.lock');
    const oldStart = 'Thu Jan  1 00:00:00 1970';
    if (shape === 'dead pid') {
      const child = spawn(process.execPath, ['-e', '']);
      await new Promise((resolve) => child.on('exit', resolve));
      await fs.writeFile(lockFile, JSON.stringify({ pid: child.pid, startTime: oldStart }));
    } else if (shape.startsWith('pid reuse')) {
      await fs.writeFile(lockFile, JSON.stringify({ pid: process.pid, startTime: oldStart }));
    } else {
      await fs.writeFile(lockFile, 'not json');
    }

    // When
    const acquired = await acquireLock(lockFile);

    // Then
    expect(acquired).toBe(true);
    const content = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    expect(content.pid).toBe(process.pid);
    expect(await isLockLive(lockFile)).toBe(true);
    expect(await fs.readdir(tmp.home)).toEqual(['stale.lock']);
  });

  it('8 concurrent acquireLock calls on a stale lock (dead pid) yield exactly one true, over 20 iterations, leaving only the lock file', async () => {
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => child.on('exit', resolve));
    const oldStart = 'Thu Jan  1 00:00:00 1970';

    for (let i = 0; i < 20; i++) {
      // Given
      const lockFile = path.join(tmp.home, 'race.lock');
      await fs.writeFile(lockFile, JSON.stringify({ pid: child.pid, startTime: oldStart }));

      // When
      const results = await Promise.all(Array.from({ length: 8 }, () => acquireLock(lockFile)));

      // Then
      expect(results.filter((r) => r === true)).toHaveLength(1);
      expect(results.filter((r) => r === false)).toHaveLength(7);
      const content = JSON.parse(await fs.readFile(lockFile, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(await fs.readdir(tmp.home)).toEqual(['race.lock']);
      await fs.rm(lockFile);
    }
  });

  it.each([
    ['own lock is removed'],
    ['foreign lock is left unchanged'],
    ['missing file resolves without error'],
  ])('releaseLock (%s)', async (shape) => {
    // Given
    const lockFile = path.join(tmp.home, 'release.lock');
    const foreign = JSON.stringify({ pid: 1, startTime: 'x' });
    if (shape === 'own lock is removed') {
      await acquireLock(lockFile);
    } else if (shape === 'foreign lock is left unchanged') {
      await fs.writeFile(lockFile, foreign);
    }

    // When
    await expect(releaseLock(lockFile)).resolves.toBeUndefined();

    // Then
    if (shape === 'foreign lock is left unchanged') {
      expect(await fs.readFile(lockFile, 'utf8')).toBe(foreign);
    } else {
      expect(await fs.readdir(tmp.home)).toEqual([]);
    }
  });
});
