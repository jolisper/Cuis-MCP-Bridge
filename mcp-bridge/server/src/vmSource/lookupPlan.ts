/**
 * Turns raw primitive-lookup tool arguments into a plan: which VMMaker commit, which
 * generated source file, and which primitive to look for. Pure; touches no git or disk.
 */

import { VmSourceError } from './errors.js';

/** What to look up in the VM source mirror, derived from the tool arguments. */
export interface LookupPlan {
  /** The whole `VMMaker.oscog-<author>.N` name (no closing bracket), taken from `vmVersion`. */
  token: string;
  /** The primitive, by name or by primitive-table index. */
  key: { kind: 'named'; name: string } | { kind: 'numbered'; index: number };
  /** Repo-relative path of the generated source file, e.g. `src/spur64.cog/cointerp.c`. */
  path: string;
  /** The pragma's module, when given. */
  module?: string;
  /** Assumptions applied because a parameter was absent. */
  defaults: ('cog_variant' | 'plain_rendering')[];
  /** Which interpreter rendering `path` names; set only when `module` is omitted. */
  rendering?: 'plain' | 'gcc3x';
}

/**
 * Generated `SqueakFFIPrims` source file per `platformName/platformSubtype`.
 * The `unix` rows rest on file names only.
 */
const FFI_PLUGIN_FILES: Record<string, string> = {
  'Mac OS/aarch64': 'ARM64AppleFFIPlugin.c',
  'Mac OS/x64': 'X64SysVFFIPlugin.c',
  'unix/aarch64': 'ARM64FFIPlugin.c',
  'unix/x64': 'X64SysVFFIPlugin.c',
};

