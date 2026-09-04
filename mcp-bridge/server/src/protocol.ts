/**
 * Wire protocol types for the Cuis MCP Bridge.
 *
 * This file mirrors `mcp-bridge/PROTOCOL.md`, the single source of truth for the wire
 * protocol between the bridge process (this Node/TypeScript process) and the Cuis-side
 * `McpBridgeServer` / `McpBridgeConnection`. Any change here must be made in lockstep with
 * that document.
 *
 * Pure type/constant declarations only — no runtime logic.
 */

/** The wire protocol version this bridge process is built against. */
export const PROTOCOL_VERSION = 1;

/** The six error codes defined by the wire protocol, exact snake_case spelling. */
export type ErrorCode =
  | 'not_found'
  | 'invalid_request'
  | 'internal_error'
  | 'protocol_mismatch'
  | 'session_busy'
  | 'unreachable';

/** Generic error envelope shared by every operation, including the handshake. */
export interface McpBridgeError {
  code: ErrorCode;
  message: string;
}

/** Generic success response envelope. */
export interface McpBridgeSuccess<T> {
  ok: true;
  result: T;
}

/** Generic error response envelope. */
export interface McpBridgeFailure {
  ok: false;
  error: McpBridgeError;
}

/** Generic response envelope: either a success carrying `result`, or a failure carrying `error`. */
export type McpBridgeResponse<T> = McpBridgeSuccess<T> | McpBridgeFailure;

/** `instance` or `class` side, used by `list_methods` and `get_method_source`. */
export type Side = 'instance' | 'class';

// --- Per-operation params/result shapes -----------------------------------------------

export interface ListCategoriesParams {}
export type ListCategoriesResult = string[];

export interface ListClassesParams {
  category: string;
}
export type ListClassesResult = string[];

export interface ListProtocolsParams {
  class: string;
}
export interface ListProtocolsResult {
  instance: string[];
  class: string[];
}

export interface ListMethodsParams {
  class: string;
  protocol: string;
  side: Side;
}
export type ListMethodsResult = string[];

export interface GetMethodSourceParams {
  class: string;
  selector: string;
  side: Side;
}
export type GetMethodSourceResult = string;

export interface GetClassDefinitionParams {
  class: string;
}
export interface GetClassDefinitionResult {
  superclass: string | null;
  instance_variable_names: string[];
  class_variable_names: string[];
  category: string;
}

export interface GetClassCommentParams {
  class: string;
}
export type GetClassCommentResult = string | null;

// --- Generic request envelope and per-operation discriminated union --------------------

/** Generic request envelope: any operation name paired with a params object. */
export interface McpBridgeRequest {
  op: string;
  params: Record<string, unknown>;
}

/** Discriminated union of the 7 read-only reflection operations' requests. */
export type McpBridgeOperationRequest =
  | { op: 'list_categories'; params: ListCategoriesParams }
  | { op: 'list_classes'; params: ListClassesParams }
  | { op: 'list_protocols'; params: ListProtocolsParams }
  | { op: 'list_methods'; params: ListMethodsParams }
  | { op: 'get_method_source'; params: GetMethodSourceParams }
  | { op: 'get_class_definition'; params: GetClassDefinitionParams }
  | { op: 'get_class_comment'; params: GetClassCommentParams };

// --- Handshake --------------------------------------------------------------------------

export interface HandshakeParams {
  protocol_version: number;
}

export interface HandshakeRequest {
  op: 'handshake';
  params: HandshakeParams;
}

export interface HandshakeResult {
  protocol_version: number;
}

export type HandshakeResponse = McpBridgeResponse<HandshakeResult>;
