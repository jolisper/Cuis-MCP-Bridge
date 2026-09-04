# Cuis MCP Bridge — Wire Protocol

This document is the single source of truth for the wire protocol between the two
components of the Cuis MCP Bridge:

- **Cuis-side** — `McpBridgeServer` / `McpBridgeConnection`, in `mcp-bridge/image/`.
- **Bridge process** — the Node/TypeScript process in `mcp-bridge/server/`
  (`src/protocol.ts`, `src/cuisClient.ts`).

Both sides implement against this document, not against each other's source. Whenever the
wire schema changes, this file is updated first, and both `PROTOCOL_VERSION` constants are
bumped together by convention (there is no shared types file across Smalltalk and
TypeScript, and no tooling enforces the bump — see "Protocol version" below).

This bridge exposes **read-only reflection only**. No operation defined here can define,
compile, delete, or otherwise modify anything in the image, and no operation evaluates
arbitrary code (functional-spec invariants 17, 18).

## Transport

- **Mechanism**: a plain TCP socket.
- **Port**: `6789`, fixed and hardcoded on both sides. There is no discovery or negotiation
  mechanism — this is a single-developer, single-machine setup. The Cuis-side developer
  starts the server with `McpBridgeServer startOn: 6789`; the bridge's `cuisClient` connects
  to `6789` by default.
- **Bind address**: loopback only (`127.0.0.1`). The server is never reachable from outside
  the machine it runs on (invariant 15). This is not configurable.
- **Framing**: newline-delimited JSON (NDJSON). Every message — request or response — is
  exactly one JSON value, UTF-8 encoded, with no embedded literal newline, followed by a
  single `\n` byte. JSON string encoding already escapes `\n` and other control characters
  inside string values (e.g. multi-line method source in a `get_method_source` response), so
  this framing is unambiguous.
- **Cardinality**: exactly one active TCP connection per server at a time (invariant 20; see
  "Concurrency and session semantics" below).
- **Pattern**: strict request/response, not pipelined (invariant 19). The client sends one
  request line and then waits for the matching response line before sending the next
  request. The server processes one request to completion, writes exactly one response line,
  and only then reads the next request line.

## Protocol version

A single integer constant, starting at:

```
PROTOCOL_VERSION = 1
```

Both sides hold this constant (Cuis-side: a class-side constant on `McpBridgeServer` or a
dedicated `McpBridgeProtocol` class; bridge-side: `src/protocol.ts`). It increments by 1
whenever any part of this document's wire schema changes — a new operation, a changed
field, a changed error code — regardless of how small the change is. There is no separate
minor/patch scheme; any incompatible or compatible change alike bumps the integer, and the
handshake (below) treats any mismatch, in either direction, as incompatible.

## Handshake

Immediately after the TCP connection is accepted, and before either side sends or accepts
any tool request, the client and server exchange exactly one handshake request/response pair
(invariant 14).

**Handshake request** (bridge → Cuis, first line on the wire):

```json
{"op": "handshake", "params": {"protocol_version": 1}}
```

- `protocol_version` (integer, required): the `PROTOCOL_VERSION` the bridge process was
  built with.

**Handshake response, version match** (Cuis → bridge):

```json
{"ok": true, "result": {"protocol_version": 1}}
```

- `protocol_version` (integer): the `PROTOCOL_VERSION` the Cuis-side package was loaded
  with. Matches the request's value.

**Handshake response, version mismatch** (Cuis → bridge):

```json
{"ok": false, "error": {"code": "protocol_mismatch", "message": "protocol version mismatch: expected 1, got 2"}}
```

- The `message` names both versions: the one the bridge sent (expected, from the client's
  point of view) and the one the Cuis-side package actually has (actual).
- On a mismatch, the server does not accept any further requests on this connection — the
  connection is torn down. The bridge process fails every tool call for this connection
  attempt with `protocol_mismatch` (surfaced to Claude Code with both versions named) rather
  than sending requests the other side cannot understand.

