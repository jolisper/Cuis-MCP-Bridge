import type { CuisClient } from './cuisClient.js';

/** MCP `CallToolResult`-shaped outcome of invoking a tool's handler. */
export interface ToolCallResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** An MCP tool: its metadata plus a handler that invokes the corresponding Cuis operation. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolCallResult>;
}

interface ToolMeta {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_METADATA: ToolMeta[] = [
  {
    name: 'list_categories',
    description: 'List all class category names in the image, sorted alphabetically.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_classes',
    description: 'List all class names belonging to a given category, sorted alphabetically.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string' } },
      required: ['category'],
    },
  },
  {
    name: 'list_protocols',
    description:
      'List the instance-side and class-side protocol names of a class, sorted alphabetically.',
    inputSchema: {
      type: 'object',
      properties: { class: { type: 'string' } },
      required: ['class'],
    },
  },
  {
    name: 'list_methods',
    description:
      'List method selectors within a given class, protocol, and side, sorted alphabetically.',
    inputSchema: {
      type: 'object',
      properties: {
        class: { type: 'string' },
        protocol: { type: 'string' },
        side: { type: 'string', enum: ['instance', 'class'] },
      },
      required: ['class', 'protocol', 'side'],
    },
  },
  {
    name: 'get_method_source',
    description: "Get a method's full source text for a given class, selector, and side.",
    inputSchema: {
      type: 'object',
      properties: {
        class: { type: 'string' },
        selector: { type: 'string' },
        side: { type: 'string', enum: ['instance', 'class'] },
      },
      required: ['class', 'selector', 'side'],
    },
  },
  {
    name: 'get_class_definition',
    description:
      "Get a class's definition: superclass, instance/class variable names, and category.",
    inputSchema: {
      type: 'object',
      properties: { class: { type: 'string' } },
      required: ['class'],
    },
  },
  {
    name: 'get_class_comment',
    description: "Get a class's comment text, or null if it has none.",
    inputSchema: {
      type: 'object',
      properties: { class: { type: 'string' } },
      required: ['class'],
    },
  },
];

/** True if `err` is an `Error` carrying a `code` property, as thrown by `CuisClient`. */
function hasErrorCode(err: unknown): err is Error & { code: string } {
  return err instanceof Error && 'code' in err;
}

/**
 * Builds the MCP tool definitions for the 7 read-only reflection operations, each
 * wired to `client` via a shared handler that forwards `args` as `sendRequest`
 * params and maps any rejection to an MCP error result instead of throwing.
 */
export function createTools(client: CuisClient): ToolDefinition[] {
  return TOOL_METADATA.map((meta) => ({
    ...meta,
    handler: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
      try {
        const result = await client.sendRequest(meta.name, args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (hasErrorCode(err)) {
          return {
            content: [{ type: 'text', text: `${err.code}: ${err.message}` }],
            isError: true,
          };
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  }));
}
