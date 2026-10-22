import { describe, it, expect } from 'vitest';
import { createTools } from './tools.js';
import type { CuisClient } from './cuisClient.js';

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
});