**Decision (spec silent on exact shape):** the handshake reuses the same generic
request/response envelope as every other operation (see below), with reserved operation name
`handshake` and a single `protocol_version` field in both the request's `params` and the
success response's `result`. This keeps the framing code identical for the handshake and for
tool calls — there is no separate wire format for the handshake.

## Request/response envelope

Every message after the handshake follows the same two shapes.

**Request** (bridge → Cuis):

```json
{"op": "<operation_name>", "params": { ... }}
```

- `op` (string, required): one of the 7 operation names below (or `handshake`, handshake
  only).
- `params` (object, required, may be `{}`): the operation's parameters, as documented per
  operation below.

**Response, success** (Cuis → bridge):

```json
{"ok": true, "result": ...}
```

- `result` may be any JSON value the operation defines (array, object, string, or `null`).

**Response, error** (Cuis → bridge):

```json
{"ok": false, "error": {"code": "<error_code>", "message": "<human-readable text>"}}
```

- `code` (string, required): one of the six error codes below — machine-readable, exact
  snake_case spelling (invariant 8/9/22).
- `message` (string, required): a human-readable description naming what went wrong.

**Decision (spec silent on exact field naming):** the top-level discriminator is a boolean
`ok` field rather than an `error`-is-present-or-absent convention, since `McpBridgeConnection`
described in the technical spec always "encodes the response with `Json`" from a single
Dictionary — a boolean discriminator is simplest to build in Smalltalk (`ok: true/false`)
and simplest to switch on in TypeScript.

Malformed JSON on a request line, or an `op` value the server does not recognize, is
answered with `invalid_request` (see below) and never crashes the connection loop
(invariants 9, 10).

## Operations

All 7 operations are read-only reflection calls; none accepts a value that names code to
compile or evaluate.

### `list_categories`

- **Params**: `{}` (none).
- **Success result**: array of category name strings, sorted alphabetically (invariant 2).

```json
{"op": "list_categories", "params": {}}
{"ok": true, "result": ["Collections-Sequenceable", "Kernel-Classes", "MCP-Bridge"]}
```

### `list_classes`

- **Params**:
  - `category` (string, required): the category name.
- **Success result**: array of class name strings belonging to `category`, sorted
  alphabetically. A category that exists but currently has zero classes returns `[]`, not an
  error (invariant 4).
- **Errors**: `not_found` if `category` does not exist in the image.

```json
{"op": "list_classes", "params": {"category": "MCP-Bridge"}}
{"ok": true, "result": ["McpBridgeConnection", "McpBridgeServer"]}
```

### `list_protocols`

- **Params**:
  - `class` (string, required): the class name.
- **Success result**: an object carrying instance-side and class-side protocol names
  separately (functional-spec item 17), each sorted alphabetically:

```json
{"op": "list_protocols", "params": {"class": "OrderedCollection"}}
{"ok": true, "result": {"instance": ["accessing", "adding", "removing"], "class": ["instance creation"]}}
```

- **Errors**: `not_found` if `class` does not exist.

**Decision (spec silent on exact shape):** the response is a single object with two keys,
`instance` and `class`, rather than two separate operations or a list of `{side, protocols}`
pairs — this is the most direct JSON encoding of "reported separately for the instance side
and the class side," and mirrors the `side` parameter used by `list_methods` and
`get_method_source` below.

### `list_methods`

- **Params**:
  - `class` (string, required): the class name.
  - `protocol` (string, required): the protocol name.
  - `side` (string, required): `"instance"` or `"class"`.
- **Success result**: array of method selector strings within `class` + `protocol` + `side`,
  sorted alphabetically. Empty if the protocol exists but has zero methods on that side —
  not an error (invariant 5).
