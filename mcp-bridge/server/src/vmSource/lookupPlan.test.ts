import { describe, expect, it } from 'vitest';
import { VmSourceError } from './errors.js';
import { planLookup } from './lookupPlan.js';

describe('planLookup', () => {
  it('plans an ordinary plugin lookup at src/plugins/<M>/<M>.c with the version token and a named key', () => {
    // Given
    const args = {
      vmVersion:
        'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636',
      lookupKey: 'primitiveSocketReceiveDataAvailable',
      module: 'SocketPlugin',
    };

    // When
    const plan = planLookup(args);

    // Then
    expect(plan).toEqual({
      token: 'VMMaker.oscog-eem.3794',
      key: { kind: 'named', name: 'primitiveSocketReceiveDataAvailable' },
      module: 'SocketPlugin',
      path: 'src/plugins/SocketPlugin/SocketPlugin.c',
      defaults: [],
    });
  });

  it('treats only a JSON number lookupKey as numbered; the string "1" is a name', () => {
    // Given
    const base = {
      vmVersion:
        'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636',
      platformSubtype: 'aarch64',
    };

    // When
    const numbered = planLookup({ ...base, lookupKey: 1 });
    const named = planLookup({ ...base, lookupKey: '1' });

    // Then
    expect(numbered.key).toEqual({ kind: 'numbered', index: 1 });
    expect(named.key).toEqual({ kind: 'named', name: '1' });
  });

  it('plans the plain 64-bit Spur interpreter when module and platformName are omitted', () => {
    // Given
    const args = {
      vmVersion:
        'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636',
      lookupKey: 1,
      platformSubtype: 'aarch64',
    };

    // When
    const plan = planLookup(args);

    // Then
    expect(plan).toEqual({
      token: 'VMMaker.oscog-eem.3794',
      key: { kind: 'numbered', index: 1 },
      path: 'src/spur64.cog/cointerp.c',
      defaults: ['cog_variant', 'plain_rendering'],
      rendering: 'plain',
    });
  });

  it.each([
    ['x64', 'src/spur64.cog/cointerp.c'],
    ['aarch64', 'src/spur64.cog/cointerp.c'],
    ['intel', 'src/spur32.cog/cointerp.c'],
    ['powerpc', 'src/spur32.cog/cointerp.c'],
  ])('maps Cog[Spur] platformSubtype %s to %s when module is omitted', (platformSubtype, expectedPath) => {
    // Given
    const args = {
      vmVersion:
        'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636',
      lookupKey: 1,
      platformSubtype,
    };

    // When
    const plan = planLookup(args);

    // Then
    expect(plan.path).toBe(expectedPath);
  });

  it.each(['Mac OS', 'unix'])(
    'plans the gcc3x Spur interpreter rendering when module is omitted and platformName is %s',
    (platformName) => {
      // Given
      const args = {
        vmVersion:
          'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636',
        lookupKey: 1,
        platformName,
        platformSubtype: 'aarch64',
      };

      // When
      const plan = planLookup(args);

      // Then
      expect(plan).toEqual({
        token: 'VMMaker.oscog-eem.3794',
        key: { kind: 'numbered', index: 1 },
        path: 'src/spur64.cog/gcc3x-cointerp.c',
        defaults: ['cog_variant'],
        rendering: 'gcc3x',
      });
    },
  );

  it('plans the plain V3 interpreter at src/v3.cog without a cog_variant default when module is omitted', () => {
    // Given
    const args = {
      vmVersion: 'Open Smalltalk Cog[SqueakV3] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794]',
      lookupKey: 1,
      platformSubtype: 'intel',
    };

    // When
    const plan = planLookup(args);

    // Then
    expect(plan).toEqual({
      token: 'VMMaker.oscog-eem.3794',
      key: { kind: 'numbered', index: 1 },
      path: 'src/v3.cog/cointerp.c',
      defaults: ['plain_rendering'],
      rendering: 'plain',
    });
  });

  it('plans the gcc3x V3 interpreter rendering when module is omitted and platformName is given', () => {
    // Given
    const args = {
      vmVersion: 'Open Smalltalk Cog[SqueakV3] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794]',
      lookupKey: 1,
      platformSubtype: 'intel',
      platformName: 'unix',
    };

    // When
    const plan = planLookup(args);

    // Then
    expect(plan).toEqual({
      token: 'VMMaker.oscog-eem.3794',
      key: { kind: 'numbered', index: 1 },
      path: 'src/v3.cog/gcc3x-cointerp.c',
      defaults: [],
      rendering: 'gcc3x',
    });
  });

  it.each([
    ['Mac OS', 'aarch64', 'src/plugins/SqueakFFIPrims/ARM64AppleFFIPlugin.c'],
    ['Mac OS', 'x64', 'src/plugins/SqueakFFIPrims/X64SysVFFIPlugin.c'],
    ['unix', 'aarch64', 'src/plugins/SqueakFFIPrims/ARM64FFIPlugin.c'],
    ['unix', 'x64', 'src/plugins/SqueakFFIPrims/X64SysVFFIPlugin.c'],
  ])(
    'maps SqueakFFIPrims on platformName %s / platformSubtype %s to %s',
    (platformName, platformSubtype, expectedPath) => {
      // Given
      const args = {
        vmVersion:
          'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636',
        lookupKey: 'primitiveCalloutWithArgs',
        module: 'SqueakFFIPrims',
        platformName,
        platformSubtype,
      };

      // When
      const plan = planLookup(args);

      // Then
      expect(plan).toEqual({
        token: 'VMMaker.oscog-eem.3794',
        key: { kind: 'named', name: 'primitiveCalloutWithArgs' },
        module: 'SqueakFFIPrims',
        path: expectedPath,
        defaults: [],
      });
    },
  );

  const COG_SPUR_3794 =
    'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636';

  it.each([
    [
      'module is omitted and platformSubtype is unmapped',
      { lookupKey: 1, vmVersion: COG_SPUR_3794, platformSubtype: 'sparc' },
      'sparc',
    ],
    [
      'module is omitted and platformSubtype is unmapped on Cog[SqueakV3]',
      {
        lookupKey: 1,
        vmVersion: 'Open Smalltalk Cog[SqueakV3] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794]',
        platformSubtype: 'sparc',
      },
      'sparc',
    ],
    [
      'module is omitted and platformName is unmapped',
      { lookupKey: 1, vmVersion: COG_SPUR_3794, platformSubtype: 'aarch64', platformName: 'Win32' },
      'Win32',
    ],
    [
      'module is omitted and the VM family is unmapped',
      {
        lookupKey: 1,
        vmVersion:
          'Open Smalltalk Stack[Spur] VM [StackInterpreterPrimitives VMMaker.oscog-eem.3794]',
        platformSubtype: 'aarch64',
      },
      'Stack[Spur]',
    ],
    [
      'SqueakFFIPrims is given on an unmapped platform',
      {
        vmVersion: COG_SPUR_3794,
        lookupKey: 'primitiveCalloutWithArgs',
        module: 'SqueakFFIPrims',
        platformName: 'Win32',
        platformSubtype: 'x64',
      },
      'Win32',
    ],
  ])(
    'throws VmSourceError unsupported_platform naming the value when %s',
    (_case, args: Record<string, unknown>, fragment) => {
      // Given (args)

      // When
      let thrown: unknown;
      try {
        planLookup(args);
      } catch (error) {
        thrown = error;
      }

      // Then
      expect(thrown).toBeInstanceOf(VmSourceError);
      expect((thrown as VmSourceError).code).toBe('unsupported_platform');
      expect((thrown as VmSourceError).message).toContain(fragment);
    },
  );

  it('throws VmSourceError unsupported_platform naming Win32 when an ordinary plugin is given with platformName Win32', () => {
    // Given
    const args = {
      vmVersion: COG_SPUR_3794,
      lookupKey: 'primitiveSocketReceiveDataAvailable',
      module: 'SocketPlugin',
      platformName: 'Win32',
    };

    // When
    let thrown: unknown;
    try {
      planLookup(args);
    } catch (error) {
      thrown = error;
    }

    // Then
    expect(thrown).toBeInstanceOf(VmSourceError);
    expect((thrown as VmSourceError).code).toBe('unsupported_platform');
    expect((thrown as VmSourceError).message).toContain('Win32');
  });

  it('throws VmSourceError invalid_request saying a numbered primitive cannot have a module', () => {
    // Given
    const args = { vmVersion: COG_SPUR_3794, lookupKey: 1, module: 'SocketPlugin' };

    // When
    let thrown: unknown;
    try {
      planLookup(args);
    } catch (error) {
      thrown = error;
    }

    // Then
    expect(thrown).toBeInstanceOf(VmSourceError);
    expect((thrown as VmSourceError).code).toBe('invalid_request');
    expect((thrown as VmSourceError).message).toContain('numbered');
    expect((thrown as VmSourceError).message).toContain('module');
  });

  it('throws VmSourceError version_unparseable naming the vmVersion when the version token is unparseable', () => {
    // Given
    const vmVersion = 'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794';
    const args = { lookupKey: 1, platformSubtype: 'aarch64', vmVersion };

    // When
    let thrown: unknown;
    try {
      planLookup(args);
    } catch (error) {
      thrown = error;
    }

    // Then
    expect(thrown).toBeInstanceOf(VmSourceError);
    expect((thrown as VmSourceError).code).toBe('version_unparseable');
    expect((thrown as VmSourceError).message).toContain(vmVersion);
  });

  it('takes the whole VMMaker.oscog-<initials>.<N> name as the token for any author, and rejects a name without initials or number', () => {
    // Given
    const withAuthor = (name: string) => ({
      vmVersion: `Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives ${name}] 7.20260327.1636`,
      lookupKey: 1,
      platformSubtype: 'aarch64',
    });
    const codeOf = (args: Record<string, unknown>) => {
      try {
        planLookup(args);
      } catch (error) {
        return error instanceof VmSourceError ? error.code : error;
      }
      return undefined;
    };

    // When
    const plan = planLookup(withAuthor('VMMaker.oscog-mt.3568'));
    const noInitials = codeOf(withAuthor('VMMaker.oscog-.3568'));
    const noNumber = codeOf(withAuthor('VMMaker.oscog-eem.'));

    // Then
    expect(plan.token).toBe('VMMaker.oscog-mt.3568');
    expect(noInitials).toBe('version_unparseable');
    expect(noNumber).toBe('version_unparseable');
  });

  it('builds the plugin path from a module name that is not a plain identifier without throwing', () => {
    // Given
    const args = { vmVersion: COG_SPUR_3794, lookupKey: 'x', module: '../etc' };

    // When
    const plan = planLookup(args);

    // Then
    expect(plan.module).toBe('../etc');
    expect(plan.path).toBe('src/plugins/../etc/../etc.c');
  });

  it.each([
    ['module is omitted and platformSubtype is omitted', { vmVersion: COG_SPUR_3794, lookupKey: 1 }, 'platformSubtype'],
    [
      'module is omitted and platformSubtype is omitted on Cog[SqueakV3]',
      {
        vmVersion: 'Open Smalltalk Cog[SqueakV3] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794]',
        lookupKey: 1,
      },
      'platformSubtype',
    ],
    [
      'SqueakFFIPrims is given without platformName',
      {
        vmVersion: COG_SPUR_3794,
        lookupKey: 'primitiveCalloutWithArgs',
        module: 'SqueakFFIPrims',
        platformSubtype: 'aarch64',
      },
      'platformName',
    ],
    [
      'SqueakFFIPrims is given without platformSubtype',
      {
        vmVersion: COG_SPUR_3794,
        lookupKey: 'primitiveCalloutWithArgs',
        module: 'SqueakFFIPrims',
        platformName: 'Mac OS',
      },
      'platformSubtype',
    ],
  ])(
    'throws VmSourceError missing_platform_info naming the missing parameter when %s',
    (_case, args: Record<string, unknown>, missing) => {
      // Given (args)

      // When
      let thrown: unknown;
      try {
        planLookup(args);
      } catch (error) {
        thrown = error;
      }

      // Then
      expect(thrown).toBeInstanceOf(VmSourceError);
      expect((thrown as VmSourceError).code).toBe('missing_platform_info');
      expect((thrown as VmSourceError).message).toContain(missing);
    },
  );

  it.each([
    ['lookupKey is true', 'lookupKey', { lookupKey: true }],
    ['lookupKey is null', 'lookupKey', { lookupKey: null }],
    ['lookupKey is an object', 'lookupKey', { lookupKey: {} }],
    ['lookupKey is omitted', 'lookupKey', { lookupKey: undefined }],
    ['vmVersion is a number', 'vmVersion', { vmVersion: 3794 }],
    ['vmVersion is omitted', 'vmVersion', { vmVersion: undefined }],
    ['module is a number', 'module', { module: 42 }],
    ['platformName is a number', 'platformName', { platformName: 1 }],
    ['platformSubtype is a boolean', 'platformSubtype', { platformSubtype: false }],
    ['moduleStamps is a string', 'moduleStamps', { moduleStamps: 'x' }],
    ['moduleStamps is null', 'moduleStamps', { moduleStamps: null }],
    ['moduleStamps is an array', 'moduleStamps', { moduleStamps: ['SocketPlugin VMMaker.oscog-eem.3743 (i)'] }],
    [
      'moduleStamps.builtin is a string',
      'moduleStamps.builtin',
      { moduleStamps: { builtin: 'SocketPlugin VMMaker.oscog-eem.3743 (i)' } },
    ],
    ['moduleStamps.builtin holds a number', 'moduleStamps.builtin', { moduleStamps: { builtin: [42] } }],
    ['moduleStamps.loaded is null', 'moduleStamps.loaded', { moduleStamps: { loaded: null } }],
    [
      'moduleStamps.loaded is omitted',
      'moduleStamps.loaded',
      { moduleStamps: { builtin: ['SocketPlugin VMMaker.oscog-eem.3743 (i)'] } },
    ],
    ['moduleStamps.builtin is omitted', 'moduleStamps.builtin', { moduleStamps: { loaded: [] } }],
  ])(
    'throws VmSourceError invalid_request naming the field when %s',
    (_case, field, override: Record<string, unknown>) => {
      // Given
      const args: Record<string, unknown> = {
        vmVersion: COG_SPUR_3794,
        lookupKey: 'primitiveSocketReceiveDataAvailable',
        module: 'SocketPlugin',
        ...override,
      };
      for (const [name, value] of Object.entries(override)) {
        if (value === undefined) delete args[name];
      }

      // When
      let thrown: unknown;
      try {
        planLookup(args);
      } catch (error) {
        thrown = error;
      }

      // Then
      expect(thrown).toBeInstanceOf(VmSourceError);
      expect((thrown as VmSourceError).code).toBe('invalid_request');
      expect((thrown as VmSourceError).message).toContain(field);
    },
  );

  const STACK_SPUR_3794 = 'Open Smalltalk Stack[Spur] VM [StackInterpreterPrimitives VMMaker.oscog-eem.3794]';
  const COG_SPUR_NO_BRACKET = 'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794';

  it.each([
    [
      'an unmapped VM family comes without platformSubtype',
      { lookupKey: 1, vmVersion: STACK_SPUR_3794 },
      'missing_platform_info',
      'platformSubtype',
    ],
    [
      'an unmapped VM family comes with platformName Win32',
      { lookupKey: 1, vmVersion: STACK_SPUR_3794, platformSubtype: 'aarch64', platformName: 'Win32' },
      'unsupported_platform',
      'Win32',
    ],
    [
      'an unmapped platformSubtype comes with platformName Win32',
      { lookupKey: 1, vmVersion: COG_SPUR_3794, platformSubtype: 'sparc', platformName: 'Win32' },
      'unsupported_platform',
      'Win32',
    ],
    [
      'an unparseable vmVersion comes without platformSubtype',
      { lookupKey: 1, vmVersion: COG_SPUR_NO_BRACKET },
      'version_unparseable',
      COG_SPUR_NO_BRACKET,
    ],
  ])(
    'reports the earlier fault in invariant 3.2 order when %s',
    (_case, args: Record<string, unknown>, code, fragment) => {
      // Given (args)

      // When
      let thrown: unknown;
      try {
        planLookup(args);
      } catch (error) {
        thrown = error;
      }

      // Then
      expect(thrown).toBeInstanceOf(VmSourceError);
      expect((thrown as VmSourceError).code).toBe(code);
      expect((thrown as VmSourceError).message).toContain(fragment);
    },
  );
});
