import { describe, expect, it } from 'vitest';
import { externalCalls, findExport, findTableSlot, helpers, indexFunctions, moduleStamp } from './cSource.js';
import { VmSourceError } from './errors.js';
import { cFunction, coreInterp, plugin, readExcerpt } from './testSupport/fixtures.js';

describe('indexFunctions', () => {
  it('indexes a function from its generatedFrom comment line to its closing brace, capturing generatedFrom', () => {
    // Given
    const text = coreInterp({
      functions: [
        {
          name: 'primitiveAdd',
          generatedFrom: 'InterpreterPrimitives>>#primitiveAdd',
          body: [
            '    sqInt rcvr;',
            '',
            '\trcvr = longAt(GIV(stackPointer) + (1 * BytesPerOop));',
          ],
        },
      ],
    });
    const lines = text.split('\n');
    const commentIndex = lines.indexOf('\t/* InterpreterPrimitives>>#primitiveAdd */');
    const closeIndex = lines.indexOf('}', commentIndex);
    const expectedSource = lines.slice(commentIndex, closeIndex + 1).join('\n');
    expect(expectedSource).toBe(
      cFunction({
        name: 'primitiveAdd',
        generatedFrom: 'InterpreterPrimitives>>#primitiveAdd',
        body: ['    sqInt rcvr;', '', '\trcvr = longAt(GIV(stackPointer) + (1 * BytesPerOop));'],
      }),
    );

    // When
    const index = indexFunctions(text);

    // Then
    expect(index.get('primitiveAdd')).toEqual({
      start: commentIndex + 1,
      end: closeIndex + 1,
      source: expectedSource,
      generatedFrom: 'InterpreterPrimitives>>#primitiveAdd',
    });
  });

  it('starts an uncommented function at its return-type line and omits generatedFrom', () => {
    // Given
    const built = coreInterp({
      functions: [
        { name: 'helperNoComment', returnType: 'static sqInt', body: ['\treturn 0;'] },
        {
          name: 'primitiveAdd',
          generatedFrom: 'InterpreterPrimitives>>#primitiveAdd',
          body: ['    sqInt rcvr;'],
        },
      ],
    });
    // cointerp.c:25867 brace form, which cFunction does not emit
    const text = built.replace('helperNoComment(void)\n{\n', 'helperNoComment(void)\n{   DECL_MAYBE_SQ_GLOBAL_STRUCT\n');
    expect(text).not.toBe(built);
    const lines = text.split('\n');
    const helperStartIndex = lines.indexOf('helperNoComment(void)') - 1;
    expect(lines[helperStartIndex]).toBe('static sqInt');
    const helperCloseIndex = lines.indexOf('}', helperStartIndex);
    const commentIndex = lines.indexOf('\t/* InterpreterPrimitives>>#primitiveAdd */');
    const addCloseIndex = lines.indexOf('}', commentIndex);

    // When
    const index = indexFunctions(text);

    // Then
    const helper = index.get('helperNoComment');
    expect(helper).toEqual({
      start: helperStartIndex + 1,
      end: helperCloseIndex + 1,
      source: lines.slice(helperStartIndex, helperCloseIndex + 1).join('\n'),
    });
    expect(helper !== undefined && 'generatedFrom' in helper).toBe(false);
    expect(index.get('primitiveAdd')).toEqual({
      start: commentIndex + 1,
      end: addCloseIndex + 1,
      source: lines.slice(commentIndex, addCloseIndex + 1).join('\n'),
      generatedFrom: 'InterpreterPrimitives>>#primitiveAdd',
    });
  });

  it('indexes functions in verbatim upstream excerpts (drift check)', async () => {
    // Given
    const core = await readExcerpt('cointerp-spur64.c.txt');
    const coreLines = core.split('\n');
    const addCommentIndex = coreLines.indexOf('\t/* InterpreterPrimitives>>#primitiveAdd */');
    const addCloseIndex = coreLines.indexOf('}', addCommentIndex);
    const socket = await readExcerpt('SocketPlugin.c.txt');
    const socketLines = socket.split('\n');
    const recvCommentIndex = socketLines.indexOf('\t/* SocketPlugin>>#primitiveSocketReceiveDataAvailable: */');
    const recvCloseIndex = socketLines.indexOf('}', recvCommentIndex);
    expect(addCommentIndex).toBeGreaterThanOrEqual(0);
    expect(recvCommentIndex).toBeGreaterThanOrEqual(0);

    // When
    const add = indexFunctions(core).get('primitiveAdd');
    const recv = indexFunctions(socket).get('primitiveSocketReceiveDataAvailable');

    // Then
    expect(add).toEqual({
      start: addCommentIndex + 1,
      end: addCloseIndex + 1,
      source: coreLines.slice(addCommentIndex, addCloseIndex + 1).join('\n'),
      generatedFrom: 'InterpreterPrimitives>>#primitiveAdd',
    });
    expect(add?.source.split('\n')[0]).toBe('\t/* InterpreterPrimitives>>#primitiveAdd */');
    expect(add?.source.split('\n').at(-1)).toBe('}');
    expect(add?.source).toContain('primitiveAdd(void)');
    expect(recv).toEqual({
      start: recvCommentIndex + 1,
      end: recvCloseIndex + 1,
      source: socketLines.slice(recvCommentIndex, recvCloseIndex + 1).join('\n'),
      generatedFrom: 'SocketPlugin>>#primitiveSocketReceiveDataAvailable:',
    });
    expect(recv?.source.split('\n').at(-1)).toBe('}');
  });
});