- **Errors**: `not_found` if `class` does not exist, if `protocol` does not exist on the
  given `side`, or if `side` is neither `"instance"` nor `"class"` (an unrecognized `side`
  value is treated as "that side does not exist," not as `invalid_request`, since the field
  is present and well-formed — just not a valid enum member). `invalid_request` if `side` is
  missing or not a string.

```json
{"op": "list_methods", "params": {"class": "OrderedCollection", "protocol": "adding", "side": "instance"}}
{"ok": true, "result": ["add:", "addAll:", "addFirst:"]}
```

### `get_method_source`

- **Params**:
  - `class` (string, required): the class name.
  - `selector` (string, required): the method selector.
  - `side` (string, required): `"instance"` or `"class"`.
- **Success result**: a string containing the method's full source text (multi-line source
  is a single JSON string with embedded `\n` escapes; NDJSON framing is unaffected — see
  "Transport").
- **Errors**: `not_found` if `class` does not exist, or if `selector` is not implemented on
  the given `side` (invariant 7 — `instance` and `class` are independent namespaces; a
  selector defined only on one side is `not_found` on the other). `invalid_request` if
  `selector` is empty or `side` is missing/invalid.

```json
{"op": "get_method_source", "params": {"class": "OrderedCollection", "selector": "add:", "side": "instance"}}
{"ok": true, "result": "add: anObject\n\t\"Add anObject...\"\n\t...\n"}
```

### `get_class_definition`

- **Params**:
  - `class` (string, required): the class name.
- **Success result**: an object with:
  - `superclass` (string or `null`): the superclass name, `null` only for a class with no
    superclass (e.g. `Object`).
  - `instance_variable_names` (array of strings): may be `[]`.
  - `class_variable_names` (array of strings): may be `[]`.
  - `category` (string): the class's category name.
- **Errors**: `not_found` if `class` does not exist.

```json
{"op": "get_class_definition", "params": {"class": "OrderedCollection"}}
{"ok": true, "result": {"superclass": "SequenceableCollection", "instance_variable_names": ["firstIndex", "lastIndex"], "class_variable_names": [], "category": "Collections-Sequenceable"}}
```

**Decision (spec silent on exact field naming):** field names use `snake_case`
(`instance_variable_names`, `class_variable_names`) for consistency with the `op` and error
`code` naming convention used throughout this document, rather than Smalltalk-style
camelCase or a `superclass`-only-if-non-nil convention (superclass is always present, `null`
when there is none).

### `get_class_comment`

- **Params**:
  - `class` (string, required): the class name.
- **Success result**: the comment text as a string, or JSON `null` if the class exists but
  has no comment set (invariant 6 — explicitly distinct from a `not_found` error).
- **Errors**: `not_found` if `class` does not exist.

```json
{"op": "get_class_comment", "params": {"class": "OrderedCollection"}}
{"ok": true, "result": "I represent... "}
```

```json
{"op": "get_class_comment", "params": {"class": "SomeUncommentedClass"}}
{"ok": true, "result": null}
```

## Error codes

Exactly six codes, `snake_case`, spelled exactly as follows. Every error response uses the
generic error envelope (`{"ok": false, "error": {"code": ..., "message": ...}}`) shown above.

### `not_found`

