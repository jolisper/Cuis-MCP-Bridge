/**
 * Validates the arguments of a run_smalltalk call.
 *
 * Checks, in order, each failing with a `RunInputError`:
 * 1. `code` is a non-empty string (`invalid_code`);
 * 2. `timeoutSeconds`, if given, is an integer within bounds (`invalid_timeout`);
 * 3. `packages`, if given, is an array of non-empty strings (`invalid_packages`), each resolving
 *    against `cwd` to an existing `.pck.st` file (`package_not_found`, `package_not_pck`) and
 *    to be readable (`package_unreadable`).
 */
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { RunInputError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_SECONDS = 300;
const PACKAGE_EXTENSION = '.pck.st';

/** Returns `code` if it is a non-empty string, otherwise throws `invalid_code`. */
function validateCode(code: unknown): string {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new RunInputError('invalid_code', 'code must be a non-empty string');
  }
  return code;
}

/** Converts `timeoutSeconds` to milliseconds (default when absent), or throws `invalid_timeout`. */
function validateTimeoutMs(timeoutSeconds: unknown): number {
  if (timeoutSeconds === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (
    typeof timeoutSeconds !== 'number' ||
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > MAX_TIMEOUT_SECONDS
  ) {
    throw new RunInputError(
      'invalid_timeout',
      `timeoutSeconds must be an integer between 1 and ${MAX_TIMEOUT_SECONDS}`,
    );
  }
  return timeoutSeconds * 1000;
}

/** Throws `invalid_packages` unless `packages` is absent or an array of non-empty strings. */
function assertPackagesShape(packages: unknown): void {
  if (
    packages !== undefined &&
    (!Array.isArray(packages) || !packages.every((p) => typeof p === 'string' && p !== ''))
  ) {
    throw new RunInputError('invalid_packages', 'packages must be an array of non-empty strings');
  }
}

/** Throws `package_not_found` or `package_not_pck` unless `pkg` is an existing `.pck.st` file. */
async function assertPackageFile(pkg: string): Promise<void> {
  let stats;
  try {
    stats = await stat(pkg);
  } catch {
    throw new RunInputError('package_not_found', `package not found: ${pkg}`);
  }
  if (!stats.isFile() || !pkg.endsWith(PACKAGE_EXTENSION)) {
    throw new RunInputError('package_not_pck', `package is not a ${PACKAGE_EXTENSION} file: ${pkg}`);
  }
  try {
    await access(pkg, constants.R_OK);
  } catch {
    throw new RunInputError('package_unreadable', `package is not readable: ${pkg}`);
  }
}

/** Validates `packages` and returns them as absolute paths resolved against `cwd`. */
async function validatePackages(packages: unknown, cwd: string): Promise<string[]> {
  assertPackagesShape(packages);
  const resolved = ((packages as string[] | undefined) ?? []).map((p) => path.resolve(cwd, p));
  for (const pkg of resolved) {
    await assertPackageFile(pkg);
  }
  return resolved;
}

export async function validateInput(
  args: Record<string, unknown>,
  cwd: string,
): Promise<{ code: string; packages: string[]; timeoutMs: number }> {
  const code = validateCode(args.code);
  const timeoutMs = validateTimeoutMs(args.timeoutSeconds);
  const packages = await validatePackages(args.packages, cwd);
  return { code, packages, timeoutMs };
}
