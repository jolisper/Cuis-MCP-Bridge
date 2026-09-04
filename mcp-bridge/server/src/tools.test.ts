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
