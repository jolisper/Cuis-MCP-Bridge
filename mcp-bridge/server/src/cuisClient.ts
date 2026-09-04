import * as net from 'node:net';
import { PROTOCOL_VERSION, type ErrorCode, type HandshakeResponse } from './protocol.js';

export interface CuisClientOptions {
  host: string;
  port: number;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
}

/** Base for the errors `CuisClient` can reject with, each carrying a wire-protocol `ErrorCode`. */
abstract class CuisClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProtocolMismatchError extends CuisClientError {
  constructor(message: string) {
    super('protocol_mismatch', message);
  }
}

export class CuisResponseError extends CuisClientError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
  }
}

export class UnreachableError extends CuisClientError {
  constructor(message: string) {
    super('unreachable', message);
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * TCP client for the Cuis MCP Bridge wire protocol (see `mcp-bridge/PROTOCOL.md`).
 *
 * Owns the lifecycle of a single connection to the Cuis-side `McpBridgeServer`:
 * establishing the connection and performing the version handshake, applying
 * connect/request timeouts, transparently reconnecting once if a request is sent
 * against a socket the server has since closed, and serializing concurrent
 * `sendRequest` calls so at most one request is ever in flight on the wire at a time.
 */
export class CuisClient {
  private readonly host: string;
  private readonly port: number;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private socket: net.Socket | undefined;
  private pending: PendingRequest | undefined;
  private requestChain: Promise<void> = Promise.resolve();

  constructor(options: CuisClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
  }

  private armPending<T>(
    ms: number,
    timeoutMessage: string,
    resolve: (value: T) => void,
    reject: (reason: unknown) => void,
    onTimeout?: () => void,
  ): void {
    const timer = setTimeout(() => {
      this.pending = undefined;
      onTimeout?.();
      reject(new UnreachableError(timeoutMessage));
    }, ms);

    this.pending = {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject: (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    };
  }

  /**
   * Attaches the steady-state response listener used for every request after the
   * handshake completes. An ordinary operation error (`not_found`, `invalid_request`, ...)
   * is a normal protocol result, not a reason to tear down the connection — only `close`/
   * `error` events (the server or network actually going away) do that.
   */
  private attachResponseHandler(socket: net.Socket): void {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const response = JSON.parse(line) as
          | { ok: true; result: unknown }
          | { ok: false; error: { code: ErrorCode; message: string } };
        const currentPending = this.pending;
        this.pending = undefined;
        if (response.ok) {
          currentPending?.resolve(response.result);
        } else {
          currentPending?.reject(new CuisResponseError(response.error.code, response.error.message));
        }
      }
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port }, () => {
        socket.write(
          JSON.stringify({ op: 'handshake', params: { protocol_version: PROTOCOL_VERSION } }) +
            '\n',
        );
      });

      this.armPending(this.connectTimeoutMs, 'Connect timed out', resolve, reject, () =>
        socket.destroy(),
      );

      let buffer = '';
      const onHandshakeData = (chunk: Buffer): void => {
        buffer += chunk.toString('utf8');
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          return;
        }
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const response = JSON.parse(line) as HandshakeResponse;
        const currentPending = this.pending;
        this.pending = undefined;
        socket.off('data', onHandshakeData);
        if (response.ok === true) {
          this.socket = socket;
          this.attachResponseHandler(socket);
          currentPending?.resolve(response.result);
        } else if (response.error.code === 'protocol_mismatch') {
          socket.end();
          currentPending?.reject(new ProtocolMismatchError(response.error.message));
        } else {
          socket.end();
          currentPending?.reject(new CuisResponseError(response.error.code, response.error.message));
        }
      };
      socket.on('data', onHandshakeData);

      socket.on('error', (err) => {
        this.pending?.reject(new UnreachableError(err.message));
        this.pending = undefined;
      });

      socket.on('close', () => {
        const wasActive = this.socket === socket;
        if (wasActive) {
          this.socket = undefined;
          const currentPending = this.pending;
          this.pending = undefined;
          currentPending?.reject(new UnreachableError('Connection closed'));
        }
      });
    });
  }

  private async doSendRequest<T>(op: string, params: Record<string, unknown>): Promise<T> {
    // Safe: doSendRequest is only called from sendRequest, immediately after
    // either confirming this.socket is set or awaiting a connect() that sets it.
    const socket = this.socket!;
    return new Promise<T>((resolve, reject) => {
      this.armPending(this.requestTimeoutMs, 'Request timed out', resolve, reject);
      socket.write(JSON.stringify({ op, params }) + '\n');
    });
  }

  private async doSendRequestWithReconnect<T>(
    op: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (!this.socket) {
      await this.connect();
    }
    try {
      return await this.doSendRequest<T>(op, params);
    } catch (err) {
      if (this.socket) {
        throw err;
      }
      await this.connect();
      return await this.doSendRequest<T>(op, params);
    }
  }

  async sendRequest<T>(op: string, params: Record<string, unknown>): Promise<T> {
    const runner = (): Promise<T> => this.doSendRequestWithReconnect<T>(op, params);
    const result = this.requestChain.then(runner, runner);
    this.requestChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