describe('findExport', () => {
  it('returns the exported function and its trimmed exports row, also on verbatim excerpts (drift check)', async () => {
    // Given
    const text = plugin({
      module: 'SocketPlugin',
      exports: [{ name: 'primitiveSocketReceiveDataAvailable' }, { name: 'primitiveSocketAccept' }],
      functions: [],
    });
    const rowFor = (t: string, name: string): string | undefined =>
      t
        .split('\n')
        .find((l) => l.includes(`"${name}\\`) || l.includes(`"${name}"`))
        ?.trim();
    const acceptRow = rowFor(text, 'primitiveSocketAccept');
    expect(acceptRow).toBe('{(void*)_m, "primitiveSocketAccept\\000\\377\\000", (void*)primitiveSocketAccept},');
    const socket = await readExcerpt('SocketPlugin.c.txt');
    const disableRow = rowFor(socket, 'primitiveDisableSocketAccess');
    expect(disableRow).toBe(
      '{(void*)_m, "primitiveDisableSocketAccess\\000\\377\\000", (void*)primitiveDisableSocketAccess},',
    );
    const core = await readExcerpt('cointerp-spur64.c.txt');

    // When
    const accept = findExport(text, 'primitiveSocketAccept');
    const disable = findExport(socket, 'primitiveDisableSocketAccess');
    const addLarge = findExport(core, 'primitiveAddLargeIntegers');

    // Then
    expect(accept).toEqual({ fn: 'primitiveSocketAccept', row: acceptRow });
    expect(disable).toEqual({ fn: 'primitiveDisableSocketAccess', row: disableRow });
    expect(addLarge.fn).toBe('primitiveAddLargeIntegers');
  });

  it('throws symbol_not_found when no exports row matches the name exactly', () => {
    // Given
    const text = plugin({
      module: 'SocketPlugin',
      exports: [{ name: 'primitiveSocketAcceptFrom' }],
      functions: [],
    });
    const errorFor = (name: string): unknown => {
      try {
        findExport(text, name);
      } catch (e) {
        return e;
      }
      return undefined;
    };

    // When
    const prefixError = errorFor('primitiveSocketAccept');
    const missingError = errorFor('noSuchPrimitive');

    // Then
    expect(prefixError).toBeInstanceOf(VmSourceError);
    expect((prefixError as VmSourceError).code).toBe('symbol_not_found');
    expect((prefixError as VmSourceError).message).toContain('primitiveSocketAccept');
    expect(missingError).toBeInstanceOf(VmSourceError);
    expect((missingError as VmSourceError).code).toBe('symbol_not_found');
    expect((missingError as VmSourceError).message).toContain('noSuchPrimitive');
  });
});

