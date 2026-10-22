import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findExport, findTableSlot, indexFunctions, moduleStamp } from './cSource.js';
import { VmSourceError } from './errors.js';
import { getVmSource } from './getVmSource.js';
import { mirrorState, setupVmMirror } from './mirror.js';
import type { VmSourceOptions } from './resolveCommit.js';
import { coreInterp, plugin } from './testSupport/fixtures.js';
import { createHarness, waitFor, type Harness } from './testSupport/harness.js';

const execFileP = promisify(execFile);

const VMVERSION =
  'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636';

const SOCKET_PLUGIN_PATH = 'src/plugins/SocketPlugin/SocketPlugin.c';

const pluginText = plugin({
  module: 'SocketPlugin',
  functions: [
    {
      name: 'primitiveSocketReceiveDataAvailable',
      generatedFrom: 'SocketPlugin>>#primitiveSocketReceiveDataAvailable:',
      args: 'void',
      body: [
        '\tsqInt dataIsAvailable;',
        '\tSQSocket *s;',
        '\tsqInt socket;',
        '',
        '\ts = socketValueOf(socket);',
        '\tdataIsAvailable = sqSocketReceiveDataAvailable(s);',
        '\treturn interpreterProxy->methodReturnBool(dataIsAvailable);',
      ],
    },
    {
      name: 'socketValueOf',
      generatedFrom: 'SocketPlugin>>#socketValueOf:',
      returnType: 'static SQSocket *',
      args: 'sqInt socketOop',
      body: ['\treturn (SQSocket *) socketOop;'],
    },
  ],
  exports: [{ name: 'primitiveSocketReceiveDataAvailable' }, { name: 'primitiveSocketUndefined' }],
  extra: Array.from({ length: 2000 }, (_, i) => `/* padding line ${i} */`),
});

const coreText = coreInterp({
  version: '3794',
  functions: [
    {
      name: 'primitiveAdd',
      generatedFrom: 'InterpreterPrimitives>>#primitiveAdd',
      body: ['\tsqInt rcvr;', '', '\trcvr = longAt(GIV(stackPointer) + oopSize);'],
    },
    {
      name: 'externalQuickPrimitiveResponse',
      generatedFrom: 'StackInterpreter>>#externalQuickPrimitiveResponse',
      body: ['\tsqInt result;', '', '\tresult = GIV(primitiveFunctionPointer);'],
    },
    {
      name: 'primitiveExternalCall',
      generatedFrom: 'InterpreterPrimitives>>#primitiveExternalCall',
      body: ['\tsqInt lit;', '', '\tlit = literalofMethod(0, GIV(newMethod));'],
    },
  ],
  table: { 1: 'primitiveAdd', 117: 'primitiveExternalCall', 256: 256 },
});

const gccText = coreInterp({
  version: '3794',
  functions: [
    {
      name: 'primitiveAdd',
      generatedFrom: 'InterpreterPrimitives>>#primitiveAdd',
      body: ['\t/* gcc3x rendering */', '\tsqInt rcvr;', '', '\trcvr = longAt(GIV(stackPointer) + oopSize);'],
    },
  ],
  table: { 1: 'primitiveAdd' },
});

const APPLE_FFI_PATH = 'src/plugins/SqueakFFIPrims/ARM64AppleFFIPlugin.c';

const ffiPlugin = (stampName: string, stampVersion: string | undefined, marker: string) =>
  plugin({
    module: 'SqueakFFIPrims',
    stampName,
    ...(stampVersion === undefined ? {} : { stampVersion }),
    functions: [
      {
        name: 'primitiveCalloutWithArgs',
        generatedFrom: 'ThreadedFFIPlugin>>#primitiveCalloutWithArgs',
        body: [marker, '\tsqInt argArray;'],
      },
    ],
    exports: [{ name: 'primitiveCalloutWithArgs' }],
  });

const NO_STAMP_PATH = 'src/plugins/NoStampPlugin/NoStampPlugin.c';

const noStampText = plugin({
  module: 'NoStampPlugin',
  functions: [
    {
      name: 'primitiveNoStamp',
      generatedFrom: 'NoStampPlugin>>#primitiveNoStamp',
      body: ['\tsqInt rcvr;'],
    },
  ],
  exports: [{ name: 'primitiveNoStamp' }],
}).replace(/^static const char \*moduleName = .*\n/m, '');