/** The VM family tag in `vmVersion`, e.g. `Cog[Spur]`; undefined when absent. */
function vmFamily(vmVersion: string): string | undefined {
  return /^Open Smalltalk (.+?) VM \[/.exec(vmVersion)?.[1];
}

/**
 * The Spur `src/` directory for `subtype`'s word width; undefined for an unmapped subtype.
 * Also serves as the "is `subtype` mapped" check for every family, Cog[SqueakV3] included.
 */
function spurDir(subtype: string): string | undefined {
  if (subtype === 'intel' || subtype === 'powerpc') return 'spur32.cog';
  if (subtype === 'x64' || subtype === 'aarch64') return 'spur64.cog';
  return undefined;
}

/**
 * The `src/` directory holding the interpreter source for an already-checked `family`
 * and `subtype`, plus the defaults that choice implies. Cog[SqueakV3] uses `v3.cog`
 * for any mapped subtype.
 */
function interpreterDir(family: string, subtype: string): { dir: string; defaults: LookupPlan['defaults'] } {
  if (family === 'Cog[SqueakV3]') {
    return { dir: 'v3.cog', defaults: [] };
  }
  return { dir: spurDir(subtype) as string, defaults: ['cog_variant'] };
}

/** Repo-relative path of the generated source `file` for plugin `module`. */
function pluginPath(module: string, file: string): string {
  return `src/plugins/${module}/${file}`;
}

/**
 * Throws {@link VmSourceError} `invalid_request` when any of `args` is wrongly typed,
 * or when a numbered `lookupKey` comes with a `module`. When `moduleStamps` is given,
 * both `moduleStamps.builtin` and `moduleStamps.loaded` are required string arrays;
 * a wrongly typed field is reported before a missing one.
 */
export function checkArgTypes(args: Record<string, unknown>): void {
  const { vmVersion, lookupKey, module, platformName, platformSubtype, moduleStamps } = args;
  if (typeof vmVersion !== 'string') {
    throw new VmSourceError('invalid_request', 'vmVersion must be a string');
  }
  if (typeof lookupKey !== 'string' && typeof lookupKey !== 'number') {
    throw new VmSourceError('invalid_request', 'lookupKey must be a string or a number');
  }
  if (module !== undefined && typeof module !== 'string') {
    throw new VmSourceError('invalid_request', 'module must be a string');
  }
  if (platformName !== undefined && typeof platformName !== 'string') {
    throw new VmSourceError('invalid_request', 'platformName must be a string');
  }
  if (platformSubtype !== undefined && typeof platformSubtype !== 'string') {
    throw new VmSourceError('invalid_request', 'platformSubtype must be a string');
  }
  if (module !== undefined && typeof lookupKey === 'number') {
    throw new VmSourceError(
      'invalid_request',
      `a numbered primitive can't have a module (lookupKey ${lookupKey} with module '${module}')`,
    );
  }
  if (moduleStamps === undefined) return;
  if (typeof moduleStamps !== 'object' || moduleStamps === null || Array.isArray(moduleStamps)) {
    throw new VmSourceError('invalid_request', 'moduleStamps must be an object');
  }
  const stamps = moduleStamps as Record<string, unknown>;
  const fields = ['builtin', 'loaded'] as const;
  const isStringArray = (value: unknown) => Array.isArray(value) && value.every((s) => typeof s === 'string');
  const badField =
    fields.find((field) => stamps[field] !== undefined && !isStringArray(stamps[field])) ??
    fields.find((field) => stamps[field] === undefined);
  if (badField !== undefined) {
    throw new VmSourceError('invalid_request', `moduleStamps.${badField} must be an array of strings`);
  }
}

/**
 * Builds the {@link LookupPlan} for the raw tool arguments `args`.
 *
 * Path rules:
 * - module omitted: the interpreter for the VM family (`spur64.cog`/`spur32.cog` by
 *   subtype for Cog[Spur], `v3.cog` for Cog[SqueakV3]; the subtype must be mapped
 *   for both); `gcc3x-cointerp.c` when `platformName` is given, else `cointerp.c`;
 * - `SqueakFFIPrims`: the file mapped from `platformName/platformSubtype`;
 * - any other module `M`: `src/plugins/M/M.c`, platform params ignored except that
 *   `platformName` `Win32` is rejected.
 *
 * Checks run in four passes, each throwing the first fault it finds, so the earliest
 * fault class wins when several are present:
 * 1. {@link VmSourceError} `invalid_request` for wrongly typed arguments or a numbered
 *    `lookupKey` with a `module` (see {@link checkArgTypes});
 * 2. `version_unparseable` naming `vmVersion` when its version token is unparseable;
 * 3. `missing_platform_info` naming the parameter: `SqueakFFIPrims` needs
 *    `platformName` and `platformSubtype`; module omitted needs `platformSubtype`;
 * 4. `unsupported_platform` naming the value: `platformName` `Win32` whenever given;
 *    then, for module omitted, a `platformName` other than Mac OS/unix, an unmapped
 *    `platformSubtype`, or a VM family other than Cog[Spur]/Cog[SqueakV3]; for
 *    `SqueakFFIPrims`, a `platformName/platformSubtype` with no mapped file.
 *
 * The module name itself is not validated here; getVmSource checks it against the
 * commit's `src/plugins/` listing before any file is read.
 */
export function planLookup(args: Record<string, unknown>): LookupPlan {
  // Pass 1: argument types.
  checkArgTypes(args);
  const { vmVersion, lookupKey, module, platformName, platformSubtype } = args as {
    vmVersion: string;
    lookupKey: string | number;
    module?: string;
    platformName?: string;
    platformSubtype?: string;
  };

  // Pass 2: version token.
  const tokenMatch = /VMMaker\.oscog-([A-Za-z]+)\.(\d+)\]/.exec(vmVersion);
  if (tokenMatch === null) {
    throw new VmSourceError('version_unparseable', `no VMMaker.oscog-<author>.N] version token in vmVersion '${vmVersion}'`);
  }
  const token = tokenMatch[0].slice(0, -1);

  // Pass 3: missing platform info.
  if (module === 'SqueakFFIPrims') {
    if (platformName === undefined) {
      throw new VmSourceError('missing_platform_info', 'missing platformName (required for module SqueakFFIPrims)');
    }
    if (platformSubtype === undefined) {
      throw new VmSourceError('missing_platform_info', 'missing platformSubtype (required for module SqueakFFIPrims)');
    }
  }
  if (module === undefined && platformSubtype === undefined) {
    throw new VmSourceError('missing_platform_info', 'missing platformSubtype (required when module is omitted)');
  }

  // Pass 4: unsupported platform.
  if (platformName === 'Win32') {
    throw new VmSourceError('unsupported_platform', `unsupported platformName 'Win32'`);
  }
  const family = vmFamily(vmVersion);
  if (module === undefined) {
    if (platformName !== undefined && platformName !== 'Mac OS' && platformName !== 'unix') {
      throw new VmSourceError('unsupported_platform', `unknown platformName '${platformName}' (expected Mac OS or unix)`);
    }
    if (spurDir(platformSubtype as string) === undefined) {
      throw new VmSourceError(
        'unsupported_platform',
        `unknown platformSubtype '${platformSubtype}' (expected x64, aarch64, intel or powerpc)`,
      );
    }
    if (family !== 'Cog[Spur]' && family !== 'Cog[SqueakV3]') {
      throw new VmSourceError(
        'unsupported_platform',
        `unknown VM family '${family ?? vmVersion}' (expected Cog[Spur] or Cog[SqueakV3])`,
      );
    }
  }
  const platform = `${platformName}/${platformSubtype}`;
  if (module === 'SqueakFFIPrims' && FFI_PLUGIN_FILES[platform] === undefined) {
    throw new VmSourceError(
      'unsupported_platform',
      `unmapped SqueakFFIPrims platform '${platform}' (expected Mac OS or unix with x64 or aarch64)`,
    );
  }

  // Build the plan.
  const key: LookupPlan['key'] =
    typeof lookupKey === 'number'
      ? { kind: 'numbered', index: lookupKey }
      : { kind: 'named', name: lookupKey };
  if (module === undefined) {
    const { dir, defaults } = interpreterDir(family as string, platformSubtype as string);
    if (platformName !== undefined) {
      return { token, key, path: `src/${dir}/gcc3x-cointerp.c`, defaults, rendering: 'gcc3x' };
    }
    defaults.push('plain_rendering');
    return { token, key, path: `src/${dir}/cointerp.c`, defaults, rendering: 'plain' };
  }
  if (module === 'SqueakFFIPrims') {
    return { token, key, module, path: pluginPath(module, FFI_PLUGIN_FILES[platform] as string), defaults: [] };
  }
  return { token, key, module, path: pluginPath(module, `${module}.c`), defaults: [] };
}