describe('findTableSlot', () => {
  it('returns the identifier in a primitiveTable slot and its trimmed row, ignoring look-alike rows outside the table, also on verbatim excerpts (drift check)', async () => {
    // Given
    const text = coreInterp({
      table: { 1: 'primitiveAdd', 2: 'primitiveSubtract' },
      extra: ['\t/* 2 */ notTheTableEntry,'],
    });
    const lines = text.split('\n');
    const tableOpen = lines.findIndex((l) => l.includes('primitiveTable['));
    const tableClose = lines.indexOf(' 0 };', tableOpen);
    const decoyIndex = lines.indexOf('\t/* 2 */ notTheTableEntry,');
    expect(lines.indexOf('\t/* 2 */ primitiveSubtract,')).toBeGreaterThan(tableOpen);
    expect(decoyIndex).toBeGreaterThan(tableClose);
    const core = await readExcerpt('cointerp-spur64.c.txt');
    expect(core.split('\n')).toContain('\t/* 1 */ primitiveAdd,');

    // When
    const subtract = findTableSlot(text, 2);
    const add = findTableSlot(core, 1);

    // Then
    expect(subtract).toEqual({ fn: 'primitiveSubtract', row: '/* 2 */ primitiveSubtract,' });
    expect('shared' in subtract).toBe(false);
    expect(add).toEqual({ fn: 'primitiveAdd', row: '/* 1 */ primitiveAdd,' });
  });

  it('throws symbol_not_found for a missing row and primitive_slot_empty for an empty slot, also on verbatim excerpts (drift check)', async () => {
    // Given
    const text = coreInterp({ table: { 1: 'primitiveAdd', 3: 0 } });
    expect(text.split('\n')).toContain('\t/* 3 */ (void (*)(void))0,');
    const core = await readExcerpt('cointerp-spur64.c.txt');
    expect(core.split('\n')).toContain('\t/* 255 */ (void (*)(void))0,');
    const errorFor = (t: string, n: number): unknown => {
      try {
        findTableSlot(t, n);
      } catch (e) {
        return e;
      }
      return undefined;
    };

    // When
    const missingError = errorFor(text, 2);
    const emptyError = errorFor(text, 3);
    const upstreamEmptyError = errorFor(core, 255);

    // Then
    expect.soft(missingError instanceof VmSourceError).toBe(true);
    expect.soft((missingError as VmSourceError).code).toBe('symbol_not_found');
    expect.soft((missingError as Error).message).toMatch(/\b2\b/);
    expect.soft(emptyError instanceof VmSourceError).toBe(true);
    expect.soft((emptyError as VmSourceError).code).toBe('primitive_slot_empty');
    expect.soft((emptyError as Error).message).toMatch(/\b3\b/);
    expect.soft((emptyError as Error).message).toMatch(/fallback/);
    expect.soft(upstreamEmptyError instanceof VmSourceError).toBe(true);
    expect.soft((upstreamEmptyError as VmSourceError).code).toBe('primitive_slot_empty');
    expect.soft((upstreamEmptyError as Error).message).toMatch(/\b255\b/);
    expect.soft((upstreamEmptyError as Error).message).toMatch(/fallback/);
  });

  it('marks slot 117 (primitiveExternalCall) as shared external_call, also on verbatim excerpts (drift check)', async () => {
    // Given
    const text = coreInterp({ table: { 117: 'primitiveExternalCall' } });
    const core = await readExcerpt('cointerp-spur64.c.txt');
    expect(core.split('\n')).toContain('\t/* 117 */ primitiveExternalCall,');
    const shared = {
      reason: 'external_call',
      applies:
        "the named primitive in the method's first literal (module and function name), looked up and called at run time",
    };

    // When
    const slot = findTableSlot(text, 117);
    const upstream = findTableSlot(core, 117);

    // Then
    expect(slot).toEqual({ fn: 'primitiveExternalCall', row: '/* 117 */ primitiveExternalCall,', shared });
    expect(upstream).toEqual({ fn: 'primitiveExternalCall', row: '/* 117 */ primitiveExternalCall,', shared });
  });

  it.each([
    [256, 'quick primitive 256: return self'],
    [257, 'quick primitive 257: return true'],
    [258, 'quick primitive 258: return false'],
    [259, 'quick primitive 259: return nil'],
    [260, 'quick primitive 260: return SmallInteger -1'],
    [261, 'quick primitive 261: return SmallInteger 0'],
    [263, 'quick primitive 263: return SmallInteger 2'],
    [264, 'quick primitive 264: return instance variable 0'],
    [300, 'quick primitive 300: return instance variable 36'],
    [519, 'quick primitive 519: return instance variable 255'],
  ])(
    'maps quick slot %i to externalQuickPrimitiveResponse marked shared quick_primitive (drift check on 256/257)',
    async (k, applies) => {
      // Given
      const quick = [256, 257, 258, 259, 260, 261, 263, 264, 300, 519];
      const text = coreInterp({ table: Object.fromEntries(quick.map((n) => [n, n])) });
      const row = `/* ${k} */ (void (*)(void))${k},`;
      expect(text.split('\n')).toContain(`\t${row}`);
      const core = await readExcerpt('cointerp-spur64.c.txt');
      const drift = k === 256 || k === 257;
      if (drift) expect(core.split('\n')).toContain(`\t${row}`);
      const expected = { fn: 'externalQuickPrimitiveResponse', row, shared: { reason: 'quick_primitive', applies } };

      // When
      const slot = findTableSlot(text, k);
      const upstream = drift ? findTableSlot(core, k) : undefined;

      // Then
      expect(slot).toEqual(expected);
      if (drift) expect(upstream).toEqual(expected);
    },
  );
});