- **When**: the requested category, class, protocol, method selector, or class+selector+side
  combination does not exist in the image (invariants 8, satisfies the "clean failure, no
  hang, no unstructured exception" requirement). Emitted by the Cuis side.
- **Example**:
  ```json
  {"ok": false, "error": {"code": "not_found", "message": "class not found: 'FooBarBaz'"}}
  ```

### `invalid_request`

- **When**: a request has a missing or malformed required argument (e.g. empty class name,
  missing `params` field, `op` naming an unrecognized operation, malformed JSON on the
  request line) — the Cuis side never attempts to reach the image for this request
  (invariant 9). Also used for malformed JSON that cannot be parsed into a request at all, and
  for an unrecognized `op` value (invariant 10 — never crashes the connection loop).
- **Example**:
  ```json
  {"ok": false, "error": {"code": "invalid_request", "message": "missing required parameter: 'category'"}}
  ```

### `internal_error`

- **When**: an unexpected failure occurs while performing a reflection operation on the Cuis
  side — a genuine bug or unforeseen condition, not a "doesn't exist" case. `McpBridgeConnection`
  catches any unhandled `Error` signaled while dispatching an operation and converts it to
  this code rather than letting it propagate, crash the connection, or crash the image
  (invariant 22).
- **Example**:
  ```json
  {"ok": false, "error": {"code": "internal_error", "message": "unexpected error reflecting on 'OrderedCollection': doesNotUnderstand: #fooBarBaz"}}
  ```

### `protocol_mismatch`

- **When**: during the handshake (invariant 14), the bridge's `PROTOCOL_VERSION` does not
  match the Cuis-side package's `PROTOCOL_VERSION`. Emitted by the Cuis side as the handshake
  response; also synthesized locally by the bridge process (`cuisClient`) if it detects the
  mismatch itself before sending any further request. Always names both versions.
- **Example**:
  ```json
  {"ok": false, "error": {"code": "protocol_mismatch", "message": "protocol version mismatch: expected 1, got 2"}}
  ```

### `session_busy`

- **When**: a second TCP connection attempt arrives at the Cuis-side server while one
  connection is already active (invariant 20). The server writes a single `session_busy`
  error message to the new socket — with no handshake exchanged first, since a session slot
  isn't available to negotiate on — and closes it immediately. It never creates a second
  `McpBridgeConnection` and never disturbs the existing session.
- **Example**:
  ```json
  {"ok": false, "error": {"code": "session_busy", "message": "a session is already active; only one connection is allowed at a time"}}
  ```
- **Decision (spec silent on framing for this one case):** because no handshake has
  occurred on the rejected connection, this is the one message the server may send before a
  version has been negotiated. It is still framed as one NDJSON line using the standard
  error envelope, so the bridge's parser needs no special case.

### `unreachable`

- **When**: emitted by the **bridge process only** (never by the Cuis side, which by
  definition cannot answer if it is unreachable) — the Cuis-side socket server cannot be
  reached at all: server not started, image not running, port closed (invariant 12), a
  connect or per-request timeout elapses, or a reconnect attempt after a mid-session
  disconnect also fails (invariant 13). Surfaced to Claude Code as the MCP tool error result
  for every tool call made in this state, never as an indefinite hang.
- **Example** (constructed by `src/tools.ts`, not received over the wire):
  ```json
  {"ok": false, "error": {"code": "unreachable", "message": "could not connect to Cuis-side server at 127.0.0.1:6789: connection refused"}}
  ```

## Concurrency and session semantics

(Informational — see functional-spec invariants 19-23 for the authoritative behavioral
requirements; this section only restates how they map onto the wire protocol above.)

- **Single active connection**: the server accepts at most one `McpBridgeConnection` at a
  time. A second concurrent connection attempt is rejected with `session_busy` and closed
  (invariant 20).
- **Request/response, not pipelined**: within one connection, the client sends one request
  line and waits for its response line before sending the next (invariant 19). There is no
  request ID or correlation field in the envelope, because there is never more than one
  request in flight per connection — the response order is always the request order.
- **Inactivity timeout**: if the active connection goes silent (no requests) past a
  server-side inactivity timeout, the server treats the session as dead, frees the slot, and
  a subsequent connection attempt succeeds instead of getting `session_busy` indefinitely
  (invariant 21). A clean disconnect (TCP close) frees the session immediately, without
  waiting for the timeout. The exact timeout duration is a Cuis-side implementation detail,
  not part of this wire protocol, and is not itself communicated over the wire.
- **No cancellation**: once a request is sent, it cannot be cancelled; every operation in
  this document is expected to complete quickly (invariant 23). There is no cancel message
  in this protocol.
