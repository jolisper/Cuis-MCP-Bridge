import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { CuisClient, ProtocolMismatchError, UnreachableError } from './cuisClient.js';

describe('CuisClient', () => {
  let fakeServer: net.Server | undefined;
  let openConnections: net.Socket[] = [];

  afterEach(async () => {
    if (fakeServer) {
      openConnections.forEach((socket) => socket.destroy());
      openConnections = [];
      await new Promise<void>((resolve) => fakeServer!.close(() => resolve()));
      fakeServer = undefined;
    }
  });

  it('connects and completes the handshake against a server that replies with a matching protocol version', async () => {
    // Given a fake Cuis-side TCP server that accepts one connection, reads the
    // handshake request line, and replies with a successful handshake response
    const port = await new Promise<number>((resolve) => {
      fakeServer = net.createServer((socket) => {
        openConnections.push(socket);
        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          if (buffer.includes('\n')) {
            socket.write('{"ok": true, "result": {"protocol_version": 1}}\n');
          }
        });
      });
      fakeServer.listen(0, '127.0.0.1', () => {
        resolve((fakeServer!.address() as net.AddressInfo).port);
      });
    });

    const client = new CuisClient({ host: '127.0.0.1', port });

    // When connecting and handshaking with that server
    // Then it resolves successfully with no exception
    await expect(client.connect()).resolves.not.toThrow();
  });

  it('rejects with a ProtocolMismatchError carrying code and message when the server reports a protocol mismatch', async () => {
    // Given a fake Cuis-side TCP server that replies to the handshake with a
    // protocol_mismatch error envelope, per PROTOCOL.md's exact shape
    const port = await new Promise<number>((resolve) => {
      fakeServer = net.createServer((socket) => {
        openConnections.push(socket);
        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          if (buffer.includes('\n')) {
            socket.write(
              '{"ok": false, "error": {"code": "protocol_mismatch", "message": "protocol version mismatch: expected 1, got 2"}}\n',
            );
          }
        });
      });
      fakeServer.listen(0, '127.0.0.1', () => {
        resolve((fakeServer!.address() as net.AddressInfo).port);
      });
    });

    const client = new CuisClient({ host: '127.0.0.1', port });

    // When connecting and handshaking with that server
    let caught: unknown;
    try {
      await client.connect();
    } catch (err) {
      caught = err;
    }

    // Then it rejects with a ProtocolMismatchError carrying the code and message
    expect(caught).toBeInstanceOf(ProtocolMismatchError);
    expect(caught).toMatchObject({
      code: 'protocol_mismatch',
      message: 'protocol version mismatch: expected 1, got 2',
    });
  });

  it('rejects with an UnreachableError carrying code "unreachable" when nothing is listening on the port', async () => {
    // Given a port that is guaranteed to have nothing listening on it: bind an
    // ephemeral server to grab a free port, then close it immediately so the
    // port becomes genuinely refused rather than colliding with a hardcoded number
    const port = await new Promise<number>((resolve) => {
      const probeServer = net.createServer();
      probeServer.listen(0, '127.0.0.1', () => {
        const assignedPort = (probeServer.address() as net.AddressInfo).port;
        probeServer.close(() => resolve(assignedPort));
      });
    });

    const client = new CuisClient({ host: '127.0.0.1', port });

    // When connecting to a port with nothing listening on it
    let caught: unknown;
    try {
      await client.connect();
    } catch (err) {
      caught = err;
    }

    // Then it rejects with an UnreachableError carrying the "unreachable" code,
    // not the raw Node socket error
    expect(caught).toBeInstanceOf(UnreachableError);
    expect(caught).toMatchObject({
      code: 'unreachable',
    });
  });

  it('sends a request after a successful handshake and resolves with the parsed result', async () => {
    // Given a fake Cuis-side TCP server that replies successfully to the
    // handshake, then replies to a subsequent list_categories request
    const port = await new Promise<number>((resolve) => {
      fakeServer = net.createServer((socket) => {
        openConnections.push(socket);
        let buffer = '';
        let handshakeDone = false;
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex === -1) {
            return;
          }
          buffer = buffer.slice(newlineIndex + 1);
          if (!handshakeDone) {
            handshakeDone = true;
            socket.write('{"ok": true, "result": {"protocol_version": 1}}\n');
          } else {
            socket.write('{"ok": true, "result": ["MCP-Bridge"]}\n');
          }
        });
      });
      fakeServer.listen(0, '127.0.0.1', () => {
        resolve((fakeServer!.address() as net.AddressInfo).port);
      });
    });

    const client = new CuisClient({ host: '127.0.0.1', port });

    // When connecting and then sending a list_categories request
    await client.connect();
    const result = await client.sendRequest<string[]>('list_categories', {});

    // Then it resolves with the parsed result from the second response line
    expect(result).toEqual(['MCP-Bridge']);
  });

  it(
    'rejects sendRequest with an UnreachableError when the server completes the handshake but never responds to the request',
    async () => {
      // Given a fake Cuis-side TCP server that replies successfully to the
      // handshake but then never sends any further data for the follow-up request
      const port = await new Promise<number>((resolve) => {
        fakeServer = net.createServer((socket) => {
          openConnections.push(socket);
          let buffer = '';
          let handshakeDone = false;
          socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex === -1) {
              return;
            }
            buffer = buffer.slice(newlineIndex + 1);
            if (!handshakeDone) {
              handshakeDone = true;
              socket.write('{"ok": true, "result": {"protocol_version": 1}}\n');
            }
            // else: silently swallow the request, never respond
          });
        });
        fakeServer.listen(0, '127.0.0.1', () => {
          resolve((fakeServer!.address() as net.AddressInfo).port);
        });
      });

      const client = new CuisClient({ host: '127.0.0.1', port, requestTimeoutMs: 200 });

      // When connecting successfully, then sending a request that never gets a reply
      await client.connect();
      let caught: unknown;
      try {
        await client.sendRequest('list_categories', {});
      } catch (err) {
        caught = err;
      }

      // Then it rejects with an UnreachableError carrying the "unreachable" code,
      // bounded by the configured request timeout rather than hanging forever
      expect(caught).toBeInstanceOf(UnreachableError);
      expect(caught).toMatchObject({
        code: 'unreachable',
      });
    },
    2000,
  );

  it(
    'rejects connect with an UnreachableError when the server accepts the connection but never completes the handshake',
    async () => {
      // Given a fake Cuis-side TCP server that accepts the connection but never
      // writes any data back, so the handshake never completes
      const port = await new Promise<number>((resolve) => {
        fakeServer = net.createServer((socket) => {
          openConnections.push(socket);
          // never write anything back
        });
        fakeServer.listen(0, '127.0.0.1', () => {
          resolve((fakeServer!.address() as net.AddressInfo).port);
        });
      });

      const client = new CuisClient({ host: '127.0.0.1', port, connectTimeoutMs: 200 });

      // When connecting to a server that never replies to the handshake
      let caught: unknown;
      try {
        await client.connect();
      } catch (err) {
        caught = err;
      }

      // Then it rejects with an UnreachableError carrying the "unreachable" code,
      // bounded by the configured connect timeout rather than hanging forever
      expect(caught).toBeInstanceOf(UnreachableError);
      expect(caught).toMatchObject({
        code: 'unreachable',
      });
    },
    2000,
  );

  it(
    'transparently reconnects and retries when sendRequest finds the socket dead from a prior disconnect',
    async () => {
      // Given a fake Cuis-side TCP server that: on the first connection,
      // completes the handshake but then destroys the socket instead of
      // replying to the follow-up request (simulating a mid-session drop);
      // on the second connection (the client's reconnect attempt to the same
      // host/port), it completes the handshake AND replies normally to the
      // follow-up request
      let connectionCount = 0;
      const port = await new Promise<number>((resolve) => {
        fakeServer = net.createServer((socket) => {
          openConnections.push(socket);
          connectionCount += 1;
          const isFirstConnection = connectionCount === 1;
          let buffer = '';
          let handshakeDone = false;
          socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex === -1) {
              return;
            }
            buffer = buffer.slice(newlineIndex + 1);
            if (!handshakeDone) {
              handshakeDone = true;
              socket.write('{"ok": true, "result": {"protocol_version": 1}}\n');
            } else if (isFirstConnection) {
              socket.destroy();
            } else {
              socket.write('{"ok": true, "result": ["MCP-Bridge"]}\n');
            }
          });
        });
        fakeServer.listen(0, '127.0.0.1', () => {
          resolve((fakeServer!.address() as net.AddressInfo).port);
        });
      });

      const client = new CuisClient({ host: '127.0.0.1', port, requestTimeoutMs: 300 });

      // When connecting successfully, then sending a request against a socket
      // that the server has since killed
      await client.connect();
      const result = await client.sendRequest<string[]>('list_categories', {});

      // Then it transparently reconnects under the hood and resolves with the
      // result from the retried request on the second connection
      expect(result).toEqual(['MCP-Bridge']);
    },
    2000,
  );

  it(
    'serializes two concurrent sendRequest calls onto the socket so the server never has more than one unanswered request in flight, and each call resolves with its own non-swapped result',
    async () => {
      // Given a fake Cuis-side TCP server that completes the handshake, then for
      // each subsequent request line waits 50ms before replying (echoing back the
      // category it received), while recording whether it ever had more than one
      // unanswered request in flight at the same time
      let inFlightCount = 0;
      let sawOverlap = false;
      const port = await new Promise<number>((resolve) => {
        fakeServer = net.createServer((socket) => {
          openConnections.push(socket);
          let buffer = '';
          let handshakeDone = false;
          socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            let newlineIndex: number;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIndex);
              buffer = buffer.slice(newlineIndex + 1);
              if (!handshakeDone) {
                handshakeDone = true;
                socket.write('{"ok": true, "result": {"protocol_version": 1}}\n');
                continue;
              }
              inFlightCount += 1;
              if (inFlightCount > 1) {
                sawOverlap = true;
              }
              const request = JSON.parse(line) as { params: { category: string } };
              const category = request.params.category;
              setTimeout(() => {
                inFlightCount -= 1;
                socket.write(`{"ok": true, "result": ["${category}"]}\n`);
              }, 50);
            }
          });
        });
        fakeServer.listen(0, '127.0.0.1', () => {
          resolve((fakeServer!.address() as net.AddressInfo).port);
        });
      });

      const client = new CuisClient({ host: '127.0.0.1', port });

      // When firing two sendRequest calls concurrently, without awaiting the
      // first before starting the second
      await client.connect();
      const p1 = client.sendRequest<string[]>('list_classes', { category: 'Alpha' });
      const p2 = client.sendRequest<string[]>('list_classes', { category: 'Beta' });
      const [result1, result2] = await Promise.all([p1, p2]);

      // Then each call resolves with its own matching result, and the server
      // never observed two unanswered requests in flight at once
      expect(result1).toEqual(['Alpha']);
      expect(result2).toEqual(['Beta']);
      expect(sawOverlap).toBe(false);
    },
    2000,
  );
});
