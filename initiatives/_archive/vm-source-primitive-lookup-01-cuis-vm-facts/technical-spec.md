# VM Source: Primitive Lookup — Part 1: Cuis VM Facts — Technical Spec

Behavior lives in `functional-spec.md` (invariants 1–8). This part adds four read-only wire
operations and their MCP tools; it adds no host-side logic.

## Context

The bridge has two halves joined by an NDJSON protocol specified in `mcp-bridge/PROTOCOL.md`:

- **Cuis side**, `mcp-bridge/image/MCP-Bridge.pck.st`. `McpBridgeConnection>>operationHandlers`
  (`:98-110`) maps each `op` name to a handler selector; `requestLoop` (`:66-95`) looks it up
  and answers an unknown op with `invalid_request` (`:85`). Handlers call `sendSuccess:` /
  `sendError:message:` (`:273`, `:284`). `protocolVersion` is `^ 2` (`:50-52`); the handshake
  compares it to the client's value and replies `protocol_mismatch` (`:119-129`).
- **Bridge side**, `mcp-bridge/server/src`. `protocol.ts` mirrors the wire types and holds
  `PROTOCOL_VERSION = 2` (`:13`). `tools.ts` has one `TOOL_METADATA` entry per op (`:23-114`);
  `createTools` (`:126`) builds a single generic handler per entry that forwards `args` to
  `client.sendRequest(meta.name, args)` and maps coded rejections to MCP error results. So tool
  name == wire op name, and a new read-only op needs no handler code on the TS side.
- `cuisClient.ts` already yields `unreachable` / `protocol_mismatch` / `session_busy` for every
  op (`:22-38`, `:153-155`); invariants 6 and 7 inherit that for free as long as the new ops use
  the same path.

## Proposed changes

1. **Wire protocol (`PROTOCOL.md`, first).** Add four operations after `list_implementors_of`:
   `get_vm_version`, `get_platform_name`, `get_platform_subtype` (params `{}`, result a JSON
   string) and `get_loaded_modules` (params `{}`, result
   `{"builtin": [string], "loaded": [string]}`, stamps as the VM reports them, suffix included,
   not sorted). Update "one of the 9 operation names" / "All 9 operations" to 13, and bump
   `PROTOCOL_VERSION` 2 → 3 in the text. The bump is what makes an older image fail with
   `protocol_mismatch` instead of `invalid_request` (invariant 6). Errors: none beyond the
   generic envelope. Params are ignored, as `list_categories` does.
2. **Cuis side.** In `MCP-Bridge.pck.st`:
   - `protocolVersion` → `^ 3`.
   - Four entries in `operationHandlers` and four handlers, same shape as
     `handleListCategories:`: `Smalltalk vmVersion`, `Smalltalk platformName`,
     `Smalltalk platformSubtype`, and an `OrderedDictionary` with `'builtin'` →
     `(Smalltalk listBuiltinModules collect: [:each | each asString]) asArray` and `'loaded'` →
     the same over `listLoadedModules`. Each call reads live VM state, with no caching
     (invariant 5). No handler writes anything (invariant 8).
   - Update the `McpBridgeConnection` class comment (`:44`) to list the new ops.
   - Assumption to verify in the image first: those five `Smalltalk` selectors return Strings /
     collections of Strings in Cuis 7.8 (initiative reports them live-verified). If an element
     is a Symbol or a non-String, `asString` normalizes it.
3. **Bridge side.** `protocol.ts`: `PROTOCOL_VERSION = 3`; add `GetVmVersionParams/Result`,
   `GetPlatformNameParams/Result`, `GetPlatformSubtypeParams/Result`,
   `GetLoadedModulesParams` and `GetLoadedModulesResult { builtin: string[]; loaded: string[] }`,
   and extend `McpBridgeOperationRequest`. `tools.ts`: four `TOOL_METADATA` entries with
   `inputSchema: { type: 'object', properties: {} }`; no other change, and no network use
   (invariant 6).
4. **Docs.** `README.md` "Available tools" gains four bullets and "The 9 tools" becomes 13.
5. **Existing tests that hard-code version 2.** `Tests-MCP-Bridge.pck.st` sends
   `"protocol_version": 2` in about 20 places (e.g. `:147`, `:185`) and expects
   `{"protocol_version": 2}` back; all become 3. `testHandshakeRequestWithMismatchedVersionGetsProtocolMismatchError`
   (`:155-172`) sends 3 and expects "expected 2, got 3"; it must send 2 (an old bridge) and
   expect "expected 3, got 2", which doubles as the old-package scenario of invariant 6. The TS
   fake servers answering `protocol_version: 1` in `cuisClient.test.ts` are unaffected: the
   client doesn't compare the response's version.

