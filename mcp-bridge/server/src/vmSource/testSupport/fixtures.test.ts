import { describe, expect, it } from 'vitest';
import { cFunction, coreInterp, plugin, readExcerpt } from './fixtures.js';

const exportRow = /^\s*\{\(void\*\)_m, "([^"\\]+)(?:\\\d{3})*", \(void\*\)(\w+)\}/;

describe('fixtures', () => {
  it('coreInterp emits the interpreterVersion line in upstream form', async () => {
    const line =
      'const char *interpreterVersion = "Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794]";';
    expect(coreInterp().split('\n')).toContain(line);
    expect((await readExcerpt('cointerp-spur64.c.txt')).split('\n')).toContain(line);
  });

  it('coreInterp author option replaces eem in banner and interpreterVersion line', () => {
    // Given
    const line =
      'const char *interpreterVersion = "Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-mt.3568]";';
    // When
    const text = coreInterp({ author: 'mt', version: '3568' });
    // Then
    expect(text.split('\n')).toContain(line);
    expect(text.split('VMMaker.oscog-mt.3568').length - 1).toBeGreaterThan(1);
    expect(text).not.toContain('oscog-eem');
  });

  it('cFunction emits comment, return type, name line, braces and body', () => {
    const text = cFunction({
      name: 'primitiveAdd',
      generatedFrom: 'InterpreterPrimitives>>#primitiveAdd',
      body: ['\treturn;'],
    });
    expect(text.split('\n')).toEqual([
      '\t/* InterpreterPrimitives>>#primitiveAdd */',
      'static void',
      'primitiveAdd(void)',
      '{',
      '\treturn;',
      '}',
    ]);
  });

  it('table slot 117 matches the verbatim excerpt row', async () => {
    const row = '\t/* 117 */ primitiveExternalCall,';
    expect(coreInterp({ table: { 117: 'primitiveExternalCall' } }).split('\n')).toContain(row);
    expect((await readExcerpt('cointerp-spur64.c.txt')).split('\n')).toContain(row);
  });

  it('plugin export rows share the shape of real SocketPlugin rows', async () => {
    const real = (await readExcerpt('SocketPlugin.c.txt'))
      .split('\n')
      .filter((l) => l.includes('{(void*)_m'));
    expect(real.length).toBeGreaterThan(0);
    for (const l of real) expect(l).toMatch(exportRow);

    const emitted = plugin({ module: 'SocketPlugin', exports: [{ name: 'primitiveX', fn: 'primX' }] })
      .split('\n')
      .find((l) => l.includes('{(void*)_m'))!;
    expect(emitted.match(exportRow)?.slice(1)).toEqual(['primitiveX', 'primX']);
    const shape = (l: string) => l.replace(/"[^"]*"/, '"S"').replace(/\(void\*\)\w+\}/, '(void*)F}');
    expect(shape(emitted)).toBe(shape(real.find((l) => l.includes('\\000'))!));
  });

  it('readExcerpt strips header lines', async () => {
    const text = await readExcerpt('SocketPlugin.c.txt');
    expect(text).not.toContain('// excerpt:');
    expect(text.split('\n')[0]).toBe(
      'static const char *moduleName = "SocketPlugin VMMaker.oscog-eem.3743 " INT_EXT;',
    );
  });
});
