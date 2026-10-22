import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { createVmSourceTools } from './tools.js';
import { getVmSource } from './getVmSource.js';
import { coreInterp, plugin } from './testSupport/fixtures.js';
import { createHarness, waitFor, type Harness } from './testSupport/harness.js';

let h: Harness | undefined;

afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('createVmSourceTools', () => {
  it('returns setup_vm_mirror (no parameters) followed by get_vm_source', () => {
    // Given no mirror options (defaults; the handler is not invoked)

    // When creating the VM source tools
    const tools = createVmSourceTools();

    // Then it returns setup_vm_mirror then get_vm_source, setup_vm_mirror with an empty object input schema
    expect(tools.map((t) => t.name)).toEqual(['setup_vm_mirror', 'get_vm_source']);
    expect(tools[0].inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('get_vm_source declares its input schema with vmVersion and lookupKey required and no path-like input', () => {
    // Given no mirror options (defaults; the handler is not invoked)

    // When creating the VM source tools and picking get_vm_source
    const tool = createVmSourceTools().find((t) => t.name === 'get_vm_source')!;
    const schema = tool.inputSchema as {
      type: string;
      properties: Record<string, { type: unknown }>;
      required: string[];
    };

    // Then the schema exposes exactly the documented inputs with the documented types
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['lookupKey', 'moduleStamps', 'module', 'platformName', 'platformSubtype', 'vmVersion'].sort(),
    );
    expect(schema.required).toEqual(['vmVersion', 'lookupKey']);
    expect(schema.properties.lookupKey.type).toEqual(['string', 'number']);
    expect(schema.properties.vmVersion.type).toBe('string');
    expect(schema.properties.moduleStamps.type).toBe('object');
    expect(Object.keys(schema.properties).filter((k) => /path|file/i.test(k))).toEqual([]);
  });

  it('get_vm_source description covers exact inputs, call order, platform table, mirror_missing and caveats', () => {
    // Given no mirror options (defaults; the handler is not invoked)

    // When creating the VM source tools and reading get_vm_source's description
    const d = createVmSourceTools().find((t) => t.name === 'get_vm_source')!.description;

    // Then it tells the assistant to pass inputs exactly as returned
    expect(d).toContain('exactly as');
    // And gives the call order get_method_source -> get_vm_version -> get_vm_source, naming the platform/module tools
    const order = ['get_method_source', 'get_vm_version', 'get_vm_source'].map((n) => d.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const n of ['get_platform_name', 'get_platform_subtype', 'get_loaded_modules']) expect(d).toContain(n);
    // And gives the platform-parameter table
    for (const n of ['SqueakFFIPrims', 'platformName', 'platformSubtype']) expect(d).toContain(n);
    // And explains mirror_missing recovery
    expect(d).toContain('mirror_missing');
    expect(d).toContain('setup_vm_mirror');
    // And instructs to state caveats and never present a defaulted source as exact
    expect(d).toMatch(/state (every|each|all) caveat/i);
    expect(d).toMatch(/never present/i);
  });

  it('get_vm_source description opens by saying when to use it: a method with a primitive pragma', () => {
    // Given no mirror options (defaults; the handler is not invoked)

    // When creating the VM source tools and reading get_vm_source's description
    const d = createVmSourceTools().find((t) => t.name === 'get_vm_source')!.description;

    // Then its first sentence names the trigger: a primitive pragma in get_method_source's result
    const first = d.split('. ')[0];
    expect(first).toMatch(/get_method_source/);
    expect(first).toContain('<primitive: N>');
    expect(first).toContain("<primitive: 'name' module: 'Module'>");
    // And says a method without a primitive pragma has no VM source
    expect(first).toMatch(/without a primitive pragma[^.]*no VM source/i);
  });

  it('get_vm_source description tells the assistant to tell the user about upstream fetches and mirror_busy', () => {
    // Given no mirror options (defaults; the handler is not invoked)

    // When creating the VM source tools and reading get_vm_source's description
    const d = createVmSourceTools().find((t) => t.name === 'get_vm_source')!.description;

    // Then it instructs the assistant to tell the user when a lookup may be fetching from upstream
    expect(d).toMatch(/fetch[^.]*tell the user|tell the user[^.]*fetch/i);
    // And explains mirror_busy as another session fetching, to be relayed to the user
    expect(d).toContain('mirror_busy');
    expect(d).toMatch(/another session is fetching/i);
  });

  it('setup_vm_mirror description covers failed background clone codes, next-call reporting and git_unavailable', () => {
    // Given no mirror options (defaults; the handler is not invoked)

    // When creating the VM source tools and reading setup_vm_mirror's description
    const d = createVmSourceTools().find((t) => t.name === 'setup_vm_mirror')!.description;

    // Then it names the failure codes of a failed background clone
    expect(d).toContain('fetch_failed');
    expect(d).toContain('mirror_write_failed');
    // And says the next call reports the failed clone
    expect(d).toMatch(/the next call reports it/i);
    // And says the tool needs git
    expect(d).toContain('git_unavailable');
  });

  it('get_vm_source description explains mirror_corrupt, fetch_failed and internal_error without deleting the mirror', () => {
    // Given no mirror options (defaults; the handler is not invoked)

    // When creating the VM source tools and reading get_vm_source's description
    const d = createVmSourceTools().find((t) => t.name === 'get_vm_source')!.description;

    // Then mirror_corrupt tells the user to delete the mirror and run setup_vm_mirror
    expect(d).toContain('mirror_corrupt');
    expect(d).toMatch(/mirror_corrupt[^.]*delete[^.]*setup_vm_mirror/i);
    // And fetch_failed is explained
    expect(d).toContain('fetch_failed');
    // And internal_error must not lead to deleting the mirror
    expect(d).toContain('internal_error');
    expect(d).toMatch(/internal_error[^.]*(do not|never|must not)[^.]*delet/i);
  });

  it('setup_vm_mirror handler returns the setup status as JSON text', async () => {
    // Given a gated harness with no mirror yet
    h = await createHarness({ gated: true });
    const [tool] = createVmSourceTools({ home: h.home, upstreamUrl: h.upstreamUrl, git: h.git });

    // When invoking the handler
    const result = await tool.handler({});

    // Then it reports the started status as JSON text, with no error flag
    expect(result).toEqual({ content: [{ type: 'text', text: '{"status":"started"}' }] });
  });

  it('setup_vm_mirror handler turns a thrown fs error into an MCP error result', async () => {
    // Given a home path nested under a regular file, so creating it fails with ENOTDIR
    h = await createHarness();
    await fs.writeFile(path.join(h.root, 'blocker'), '');
    const [tool] = createVmSourceTools({
      home: path.join(h.root, 'blocker', 'home'),
      upstreamUrl: h.upstreamUrl,
      git: h.git,
    });

    // When invoking the handler
    const result = await tool.handler({});

    // Then it resolves to an error result whose text carries the ENOTDIR message
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toMatch(/ENOTDIR/);
  });

  it('defaults the mirror home to ~/.cuis-mcp-bridge, independent of cwd', async () => {
    // Given a gated harness and HOME pointing at its temp root
    h = await createHarness({ gated: true });
    const originalHome = process.env.HOME;
    process.env.HOME = h.root;
    try {
      const [tool] = createVmSourceTools({ upstreamUrl: h.upstreamUrl, git: h.git });

      // When invoking the handler without a home override
      const result = await tool.handler({});

      // Then the clone targets <HOME>/.cuis-mcp-bridge
      expect(result).toEqual({ content: [{ type: 'text', text: '{"status":"started"}' }] });
      await waitFor(async () => (await h!.argvLog()).some((a) => a[0] === 'clone'));
      const argv = (await h.argvLog()).find((a) => a[0] === 'clone')!;
      expect(argv.at(-1)).toBe(path.join(h.root, '.cuis-mcp-bridge', 'vm-mirror.tmp-' + process.pid));
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it('get_vm_source handler returns the getVmSource result as JSON text', async () => {
    // Given a mirror with one commit holding cointerp.c 3794 and a SocketPlugin exporting the primitive
    h = await createHarness();
    await h.pushUpstream(
      {
        'src/spur64.cog/cointerp.c': coreInterp({ version: '3794' }),
        'src/plugins/SocketPlugin/SocketPlugin.c': plugin({
          module: 'SocketPlugin',
          functions: [
            {
              name: 'primitiveSocketReceiveDataAvailable',
              generatedFrom: 'SocketPlugin>>#primitiveSocketReceiveDataAvailable:',
              body: ['\tsqInt dataIsAvailable;', '', '\treturn interpreterProxy->methodReturnBool(dataIsAvailable);'],
            },
          ],
          exports: [{ name: 'primitiveSocketReceiveDataAvailable' }],
        }),
      },
      'VMMaker.oscog-eem.3794',
    );
    await h.cloneMirror();
    const tool = createVmSourceTools({ home: h.home, upstreamUrl: h.upstreamUrl, git: h.git }).find(
      (t) => t.name === 'get_vm_source',
    )!;
    const args = {
      vmVersion: 'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636',
      lookupKey: 'primitiveSocketReceiveDataAvailable',
      module: 'SocketPlugin',
    };

    // When invoking the handler
    const result = await tool.handler(args);

    // Then it returns the same result getVmSource produces, as one JSON text item, with no error flag
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    const expected = await getVmSource(
      { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git },
      args,
    );
    expect(parsed).toEqual(expected);
    expect(parsed.metadata.path).toBe('src/plugins/SocketPlugin/SocketPlugin.c');
  });

  it('get_vm_source handler formats a VmSourceError as "<code>: <message>", including unsupported_platform for an unmapped subtype', async () => {
    // Given a harness with no mirror yet
    h = await createHarness();
    const tool = createVmSourceTools({ home: h.home, upstreamUrl: h.upstreamUrl, git: h.git }).find(
      (t) => t.name === 'get_vm_source',
    )!;
    const vmVersion = 'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636';

    // When invoking the handler without a mirror
    const missing = await tool.handler({
      vmVersion,
      lookupKey: 'primitiveSocketReceiveDataAvailable',
      module: 'SocketPlugin',
    });

    // Then it resolves to a mirror_missing error result pointing at setup_vm_mirror
    expect(missing.isError).toBe(true);
    expect(missing.content).toHaveLength(1);
    expect(missing.content[0].type).toBe('text');
    expect(missing.content[0].text.startsWith('mirror_missing: ')).toBe(true);
    expect(missing.content[0].text).toContain('setup_vm_mirror');

    // Given a mirror exists, When invoking with an unsupported platform subtype
    await h.pushUpstream({ 'src/spur64.cog/cointerp.c': coreInterp({ version: '3794' }) }, 'VMMaker.oscog-eem.3794');
    await h.cloneMirror();
    const other = await tool.handler({ vmVersion, lookupKey: 1, platformSubtype: 'sparc' });

    // Then it resolves to an unsupported_platform error result naming the subtype
    expect(other.isError).toBe(true);
    expect(other.content[0].text.startsWith('unsupported_platform: ')).toBe(true);
    expect(other.content[0].text).toContain('sparc');
  });
});