Tradeoff: four separate ops (as the functional spec requires) rather than one bundled
"VM info" op; the cost is a few lines of near-duplicate handler code, accepted for the
one-fact-per-call style of the existing bridge.

## Implementation sequence

1. `mcp-bridge/PROTOCOL.md` — four operations, op count, version 3
2. `mcp-bridge/server/src/protocol.ts` — version 3, new param/result types, request union
3. `mcp-bridge/image/Tests-MCP-Bridge.pck.st` — bump hard-coded version 2 → 3, fix the mismatch test
4. `mcp-bridge/image/Tests-MCP-Bridge.pck.st` — new tests for the four ops (red)
5. `mcp-bridge/image/MCP-Bridge.pck.st` — `protocolVersion` 3, four handlers and dispatch entries, class comment (green)
6. `mcp-bridge/server/src/tools.test.ts` — tests for the four new tools (red)
7. `mcp-bridge/server/src/tools.ts` — four `TOOL_METADATA` entries (green)
8. `mcp-bridge/README.md` — tool list and count

## Testing and validation

Smalltalk: `tools/run-headless-tests.sh mcp-bridge/image/run-tests.st` (the `test-cuis-mcp-bridge`
skill). TypeScript: `npm test` in `mcp-bridge/server`. New Smalltalk tests follow the existing
pattern (start a server on an unused test port, starting at 17930; handshake with version 3;
send the request; decode with `Json`).

- **Invariant 1** — `testGetVmVersionRequestGetsVmVersionString`: result is a String, equals
  `Smalltalk vmVersion`, and contains `VMMaker.oscog-eem.` (headless VM is Cog).
- **Invariant 2** — `testGetPlatformNameRequestGetsPlatformNameString`: result equals
  `Smalltalk platformName`.
- **Invariant 3** — `testGetPlatformSubtypeRequestGetsPlatformSubtypeString`: result equals
  `Smalltalk platformSubtype`.
- **Invariant 4** — `testGetLoadedModulesRequestGetsBuiltinAndLoadedArrays`: result has exactly
  the keys `builtin` and `loaded`, both arrays of Strings, equal to the `Smalltalk
  listBuiltinModules` / `listLoadedModules` contents in order, with the ` (i)` / ` (e)` suffix
  intact; `builtin` is non-empty.
- **Invariant 5** — two sub-checks: (a) each op succeeds as the first request after the
  handshake, with no other op called before; (b) `testGetLoadedModulesReflectsLaterLoads`: call
  `get_loaded_modules`, force a plugin to load (call a primitive from a not-yet-loaded plugin if
  the headless VM has one; otherwise stub-free fallback is to compare two calls against
  `Smalltalk listLoadedModules` taken immediately before each), and assert the second response
  matches the second live value. Marked best-effort: loadable plugins vary by VM build.
- **Invariant 6** — Smalltalk: the rewritten mismatch test (old client sends 2, gets
  `protocol_mismatch`, "expected 3, got 2", no `invalid_request`). TS: add to `tools.test.ts` a
  `get_vm_version` handler test where the fake `sendRequest` rejects with code
  `protocol_mismatch`, asserting the MCP error text is `protocol_mismatch: …`; the existing
  `cuisClient.test.ts` case (`:44`) already covers the client rejecting on a mismatch. A
  fake-client test with code `unreachable` covers the other allowed error. "No network calls"
  holds by construction (the handlers only call `CuisClient`); review check, no test.
- **Invariant 7** — `testNewOpsShareSessionWithExistingOnes`: with connection A handshaken,
  connection B receives `session_busy` (as `testSecondConnectionWhileOneActiveGetsSessionBusy`,
  `:81`), and A's `get_vm_version` still answers afterwards.
- **Invariant 8** — review check plus a test: take a snapshot of
  `Smalltalk listLoadedModules` and `SystemOrganization categories` size before and after
  calling all four ops; they're unchanged. The handlers contain no assignment or mutating send.
- **Wiring** — `tools.test.ts`: `createTools` returns tools named `get_vm_version`,
  `get_platform_name`, `get_platform_subtype`, `get_loaded_modules`, each forwarding `{}` to
  `sendRequest` with its own name and returning the result as JSON text.
- **Live check** — after the unit tests, the `run-cuis-mcp-bridge` skill can start the bridge
  against the real image and call the four tools to confirm the values match the bundled VM
  (e.g. `VMMaker.oscog-eem.3738`).

## Risks and mitigations

- **Version bump is a hard break.** Any image still on the old `MCP-Bridge.pck.st` fails every
  tool with `protocol_mismatch` until the package is reloaded. That is the intended behavior
  (invariant 6); the README troubleshooting entry for `protocol_mismatch` already says to reload.
- **PROTOCOL.md examples** show version 1 in the handshake sample while the constant says 2;
  update the sample while editing the version text so the document doesn't contradict itself.