describe('helpers', () => {
  it('returns indexed callees in first-appearance order, ignoring comments, literals, # lines, self-calls and non-indexed names, with no cap', () => {
    // Given
    const pad = (n: number): string => String(n).padStart(2, '0');
    const helperNames = Array.from({ length: 25 }, (_, i) => `helper${pad(i + 1)}`);
    const laterHelpers = helperNames.slice(3); // helper04 … helper25
    const text = coreInterp({
      functions: [
        ...helperNames.map((name) => ({
          name,
          returnType: 'static sqInt',
          args: 'sqInt x',
          body: ['\treturn x + 1;'],
        })),
        {
          name: 'primitiveFoo',
          generatedFrom: 'InterpreterPrimitives>>#primitiveFoo',
          body: [
            '    sqInt result;',
            '    char c;',
            '',
            '\t/* helper02(x) in a comment */',
            '\tresult = helper03(GIV(stackPointer));',
            '\tresult = helper01(result);',
            '\tmemcpy(firstIndexableField(result), GIV(stackPointer), BytesPerOop);',
            '\tprintf("helper02(%d)", 1);',
            "\tc = '(';",
            '#  if defined(helper02)',
            '\tresult = helper03(result);',
            '#  endif',
            '\tresult = helper03(result);',
            '\tif (result == 0) {',
            '\t\tprimitiveFoo();',
            '\t}',
            ...laterHelpers.map((h) => `\tresult = ${h}(result);`),
            '\tGIV(stackPointer) = result;',
          ],
        },
      ],
    });
    const index = indexFunctions(text);
    const expectedNames = ['helper03', 'helper01', ...laterHelpers];
    expect(expectedNames).toHaveLength(24);
    const expected = expectedNames.map((name) => ({ name, source: index.get(name)!.source }));

    // When
    const result = helpers('primitiveFoo', index);

    // Then
    expect(result).toEqual(expected);
  });
});

