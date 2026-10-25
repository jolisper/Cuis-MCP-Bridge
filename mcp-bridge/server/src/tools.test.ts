import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createTools } from './tools.js';
import type { CuisClient } from './cuisClient.js';
import { coreInterp, plugin } from './vmSource/testSupport/fixtures.js';
import { createHarness, type Harness } from './vmSource/testSupport/harness.js';

describe('createTools', () => {
  it('returns a list_categories tool whose handler resolves with the categories as MCP text content', async () => {
    // Given a fake CuisClient whose sendRequest resolves with a canned list of categories
    const fakeClient = {
      sendRequest: async () => ['Kernel-Objects', 'Collections'],
    } as unknown as CuisClient;

    // When creating the tools and invoking the list_categories tool's handler
    const tools = createTools(fakeClient);
    const listCategoriesTool = tools.find((tool) => tool.name === 'list_categories');
    const result = await listCategoriesTool!.handler({});

    // Then it returns a CallToolResult-shaped object containing the categories as text
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(['Kernel-Objects', 'Collections']) }],
    });
  });

  it('returns a list_senders_of tool whose handler resolves with the senders as MCP text content', async () => {
    // Given a fake CuisClient whose sendRequest resolves with a canned list of method references
    const senders = [
      { class: 'Foo', selector: 'bar', side: 'instance' },
      { class: 'Foo', selector: 'baz', side: 'class' },
    ];
    const fakeClient = {
      sendRequest: async () => senders,
    } as unknown as CuisClient;

    // When creating the tools and invoking the list_senders_of tool's handler
    const tools = createTools(fakeClient);
    const listSendersOfTool = tools.find((tool) => tool.name === 'list_senders_of');
    const result = await listSendersOfTool!.handler({ selector: 'bar' });

    // Then it returns a CallToolResult-shaped object containing the senders as text
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(senders) }],
    });
  });

  it('returns a list_implementors_of tool whose handler resolves with the implementors as MCP text content', async () => {
    // Given a fake CuisClient whose sendRequest resolves with a canned list of method references
    const implementors = [
      { class: 'Foo', selector: 'bar', side: 'instance' },
      { class: 'Qux', selector: 'bar', side: 'class' },
    ];
    const fakeClient = {
      sendRequest: async () => implementors,
    } as unknown as CuisClient;

    // When creating the tools and invoking the list_implementors_of tool's handler
    const tools = createTools(fakeClient);
    const listImplementorsOfTool = tools.find((tool) => tool.name === 'list_implementors_of');
    const result = await listImplementorsOfTool!.handler({ selector: 'bar' });

    // Then it returns a CallToolResult-shaped object containing the implementors as text
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(implementors) }],
    });
  });

  it('returns a get_vm_version tool whose handler forwards an empty args object and resolves with the version as MCP text content', async () => {
    // Given a fake CuisClient whose sendRequest records calls and resolves with a canned VM version
    const calls: Array<[string, unknown]> = [];
    const fakeClient = {
      sendRequest: async (method: string, args: unknown) => {
        calls.push([method, args]);
        return 'VMMaker.oscog-eem.3738 (placeholder)';
      },
    } as unknown as CuisClient;

    // When creating the tools and invoking the get_vm_version tool's handler with {}
    const tools = createTools(fakeClient);
    const getVmVersionTool = tools.find((tool) => tool.name === 'get_vm_version');
    const result = await getVmVersionTool!.handler({});

    // Then sendRequest was called exactly once with ('get_vm_version', {}) and the version is returned as JSON text
    expect(calls).toEqual([['get_vm_version', {}]]);
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify('VMMaker.oscog-eem.3738 (placeholder)') }],
    });
  });

  it('returns a get_platform_name tool whose handler forwards an empty args object and resolves with the platform name as MCP text content', async () => {
    // Given a fake CuisClient whose sendRequest records calls and resolves with a canned platform name
    const calls: Array<[string, unknown]> = [];
    const fakeClient = {
      sendRequest: async (method: string, args: unknown) => {
        calls.push([method, args]);
        return 'Mac OS';
      },
    } as unknown as CuisClient;

    // When creating the tools and invoking the get_platform_name tool's handler with {}
    const tools = createTools(fakeClient);
    const getPlatformNameTool = tools.find((tool) => tool.name === 'get_platform_name');
    const result = await getPlatformNameTool!.handler({});

    // Then sendRequest was called exactly once with ('get_platform_name', {}) and the name is returned as JSON text
    expect(calls).toEqual([['get_platform_name', {}]]);
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify('Mac OS') }],
    });
  });

  it('returns a get_platform_subtype tool whose handler forwards an empty args object and resolves with the platform subtype as MCP text content', async () => {
    // Given a fake CuisClient whose sendRequest records calls and resolves with a canned platform subtype
    const calls: Array<[string, unknown]> = [];
    const fakeClient = {
      sendRequest: async (method: string, args: unknown) => {
        calls.push([method, args]);
        return 'arm64';
      },
    } as unknown as CuisClient;

    // When creating the tools and invoking the get_platform_subtype tool's handler with {}
    const tools = createTools(fakeClient);
    const getPlatformSubtypeTool = tools.find((tool) => tool.name === 'get_platform_subtype');
    const result = await getPlatformSubtypeTool!.handler({});

    // Then sendRequest was called exactly once with ('get_platform_subtype', {}) and the subtype is returned as JSON text
    expect(calls).toEqual([['get_platform_subtype', {}]]);
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify('arm64') }],
    });
  });

  it('returns a get_loaded_modules tool whose handler forwards an empty args object and resolves with the builtin and loaded module lists as MCP text content', async () => {
    // Given a fake CuisClient whose sendRequest records calls and resolves with canned module lists
    const calls: Array<[string, unknown]> = [];
    const modules = { builtin: ['ModuleA (i)'], loaded: ['ModuleB (e)'] };
    const fakeClient = {
      sendRequest: async (method: string, args: unknown) => {
        calls.push([method, args]);
        return modules;
      },
    } as unknown as CuisClient;

    // When creating the tools and invoking the get_loaded_modules tool's handler with {}
    const tools = createTools(fakeClient);
    const getLoadedModulesTool = tools.find((tool) => tool.name === 'get_loaded_modules');
    const result = await getLoadedModulesTool!.handler({});

    // Then sendRequest was called exactly once with ('get_loaded_modules', {}) and the modules are returned as JSON text
    expect(calls).toEqual([['get_loaded_modules', {}]]);
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(modules) }],
    });
  });

  it('returns an MCP error result when sendRequest rejects with a coded error, instead of throwing', async () => {
    // Given a fake CuisClient whose sendRequest rejects with a structured not_found error
    const fakeClient = {
      sendRequest: async () => {
        const error = new Error('Class Foo not found') as Error & { code: string };
        error.code = 'not_found';
        throw error;
      },
    } as unknown as CuisClient;

    // When creating the tools and invoking the list_classes tool's handler
    const tools = createTools(fakeClient);
    const listClassesTool = tools.find((tool) => tool.name === 'list_classes');
    const result = await listClassesTool!.handler({ category: 'Nonexistent' });

    // Then it returns an MCP error result carrying the code and message, not a thrown rejection
    expect(result).toEqual({
      content: [{ type: 'text', text: 'not_found: Class Foo not found' }],
      isError: true,
    });
  });

  it('returns an MCP error result starting with protocol_mismatch: when get_vm_version rejects with a protocol_mismatch error', async () => {
    // Given a fake CuisClient whose sendRequest rejects with a structured protocol_mismatch error
    const fakeClient = {
      sendRequest: async () => {
        const error = new Error('bridge protocol version differs') as Error & { code: string };
        error.code = 'protocol_mismatch';
        throw error;
      },
    } as unknown as CuisClient;

    // When creating the tools and invoking the get_vm_version tool's handler with {}
    const tools = createTools(fakeClient);
    const getVmVersionTool = tools.find((tool) => tool.name === 'get_vm_version');
    const result = await getVmVersionTool!.handler({});

    // Then it returns an MCP error result whose text starts with the code
    expect(result.isError).toBe(true);
    expect(result.content[0].text.startsWith('protocol_mismatch:')).toBe(true);
  });

  it('returns an MCP error result starting with unreachable: when get_vm_version rejects with an unreachable error', async () => {
    // Given a fake CuisClient whose sendRequest rejects with a structured unreachable error
    const fakeClient = {
      sendRequest: async () => {
        const error = new Error('cannot reach Cuis image') as Error & { code: string };
        error.code = 'unreachable';
        throw error;
      },
    } as unknown as CuisClient;

    // When creating the tools and invoking the get_vm_version tool's handler with {}
    const tools = createTools(fakeClient);
    const getVmVersionTool = tools.find((tool) => tool.name === 'get_vm_version');
    const result = await getVmVersionTool!.handler({});

    // Then it returns an MCP error result whose text starts with the code
    expect(result.isError).toBe(true);
    expect(result.content[0].text.startsWith('unreachable:')).toBe(true);
  });

  describe('with vm source options', () => {
    let h: Harness;

    afterEach(async () => {
      await h?.cleanup();
    });

    it('appends setup_vm_mirror after the forwarded tools and it starts without touching the Cuis connection', async () => {
      // Given a gated harness and a fake CuisClient that records calls and is unreachable
      h = await createHarness({ gated: true });
      const calls: Array<[string, unknown]> = [];
      const fakeClient = {
        sendRequest: async (method: string, args: unknown) => {
          calls.push([method, args]);
          const error = new Error('cannot reach Cuis image') as Error & { code: string };
          error.code = 'unreachable';
          throw error;
        },
      } as unknown as CuisClient;

      // When creating the tools with vm source options and invoking setup_vm_mirror with {}
      const tools = createTools(fakeClient, { home: h.home, upstreamUrl: h.upstreamUrl, git: h.git });
      const names = tools.map((t) => t.name);
      const setupTool = tools.find((tool) => tool.name === 'setup_vm_mirror');
      const result = await setupTool?.handler({});

      // Then the tool list ends with setup_vm_mirror, get_vm_source, then run_smalltalk, it reports started, and the Cuis connection was never used
      expect(names).toEqual([
        'list_categories',
        'list_classes',
        'list_protocols',
        'list_methods',
        'get_method_source',
        'get_class_definition',
        'get_class_comment',
        'list_senders_of',
        'list_implementors_of',
        'get_vm_version',
        'get_platform_name',
        'get_platform_subtype',
        'get_loaded_modules',
        'setup_vm_mirror',
        'get_vm_source',
        'run_smalltalk',
      ]);
      expect(result).toEqual({ content: [{ type: 'text', text: '{"status":"started"}' }] });
      expect(calls).toEqual([]);
    });

    it('get_vm_source succeeds as the first and only call while the Cuis connection is unreachable, never touching it', async () => {
      // Given a fake CuisClient whose sendRequest rejects with an unreachable error
      const fakeClient = {
        sendRequest: vi.fn(async () => {
          const error = new Error('cannot reach Cuis image') as Error & { code: string };
          error.code = 'unreachable';
          throw error;
        }),
      };
      // And a mirror with one commit holding cointerp.c 3794 and a SocketPlugin exporting the primitive
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
      const tools = createTools(fakeClient as unknown as CuisClient, {
        home: h.home,
        upstreamUrl: h.upstreamUrl,
        git: h.git,
      });

      // When the first and only call is get_vm_source with the SocketPlugin args
      const result = await tools.find((tool) => tool.name === 'get_vm_source')!.handler({
        vmVersion: 'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794] 7.20260327.1636',
        lookupKey: 'primitiveSocketReceiveDataAvailable',
        module: 'SocketPlugin',
      });

      // Then it returns the SocketPlugin source without ever using the Cuis connection
      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(JSON.parse(text).metadata.path).toBe('src/plugins/SocketPlugin/SocketPlugin.c');
      expect(fakeClient.sendRequest).not.toHaveBeenCalled();
      expect(text).not.toContain('session_busy');
      expect(text).not.toContain('unreachable');
    });
  });

  describe('run_smalltalk independence from the live image and startup', () => {
    const temps: string[] = [];
    const tempHome = () => {
      const dir = mkdtempSync(join(tmpdir(), 'tools-inv-'));
      temps.push(dir);
      return dir;
    };

    afterEach(() => {
      vi.restoreAllMocks();
      vi.resetModules();
      for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it('run_smalltalk gives the same passed result with an unusable or a working live-image client, never touching the client (invariant 20)', async () => {
      // Given a client whose every method throws, and a working client, each with a ready run_smalltalk
      const home = tempHome();
      const touched = vi.fn(() => {
        throw new Error('live image must not be used');
      });
      const brokenClient = { connect: touched, sendRequest: touched } as unknown as CuisClient;
      const workingSend = vi.fn(async () => 'x');
      const workingClient = { connect: vi.fn(), sendRequest: workingSend } as unknown as CuisClient;
      const runSmalltalk = {
        status: vi.fn().mockResolvedValue({ state: 'ready' }),
        run: vi.fn(async () => ({ outcome: 'passed', exitCode: 0, output: 'DONE exitCode=0' })),
        platform: 'darwin' as const,
        home,
      };
      const call = async (client: CuisClient) => {
        const tool = createTools(client, {}, runSmalltalk as never).find((t) => t.name === 'run_smalltalk');
        const result = await tool!.handler({ code: '1' });
        return { result, body: JSON.parse(result.content[0].text) };
      };

      // When calling run_smalltalk through each
      const broken = await call(brokenClient);
      const working = await call(workingClient);

      // Then both are the same passed outcome, and neither client was ever used
      expect(broken.result.isError).toBeFalsy();
      expect(broken.body.status).toBe('passed');
      expect(working.body.status).toBe(broken.body.status);
      expect(touched).not.toHaveBeenCalled();
      expect(workingSend).not.toHaveBeenCalled();
      expect((workingClient as unknown as { connect: ReturnType<typeof vi.fn> }).connect).not.toHaveBeenCalled();
    });

    it('building the tool list and importing the run_smalltalk and cuisHome modules do no network access, Cuis work or filesystem writes (invariant 29)', async () => {
      // Given a throwing fetch spy, spy status/prepare/run, a client with spy methods and an empty temp home
      const home = tempHome();
      const fetchSpy = vi.fn(() => {
        throw new Error('no network at startup');
      });
      vi.stubGlobal('fetch', fetchSpy);
      const status = vi.fn();
      const prepare = vi.fn();
      const run = vi.fn();
      const client = { connect: vi.fn(), sendRequest: vi.fn() };
      const cwdBefore = process.cwd();

      // When constructing the tool list
      const tools = createTools(client as unknown as CuisClient, {}, { status, prepare, run, home } as never);

      // Then no dependency, fetch or client method was used and the home is still empty
      expect(tools.map((t) => t.name)).toContain('run_smalltalk');
      expect(status).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(client.connect).not.toHaveBeenCalled();
      expect(client.sendRequest).not.toHaveBeenCalled();
      expect(readdirSync(home)).toEqual([]);

      // When freshly importing the run_smalltalk and cuisHome modules
      vi.resetModules();
      await import('./runSmalltalk/tool.js');
      await import('./cuisHome/cuisHome.js');
      await import('./cuisHome/run.js');
      await import('./cuisHome/pin.js');
      await import('./cuisHome/runner.js');
      await import('./cuisHome/processLock.js');

      // Then still no network access, cwd change or files
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(process.cwd()).toBe(cwdBefore);
      expect(readdirSync(home)).toEqual([]);
      vi.unstubAllGlobals();
    });
  });
});