const files: Record<string, string> = {
  [NO_STAMP_PATH]: noStampText,
  'src/spur64.cog/cointerp.c': coreText,
  'src/spur64.cog/gcc3x-cointerp.c': gccText,
  [SOCKET_PLUGIN_PATH]: pluginText,
  [APPLE_FFI_PATH]: ffiPlugin('ARM64AppleFFIPlugin', '3792', '\t/* apple arm64 */'),
  'src/plugins/SqueakFFIPrims/SqueakFFIPrims.c': ffiPlugin('SqueakFFIPrims', undefined, '\t/* generic decoy */'),
  'src/plugins/SqueakFFIPrims/ARM64FFIPlugin.c': ffiPlugin('ARM64FFIPlugin', undefined, '\t/* linux arm64 decoy */'),
};

describe('getVmSource', () => {
  let h: Harness;
  let sha: string;
  let opts: VmSourceOptions;

  beforeAll(async () => {
    h = await createHarness();
    sha = await h.pushUpstream(files, 'CogVM source as per VMMaker.oscog-eem.3794');
    await h.cloneMirror();
    opts = { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git };
  });

  afterAll(async () => {
    await h?.cleanup();
  });

  it('returns a named plugin primitive with its exports-row dispatch and pinned commit metadata', async () => {
    // Given
    const entry = indexFunctions(pluginText).get('primitiveSocketReceiveDataAvailable')!;
    const exportRow = findExport(pluginText, 'primitiveSocketReceiveDataAvailable').row;

    // When
    const result = await getVmSource(opts, {
      vmVersion: VMVERSION,
      lookupKey: 'primitiveSocketReceiveDataAvailable',
      module: 'SocketPlugin',
    });

    // Then
    expect(result.function).toBe(entry.source);
    expect(result.function.startsWith('\t/* SocketPlugin>>#primitiveSocketReceiveDataAvailable: */')).toBe(true);
    expect(result.generatedFrom).toBe('SocketPlugin>>#primitiveSocketReceiveDataAvailable:');
    expect(result.metadata.commit).toBe(sha);
    expect(result.metadata.path).toBe(SOCKET_PLUGIN_PATH);
    expect(result.metadata.lines).toEqual({ start: entry.start, end: entry.end });
    expect(result.metadata.dispatch).toEqual({ kind: 'exports', entry: exportRow });
    expect(result.metadata.defaults).toEqual([]);
  });

  it('lists the in-file helpers and the external calls of the primitive body, with no caveats', async () => {
    // Given
    const helperSource = indexFunctions(pluginText).get('socketValueOf')!.source;

    // When
    const result = await getVmSource(opts, {
      vmVersion: VMVERSION,
      lookupKey: 'primitiveSocketReceiveDataAvailable',
      module: 'SocketPlugin',
    });

    // Then
    expect(result.helpers).toEqual([{ name: 'socketValueOf', source: helperSource }]);
    expect(result.externalCalls).toEqual([
      { name: 'sqSocketReceiveDataAvailable', kind: 'platform_code_unavailable' },
      { name: 'methodReturnBool', kind: 'vm_interface' },
    ]);
    expect(result.caveats).toEqual([]);
  });

  it('returns a numbered core primitive with its table-row dispatch, the cog/plain defaults and their caveats', async () => {
    // Given
    const entry = indexFunctions(coreText).get('primitiveAdd')!;

    // When
    const result = await getVmSource(opts, {
      vmVersion: VMVERSION,
      lookupKey: 1,
      platformSubtype: 'aarch64',
    });

    // Then
    expect(result.function).toBe(entry.source);
    expect(result.generatedFrom).toBe('InterpreterPrimitives>>#primitiveAdd');
    expect(result.metadata.path).toBe('src/spur64.cog/cointerp.c');
    expect(result.metadata.dispatch).toEqual({ kind: 'primitiveTable', entry: '/* 1 */ primitiveAdd,' });
    expect(result.metadata.defaults).toEqual(['cog_variant', 'plain_rendering']);
    expect(result.metadata.rendering).toBe('plain');
    expect('shared' in result.metadata).toBe(false);
    expect(result.caveats).toEqual([
      "The build variant (cog, cog.lowcode or sista) could not be determined, so this is the cog variant's source; the running VM may have been built from a different variant.",
      'No platformName was given, so this is the plain C rendering (cointerp.c); the running VM may have been compiled from the GCC-optimized rendering (gcc3x-cointerp.c).',
    ]);
  });

  it('returns the gcc3x rendering of a numbered core primitive when platformName selects it', async () => {
    // Given
    const gccSource = indexFunctions(gccText).get('primitiveAdd')!.source;
    const plainSource = indexFunctions(coreText).get('primitiveAdd')!.source;
    expect(gccSource).not.toBe(plainSource);

    // When
    const result = await getVmSource(opts, {
      vmVersion: VMVERSION,
      lookupKey: 1,
      platformSubtype: 'aarch64',
      platformName: 'Mac OS',
    });

    // Then
    expect(result.function).toBe(gccSource);
    expect(result.metadata.path).toBe('src/spur64.cog/gcc3x-cointerp.c');
    expect(result.metadata.rendering).toBe('gcc3x');
    expect(result.metadata.defaults).toEqual(['cog_variant']);
    expect(result.caveats).toEqual([
      "The build variant (cog, cog.lowcode or sista) could not be determined, so this is the cog variant's source; the running VM may have been built from a different variant.",
    ]);
  });

  it.each([
    [256, 'externalQuickPrimitiveResponse'],
    [117, 'primitiveExternalCall'],
  ])('returns the shared dispatcher for primitive %i with its shared metadata and caveat', async (n, dispatcher) => {
    // Given
    const dispatcherSource = indexFunctions(coreText).get(dispatcher)!.source;
    const shared = findTableSlot(coreText, n).shared!;

    // When
    const result = await getVmSource(opts, {
      vmVersion: VMVERSION,
      lookupKey: n,
      platformSubtype: 'aarch64',
    });

    // Then
    expect(result.function).toBe(dispatcherSource);
    expect(result.metadata.shared).toEqual(shared);
    expect(result.caveats).toEqual([
      "The build variant (cog, cog.lowcode or sista) could not be determined, so this is the cog variant's source; the running VM may have been built from a different variant.",
      'No platformName was given, so this is the plain C rendering (cointerp.c); the running VM may have been compiled from the GCC-optimized rendering (gcc3x-cointerp.c).',
      `Primitive ${n} has no function of its own; it is served by the shared dispatcher ${dispatcher}, and only this part applies: ${shared.applies}.`,
    ]);
  });

  it('reads only the planned file: the Apple FFI plugin for SqueakFFIPrims, a string key as a name, any SocketPlugin platform', async () => {
    // Given the Apple FFI plugin and two decoy FFI files exporting the same primitive
    const ffiArgs = {
      vmVersion: VMVERSION,
      lookupKey: 'primitiveCalloutWithArgs',
      module: 'SqueakFFIPrims',
      platformName: 'Mac OS',
      platformSubtype: 'aarch64',
    };

    // When looking up the FFI primitive on Mac OS aarch64
    const ffi = await getVmSource(opts, ffiArgs);

    // Then the Apple file is returned, not a decoy
    expect(ffi.metadata.path).toBe(APPLE_FFI_PATH);
    expect(ffi.function).toContain('/* apple arm64 */');
    expect(ffi.function).not.toContain('decoy');

    // Given / When the core key is the string "1"
    const nameKey = getVmSource(opts, { vmVersion: VMVERSION, lookupKey: '1', platformSubtype: 'aarch64' });

    // Then it is treated as a name with no exports row
    await expect(nameKey).rejects.toBeInstanceOf(VmSourceError);
    await expect(nameKey).rejects.toMatchObject({ code: 'symbol_not_found' });

    // Given / When looking up the SocketPlugin primitive on an unusual platform
    const socket = await getVmSource(opts, {
      vmVersion: VMVERSION,
      lookupKey: 'primitiveSocketReceiveDataAvailable',
      module: 'SocketPlugin',
      platformName: 'BeOS',
      platformSubtype: 'm68k',
    });

    // Then the platform-independent plugin file is read
    expect(socket.metadata.path).toBe(SOCKET_PLUGIN_PATH);
  });

  it('throws symbol_not_found when the dispatch row names a function the file never defines', async () => {
    // Given an exports row for primitiveSocketUndefined with no definition in SocketPlugin.c

    // When
    const lookup = getVmSource(opts, {
      vmVersion: VMVERSION,
      lookupKey: 'primitiveSocketUndefined',
      module: 'SocketPlugin',
    });

    // Then
    await expect(lookup).rejects.toBeInstanceOf(VmSourceError);
    await expect(lookup).rejects.toMatchObject({
      code: 'symbol_not_found',
      message: `no definition of 'primitiveSocketUndefined' in ${SOCKET_PLUGIN_PATH}`,
    });
  });

  it.each([
    [
      'core interpreter',
      { 'src/spur32.cog/cointerp.c': coreInterp({ version: '3794' }) },
      { vmVersion: VMVERSION, lookupKey: 1, platformSubtype: 'aarch64' },
      'src/spur64.cog/cointerp.c',
    ],
    [
      'plugin',
      {
        'src/spur64.cog/cointerp.c': coreInterp({ version: '3794' }),
        'src/plugins/SocketPlugin/SocketPlugin.h': '/* header only */\n',
      },
      { vmVersion: VMVERSION, lookupKey: 'primitiveSocketReceiveDataAvailable', module: 'SocketPlugin' },
      SOCKET_PLUGIN_PATH,
    ],
  ])(
    'throws path_not_found naming the file the resolved commit lacks (%s)',
    async (_label, commitFiles, args, missingPath) => {
      const g = await createHarness();
      try {
        // Given a ready mirror whose resolved commit lacks the expected file
        await g.pushUpstream(commitFiles, 'CogVM source as per VMMaker.oscog-eem.3794');
        await g.cloneMirror();
        const gOpts: VmSourceOptions = { home: g.home, upstreamUrl: g.upstreamUrl, git: g.git };

        // When
        const lookup = getVmSource(gOpts, args);

        // Then
        await expect(lookup).rejects.toBeInstanceOf(VmSourceError);
        await expect(lookup).rejects.toMatchObject({
          code: 'path_not_found',
          message: expect.stringContaining(missingPath),
        });
      } finally {
        await g.cleanup();
      }
    },
  );

  it.each([
    ['non-missing-path stderr', { stderr: 'fatal: bad object deadbeef' }, 'mirror_corrupt', 'setup_vm_mirror'],
    ['killed git', { signal: 'KILL' as const }, 'internal_error', 'SIGKILL'],
    ['output over the buffer', { flood: true as const }, 'internal_error', 'maxBuffer'],
  ])(
    'classifies a failing git show of the file as %s',
    async (_label, failure, code, fragment) => {
      const g = await createHarness();
      try {
        // Given a ready mirror whose file read (git show) fails
        await g.pushUpstream(files, 'CogVM source as per VMMaker.oscog-eem.3794');
        await g.cloneMirror();
        const gOpts: VmSourceOptions = { home: g.home, upstreamUrl: g.upstreamUrl, git: g.git };
        await g.failGit('show', failure);

        // When
        const lookup = getVmSource(gOpts, {
          vmVersion: VMVERSION,
          lookupKey: 'primitiveSocketReceiveDataAvailable',
          module: 'SocketPlugin',
        });

        // Then
        await expect(lookup).rejects.toBeInstanceOf(VmSourceError);
        await expect(lookup).rejects.toMatchObject({ code, message: expect.stringContaining(fragment) });
      } finally {
        await g.clearGitFailures();
        await g.cleanup();
      }
    },
    20000,
  );

  const SOURCE_STAMP = 'SocketPlugin VMMaker.oscog-eem.3743';

  it.each([
    [
      'match',
      { builtin: ['FilePlugin VMMaker.oscog-eem.3700 (i)', 'SocketPlugin VMMaker.oscog-eem.3743 (i)'], loaded: [] },
      { result: 'match' },
      [],
    ],
    [
      'mismatch',
      { builtin: [], loaded: ['SocketPlugin VMMaker.oscog-eem.3700 (e)'] },
      { result: 'mismatch', running: 'SocketPlugin VMMaker.oscog-eem.3700', source: SOURCE_STAMP },
      [
        `The running VM reports stamp 'SocketPlugin VMMaker.oscog-eem.3700' for this plugin, but the returned source carries '${SOURCE_STAMP}'; they may differ.`,
      ],
    ],
    [
      'not_verifiable',
      { builtin: ['FilePlugin VMMaker.oscog-eem.3700 (i)'], loaded: [] },
      { result: 'not_verifiable', source: SOURCE_STAMP },
      [
        `The running VM reports no stamp for SocketPlugin, so the returned source ('${SOURCE_STAMP}') could not be checked against it.`,
      ],
    ],
    ['absent', undefined, 'absent', []],
  ])('checks the plugin module stamp against moduleStamps (%s)', async (_label, moduleStamps, check, caveats) => {
    // Given
    expect(moduleStamp(pluginText)).toBe(SOURCE_STAMP);
    const args: Record<string, unknown> = {
      vmVersion: VMVERSION,
      lookupKey: 'primitiveSocketReceiveDataAvailable',
      module: 'SocketPlugin',
      ...(moduleStamps === undefined ? {} : { moduleStamps }),
    };

    // When
    const result = await getVmSource(opts, args);

    // Then
    const actualCheck = 'moduleStampCheck' in result.metadata ? result.metadata.moduleStampCheck : 'absent';
    expect(actualCheck).toEqual(check);
    expect(result.caveats).toEqual(caveats);
  });

  it('picks the commit inside the window whose plugin stamp equals the running stamp, without fetching', async () => {
    const g = await createHarness();
    try {
      // Given a window whose plugin stamp changes from 3700 to 3743 at c2, closed by c3
      const exportsSocket = [{ name: 'primitiveSocketReceiveDataAvailable' }];
      const pluginAt = (stampVersion: string) =>
        plugin({
          module: 'SocketPlugin',
          stampVersion,
          functions: [
            {
              name: 'primitiveSocketReceiveDataAvailable',
              generatedFrom: 'SocketPlugin>>#primitiveSocketReceiveDataAvailable:',
              body: ['\treturn 0;'],
            },
          ],
          exports: exportsSocket,
        });
      const c1 = await g.pushUpstream(
        { 'src/spur64.cog/cointerp.c': coreInterp({ version: '3794' }), [SOCKET_PLUGIN_PATH]: pluginAt('3700') },
        'CogVM source as per VMMaker.oscog-eem.3794',
      );
      const c2 = await g.pushUpstream({ [SOCKET_PLUGIN_PATH]: pluginAt('3743') }, 'SocketPlugin stamp 3743');
      await g.pushUpstream({ 'src/spur64.cog/cointerp.c': coreInterp({ version: '3795' }) }, 'CogVM source as per VMMaker.oscog-eem.3795');
      await g.cloneMirror();
      const gOpts: VmSourceOptions = { home: g.home, upstreamUrl: g.upstreamUrl, git: g.git };
      expect(c1).not.toBe(c2);

      // When
      const mark = await g.argvMark();
      const result = await getVmSource(gOpts, {
        vmVersion: VMVERSION,
        lookupKey: 'primitiveSocketReceiveDataAvailable',
        module: 'SocketPlugin',
        moduleStamps: { builtin: ['SocketPlugin VMMaker.oscog-eem.3743 (i)'], loaded: [] },
      });

      // Then
      expect(result.metadata.commit).toBe(c2);
      expect(result.metadata.moduleStampCheck).toEqual({ result: 'match' });
      expect(result.caveats).toEqual([]);
      expect((await g.argvSince(mark)).some((argv) => argv[1] === 'fetch')).toBe(false);
    } finally {
      await g.cleanup();
    }
  });

  it.each([
    ['a: closed window, no stamp match -> mismatch at introducing commit, no fetch', true, '9999 (i)'],
    ['b: introducing commit already matches -> no walk', true, '3700 (i)'],
    ['c: plugin absent from moduleStamps -> not_verifiable, no walk, no fetch', true, 'absent'],
    ['d: open window, mismatch -> one fetch then picks the new upstream commit', false, '4000 (e)'],
  ])(
    'stamp-guided pick: %s',
    async (label, closed, live) => {
      const g = await createHarness();
      try {
        // Given
        const pluginAt = (stampVersion: string) =>
          plugin({
            module: 'SocketPlugin',
            stampVersion,
            functions: [
              {
                name: 'primitiveSocketReceiveDataAvailable',
                generatedFrom: 'SocketPlugin>>#primitiveSocketReceiveDataAvailable:',
                body: ['\treturn 0;'],
              },
            ],
            exports: [{ name: 'primitiveSocketReceiveDataAvailable' }],
          });
        const c1 = await g.pushUpstream(
          { 'src/spur64.cog/cointerp.c': coreInterp({ version: '3794' }), [SOCKET_PLUGIN_PATH]: pluginAt('3700') },
          'CogVM source as per VMMaker.oscog-eem.3794',
        );
        if (closed) {
          await g.pushUpstream({ [SOCKET_PLUGIN_PATH]: pluginAt('3743') }, 'SocketPlugin stamp 3743');
          await g.pushUpstream(
            { 'src/spur64.cog/cointerp.c': coreInterp({ version: '3795' }) },
            'CogVM source as per VMMaker.oscog-eem.3795',
          );
        }
        await g.cloneMirror();
        let newCommit: string | undefined;
        if (!closed) {
          newCommit = await g.pushUpstream({ [SOCKET_PLUGIN_PATH]: pluginAt('4000') }, 'SocketPlugin stamp 4000');
        }
        const gOpts: VmSourceOptions = { home: g.home, upstreamUrl: g.upstreamUrl, git: g.git };
        const moduleStamps =
          live === 'absent'
            ? { builtin: ['FilePlugin VMMaker.oscog-eem.3700 (i)'], loaded: [] }
            : { builtin: [`SocketPlugin VMMaker.oscog-eem.${live}`], loaded: [] };

        // When
        const mark = await g.argvMark();
        const result = await getVmSource(gOpts, {
          vmVersion: VMVERSION,
          lookupKey: 'primitiveSocketReceiveDataAvailable',
          module: 'SocketPlugin',
          moduleStamps,
        });

        // Then
        const argvs = await g.argvSince(mark);
        const count = (sub: string) => argvs.filter((argv) => argv[1] === sub).length;
        const kind = label[0];
        if (kind === 'a') {
          expect(result.metadata.commit).toBe(c1);
          expect(result.metadata.moduleStampCheck).toEqual({
            result: 'mismatch',
            running: 'SocketPlugin VMMaker.oscog-eem.9999',
            source: 'SocketPlugin VMMaker.oscog-eem.3700',
          });
          expect(result.caveats).toHaveLength(1);
          expect(count('fetch')).toBe(0);
        } else if (kind === 'b') {
          expect(result.metadata.commit).toBe(c1);
          expect(result.metadata.moduleStampCheck).toMatchObject({ result: 'match' });
          expect(count('rev-list')).toBe(0);
          expect(count('grep')).toBe(0);
        } else if (kind === 'c') {
          expect(result.metadata.moduleStampCheck).toMatchObject({ result: 'not_verifiable' });
          expect(count('rev-list')).toBe(0);
          expect(count('grep')).toBe(0);
          expect(count('fetch')).toBe(0);
        } else {
          expect(result.metadata.commit).toBe(newCommit);
          expect(result.metadata.moduleStampCheck).toMatchObject({ result: 'match' });
          expect(count('fetch')).toBe(1);
        }
      } finally {
        await g.cleanup();
      }
    },
    20000,
  );

  it('reports not_verifiable with a no-stamp caveat when the plugin file carries no moduleName stamp', async () => {
    // Given
    expect(moduleStamp(noStampText)).toBeUndefined();

    // When
    const result = await getVmSource(opts, {
      vmVersion: VMVERSION,
      lookupKey: 'primitiveNoStamp',
      module: 'NoStampPlugin',
      moduleStamps: { builtin: ['NoStampPlugin VMMaker.oscog-eem.3743 (i)'], loaded: [] },
    });

    // Then
    expect(result.metadata.path).toBe(NO_STAMP_PATH);
    expect(result.metadata.moduleStampCheck).toEqual({ result: 'not_verifiable' });
    expect(result.caveats).toEqual([
      'The returned source carries no moduleName stamp, so it could not be checked against the running VM.',
    ]);
  });

  it.each(['NoSuchPlugin', '../etc'])(
    'throws module_not_found for module %s before any git show of the file',
    async (module) => {
      // Given a ready mirror whose commit has no such plugin
      const mark = await h.argvMark();

      // When
      const lookup = getVmSource(opts, { vmVersion: VMVERSION, lookupKey: 'primitiveFoo', module });

      // Then
      await expect(lookup).rejects.toBeInstanceOf(VmSourceError);
      await expect(lookup).rejects.toMatchObject({ code: 'module_not_found', message: expect.stringContaining(module) });
      const argvs = await h.argvSince(mark);
      expect(argvs.some((argv) => argv[1] === 'show')).toBe(false);
      expect(argvs.some((argv) => argv[1] === 'ls-tree')).toBe(true);
    },
  );

  const STACK_VMVERSION =
    'Open Smalltalk Stack[Spur] VM [StackInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636';
  const slotFiles = {
    'src/spur64.cog/cointerp.c': coreInterp({ version: '3794', table: { 1: 'primitiveAdd', 3: 0 } }),
    [SOCKET_PLUGIN_PATH]: pluginText,
  };

  it.each([
    ['unknown plugin export name', { vmVersion: VMVERSION, lookupKey: 'noSuchExport', module: 'SocketPlugin' }, { code: 'symbol_not_found' }],
    ['string "1" is a name', { vmVersion: VMVERSION, lookupKey: '1', module: 'SocketPlugin' }, { code: 'symbol_not_found' }],
    ['number with no table slot', { vmVersion: VMVERSION, lookupKey: 2, platformSubtype: 'aarch64' }, { code: 'symbol_not_found' }],
    ['number naming an empty slot', { vmVersion: VMVERSION, lookupKey: 3, platformSubtype: 'aarch64' }, { code: 'primitive_slot_empty', fragment: '3' }],
    ['Stack VM with a module resolves as Cog', { vmVersion: STACK_VMVERSION, module: 'SocketPlugin', lookupKey: 'primitiveSocketReceiveDataAvailable' }, { path: SOCKET_PLUGIN_PATH }],
    ['Stack VM without a module', { vmVersion: STACK_VMVERSION, lookupKey: 1, platformSubtype: 'aarch64' }, { code: 'unsupported_platform', fragment: 'Stack[Spur]' }],
  ] as [string, Record<string, unknown>, { code?: string; fragment?: string; path?: string }][])(
    'distinguishes symbol_not_found, primitive_slot_empty and Stack VM handling: %s',
    async (_label, args, expected) => {
      const g = await createHarness();
      try {
        // Given a ready mirror carrying the plugin and a core table with slot 3 empty and slot 2 absent
        await g.pushUpstream(slotFiles, 'CogVM source as per VMMaker.oscog-eem.3794');
        await g.cloneMirror();
        const gOpts: VmSourceOptions = { home: g.home, upstreamUrl: g.upstreamUrl, git: g.git };

        // When
        const outcome = await getVmSource(gOpts, args).then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );

        // Then
        if (expected.path !== undefined) {
          expect(outcome).toHaveProperty('value');
          expect((outcome as { value: { metadata: { path: string } } }).value.metadata.path).toBe(expected.path);
        } else {
          const error = (outcome as { error?: unknown }).error;
          expect(error).toBeInstanceOf(VmSourceError);
          expect(error).toMatchObject({ code: expected.code });
          expect((error as VmSourceError).code).not.toBe('module_not_found');
          expect((error as VmSourceError).code).not.toBe('path_not_found');
          if (expected.fragment !== undefined) expect((error as VmSourceError).message).toContain(expected.fragment);
        }
      } finally {
        await g.cleanup();
      }
    },
    20000,
  );

  it('refuses with mirror_missing / mirror_initializing (never cloning) until the mirror is ready, before the type guards', async () => {
    const g = await createHarness({ gated: true });
    try {
      // Given an upstream carrying the shared files and an empty home
      await g.pushUpstream(files, 'CogVM source as per VMMaker.oscog-eem.3794');
      const gOpts: VmSourceOptions = { home: g.home, upstreamUrl: g.upstreamUrl, git: g.git };
      const ARGS = {
        vmVersion: VMVERSION,
        lookupKey: 'primitiveSocketReceiveDataAvailable',
        module: 'SocketPlugin',
      };
      const codeOf = async (args: Record<string, unknown>) => {
        try {
          await getVmSource(gOpts, args);
        } catch (e) {
          expect(e).toBeInstanceOf(VmSourceError);
          return e as VmSourceError;
        }
        throw new Error('expected getVmSource to reject');
      };

      // When looking up with no mirror
      const mark = await g.argvMark();
      const missing = await codeOf(ARGS);

      // Then it refuses with mirror_missing naming setup_vm_mirror, and spawns no clone
      expect(missing.code).toBe('mirror_missing');
      expect(missing.message).toContain('setup_vm_mirror');
      expect((await g.argvSince(mark)).some((argv) => argv.includes('clone'))).toBe(false);

      // When the request is ill-typed on the empty home
      const invalid = await codeOf({ ...ARGS, lookupKey: true });

      // Then the mirror check wins over the type guard
      expect(invalid.code).toBe('mirror_missing');

      // When the mirror clone is started but gated
      expect(await setupVmMirror(gOpts)).toBe('started');
      const initializing = await codeOf(ARGS);

      // Then it refuses with mirror_initializing, even for an ill-typed request
      expect(initializing.code).toBe('mirror_initializing');
      expect((await codeOf({ ...ARGS, lookupKey: true })).code).toBe('mirror_initializing');

      // When the clone completes
      await g.releaseClone();
      await waitFor(async () => (await mirrorState(gOpts)) === 'ready');
      const result = await getVmSource(gOpts, ARGS);

      // Then the lookup succeeds
      expect(result.function).toBe(indexFunctions(pluginText).get('primitiveSocketReceiveDataAvailable')!.source);

      // When an ill-typed request is made against the ready mirror
      const invalidReady = await codeOf({ ...ARGS, lookupKey: true });

      // Then the type guard reports invalid_request
      expect(invalidReady.code).toBe('invalid_request');
    } finally {
      await g.cleanup();
    }
  });

  it('reads only via read-only git subcommands at the pinned commit, is stable across fetches and services, and is the same under concurrency', async () => {
    const d = await createHarness();
    const originalCwd = process.cwd();
    try {
      // Given an upstream with the shared files, a cloned mirror and two separately constructed services
      await d.pushUpstream(files, 'CogVM source as per VMMaker.oscog-eem.3794');
      await d.cloneMirror();
      const dOpts: VmSourceOptions = { home: d.home, upstreamUrl: d.upstreamUrl, git: d.git };
      const dOpts2: VmSourceOptions = { home: d.home, upstreamUrl: d.upstreamUrl, git: d.git };
      const ARGS = {
        vmVersion: VMVERSION,
        lookupKey: 'primitiveSocketReceiveDataAvailable',
        module: 'SocketPlugin',
      };
      // and a sentinel working-tree copy of the plugin under the process cwd
      const sentinelDir = path.join(d.root, 'proj', 'opensmalltalk-vm', 'src', 'plugins', 'SocketPlugin');
      await fs.mkdir(sentinelDir, { recursive: true });
      await fs.writeFile(path.join(sentinelDir, 'SocketPlugin.c'), '/* SENTINEL_DO_NOT_READ */\n' + pluginText);
      process.chdir(path.join(d.root, 'proj'));

      // When looking up the SocketPlugin primitive (inv 7)
      const mark = await d.argvMark();
      const result = await getVmSource(dOpts, ARGS);

      // Then the response is smaller than the file, ignores the cwd copy, and git only ran read-only subcommands (show <sha>:src/...)
      const json = JSON.stringify(result);
      expect(json.length).toBeLessThan(pluginText.length);
      expect(json).not.toContain('SENTINEL_DO_NOT_READ');
      const argvs = await d.argvSince(mark);
      expect(argvs.length).toBeGreaterThan(0);
      for (const argv of argvs) {
        expect(['rev-parse', 'log', 'show', 'ls-tree', 'grep', 'rev-list']).toContain(argv[1]);
        expect(['checkout', 'worktree', 'reset', 'update-ref', 'symbolic-ref']).not.toContain(argv[1]);
        if (argv[1] === 'rev-parse') expect(argv[2]).toBe('Cog');
        if (argv[1] === 'show') expect(argv[2]).toMatch(/^[0-9a-f]{40}:src\//);
      }

      // When upstream changes the plugin body (cointerp.c still .3794), the mirror fetches it, and both services look up again (inv 14)
      const a = JSON.stringify(await getVmSource(dOpts, ARGS));
      const changedPlugin = pluginText.replace(
        '\tdataIsAvailable = sqSocketReceiveDataAvailable(s);',
        '\tdataIsAvailable = 0;',
      );
      expect(changedPlugin).not.toBe(pluginText);
      await d.pushUpstream({ [SOCKET_PLUGIN_PATH]: changedPlugin }, 'SocketPlugin body change');
      await execFileP('git', [
        '--git-dir=' + path.join(d.home, 'vm-mirror'),
        'fetch',
        '--quiet',
        'origin',
        '+refs/heads/Cog:refs/heads/Cog',
      ]);
      const b = JSON.stringify(await getVmSource(dOpts, ARGS));
      const c = JSON.stringify(await getVmSource(dOpts2, ARGS));

      // Then the answer is byte-identical
      expect(b).toBe(a);
      expect(c).toBe(a);

      // Given 8 mixed lookups alternating between the two services (inv 20)
      const lookups: Record<string, unknown>[] = [
        ARGS,
        { vmVersion: VMVERSION, lookupKey: 1, platformSubtype: 'aarch64' },
        { vmVersion: VMVERSION, lookupKey: 1, platformSubtype: 'aarch64', platformName: 'Mac OS' },
        { vmVersion: VMVERSION, lookupKey: 256, platformSubtype: 'aarch64' },
        ARGS,
        { vmVersion: VMVERSION, lookupKey: 256, platformSubtype: 'aarch64' },
        { vmVersion: VMVERSION, lookupKey: 1, platformSubtype: 'aarch64', platformName: 'Mac OS' },
        { vmVersion: VMVERSION, lookupKey: 1, platformSubtype: 'aarch64' },
      ];
      const optsFor = (i: number) => (i % 2 === 0 ? dOpts : dOpts2);
      const sequential = [];
      for (const [i, args] of lookups.entries()) sequential.push(await getVmSource(optsFor(i), args));

      // When the same 8 run concurrently
      const concurrent = await Promise.all(lookups.map((args, i) => getVmSource(optsFor(i), args)));

      // Then the results equal the sequential ones
      expect(concurrent).toEqual(sequential);
    } finally {
      process.chdir(originalCwd);
      await d.cleanup();
    }
  });
});
