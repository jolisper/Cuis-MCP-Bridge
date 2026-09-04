#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { CuisClient } from './cuisClient.js';
import { createTools } from './tools.js';

// Lazy connection: `CuisClient.sendRequest()` auto-connects on first use, so we
// deliberately do not call `client.connect()` here. This lets the bridge process
// start before the Cuis image is necessarily running.
const client = new CuisClient({ host: '127.0.0.1', port: 6789 });
const tools = createTools(client);

const server = new Server(
  { name: 'cuis-mcp-bridge', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }
  return (await tool.handler(request.params.arguments ?? {})) as CallToolResult;
});

const transport = new StdioServerTransport();
await server.connect(transport);