describe('externalCalls', () => {
  it('classifies non-indexed callees as vm_interface or platform_code_unavailable, in first-appearance order, once each', () => {
    // Given
    const built = plugin({
      module: 'SocketPlugin',
      proxyPointers: ['stackValue', 'primitiveFailed'],
      functions: [
        { name: 'socketValueOf', returnType: 'static SocketPtr', args: 'sqInt socketOop', body: ['\treturn 0;'] },
        {
          name: 'primitiveSocketFoo',
          generatedFrom: 'SocketPlugin>>#primitiveSocketFoo:',
          body: [
            '    sqInt socket;',
            '    SocketPtr s;',
            '    sqInt dataIsAvailable;',
            '',
            '\tsocket = stackValue(0);',
            '\ts = socketValueOf(socket);',
            '\tdataIsAvailable = sqSocketReceiveDataAvailable(s);',
            '\tinterpreterProxy->methodReturnBool(dataIsAvailable);',
            '\tfirstIndexableField(socket);',
            '\tprimitiveFailed();',
            '\tdataIsAvailable = sqSocketReceiveDataAvailable(s);',
            '\tprimitiveSocketFoo();',
          ],
        },
      ],
    });
    // SocketPlugin.c pointer declarations may return non-sqInt types
    const elseLine = '#else /* !defined(SQUEAK_BUILTIN_PLUGIN) */';
    const text = built.replace(elseLine, `static void * (*firstIndexableField)(sqInt oop);\n${elseLine}`);
    expect(text).not.toBe(built);
    const index = indexFunctions(text);

    // When
    const result = externalCalls('primitiveSocketFoo', index, text);

    // Then
    expect(result).toEqual([
      { name: 'stackValue', kind: 'vm_interface' },
      { name: 'sqSocketReceiveDataAvailable', kind: 'platform_code_unavailable' },
      { name: 'methodReturnBool', kind: 'vm_interface' },
      { name: 'firstIndexableField', kind: 'vm_interface' },
      { name: 'primitiveFailed', kind: 'vm_interface' },
    ]);
  });

  it('skips function-pointer return types and case labels but keeps calls with a dereferenced argument, on verbatim lines (drift check)', async () => {
    // Given
    const castLine = '\t(sigHandlerAction.sa_handler = ((void (*)(int)) signalHandlerAddress));';
    const caseLine = '\tcase (firstLongFormat()) + 1:';
    const excerpt = await readExcerpt('call-shapes.c.txt');
    expect(excerpt).toContain(castLine);
    expect(excerpt).toContain(caseLine);
    const text = coreInterp({
      functions: [
        {
          name: 'primitiveShapes',
          body: [
            castLine,
            '\tresult = ((sqInt (*)(sqInt)) fn)(x);',
            '\tswitch (fmt) {',
            caseLine,
            '\t\tfree(*p);',
            '\t}',
          ],
        },
      ],
    });
    const index = indexFunctions(text);

    // When
    const result = externalCalls('primitiveShapes', index, text);

    // Then
    expect(result).toEqual([
      { name: 'firstLongFormat', kind: 'platform_code_unavailable' },
      { name: 'free', kind: 'platform_code_unavailable' },
    ]);
  });

  it('excludes C keywords, ALL_CAPS names and function-like #defines in all upstream spellings', () => {
    // Given
    const text = coreInterp({
      defines: ['# define longAt(oop) (*(sqInt *)(oop))', '#\tdefine fooxstr(s) #s', '#define bar(x) ((x)+1)'],
      functions: [
        {
          name: 'primitiveBaz',
          body: [
            '\tif (x) {',
            '\t\twhile (y) {',
            '\t\t\tfor (i = 0; i < n; i++) {',
            '\t\t\t\tswitch (k) {',
            '\t\t\t\t}',
            '\t\t\t}',
            '\t\t}',
            '\t}',
            '\treturn (r);',
            '\tz = sizeof(sqInt);',
            '\tz = longAt(p);',
            '\tz = fooxstr(a);',
            '\tz = bar(b);',
            '\tCHECK_IT(c);',
            '\tmemcpy(d, e, f);',
            '\tprimitiveFailFor(PrimErrBadArgument);',
          ],
        },
      ],
    });

    // When
    const result = externalCalls('primitiveBaz', indexFunctions(text), text);

    // Then
    expect(result).toEqual([
      { name: 'memcpy', kind: 'platform_code_unavailable' },
      { name: 'primitiveFailFor', kind: 'platform_code_unavailable' },
    ]);
  });
});

describe('moduleStamp', () => {
  it('reads the trimmed moduleName stamp from plugin files, undefined for the core, also on verbatim excerpts (drift check)', async () => {
    // Given
    const socket = plugin({ module: 'SocketPlugin', functions: [] });
    expect(socket).toContain('static const char *moduleName = "SocketPlugin VMMaker.oscog-eem.3743 " INT_EXT;');
    const ffi = plugin({ module: 'SqueakFFIPrims', stampName: 'ARM64AppleFFIPlugin', stampVersion: '3792', functions: [] });
    const excerpt = await readExcerpt('SocketPlugin.c.txt');
    const core = coreInterp();

    // When
    const socketStamp = moduleStamp(socket);
    const ffiStamp = moduleStamp(ffi);
    const excerptStamp = moduleStamp(excerpt);
    const coreStamp = moduleStamp(core);

    // Then
    expect(socketStamp).toBe('SocketPlugin VMMaker.oscog-eem.3743');
    expect(ffiStamp).toBe('ARM64AppleFFIPlugin VMMaker.oscog-eem.3792');
    expect(excerptStamp).toBe('SocketPlugin VMMaker.oscog-eem.3743');
    expect(coreStamp).toBeUndefined();
  });

  it('reads the builtin branch of the older #ifdef-split stamp without its (i) suffix, on a verbatim excerpt (drift check)', async () => {
    // Given
    const ft2 = await readExcerpt('FT2Plugin.c.txt');
    expect(ft2).toContain('\t"FT2Plugin Freetype-Plugin-EstebanLorenzano.70 (i)"');

    // When
    const stamp = moduleStamp(ft2);

    // Then
    expect(stamp).toBe('FT2Plugin Freetype-Plugin-EstebanLorenzano.70');
  });
});
