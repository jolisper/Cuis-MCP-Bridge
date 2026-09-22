#!/usr/bin/env node
// Drives a running McpBridgeServer directly over its NDJSON/TCP wire protocol -- the same
// protocol mcp-bridge/server/src/cuisClient.ts speaks, reimplemented standalone here so this
// driver has no dependency on the Node bridge process (which hardcodes port 6789, reserved
// for an interactive dev image; this driver defaults to 6790, this skill's own instance).
//
// Usage: node driver.mjs <op> <jsonParams> [host] [port]
// Example: node driver.mjs list_implementors_of '{"selector":"setSocket:"}'

import * as net from 'node:net';

const [, , op, paramsJson, host = '127.0.0.1', port = '6790'] = process.argv;

if (!op) {
  console.error('Usage: node driver.mjs <op> <jsonParams> [host] [port]');
  process.exit(2);
}

const params = paramsJson ? JSON.parse(paramsJson) : {};
const PROTOCOL_VERSION = 2;

const socket = net.createConnection({ host, port: Number(port) }, () => {
  socket.write(JSON.stringify({ op: 'handshake', params: { protocol_version: PROTOCOL_VERSION } }) + '\n');
});

let buffer = '';
let stage = 'handshake';

socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    const response = JSON.parse(line);
    if (stage === 'handshake') {
      if (!response.ok) {
        console.error('Handshake failed:', JSON.stringify(response));
        socket.end();
        process.exit(1);
      }
      stage = 'request';
      socket.write(JSON.stringify({ op, params }) + '\n');
    } else {
      console.log(JSON.stringify(response, null, 2));
      socket.end();
      process.exit(response.ok ? 0 : 1);
    }
  }
});

socket.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('Timed out waiting for response');
  process.exit(1);
}, 5000);
