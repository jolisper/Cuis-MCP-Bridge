# Static verify report — vm-source-primitive-lookup-01-cuis-vm-facts
Date: 2026-10-18

Invariant 1 — `get_vm_version` returns the running image's `Smalltalk vmVersion` string
  Static: covered — mcp-bridge/image/Tests-MCP-Bridge.pck.st:281 (testGetVmVersionRequestGetsVmVersionString); tool wiring mcp-bridge/server/src/tools.test.ts:65

Invariant 2 — `get_platform_name` returns the running image's `Smalltalk platformName` string
  Static: covered — mcp-bridge/image/Tests-MCP-Bridge.pck.st:308; tool wiring tools.test.ts:87

Invariant 3 — `get_platform_subtype` returns the running image's `Smalltalk platformSubtype` string
  Static: covered — mcp-bridge/image/Tests-MCP-Bridge.pck.st:334; tool wiring tools.test.ts:109

Invariant 4 — `get_loaded_modules` returns `builtin` and `loaded` string arrays as the VM reports them
  Static: covered — mcp-bridge/image/Tests-MCP-Bridge.pck.st:360; tool wiring tools.test.ts:131

Invariant 5 — each tool reflects the VM's state at call time, depends on no other call; a late-loading plugin appears in a later call
  Static: partial — each op test at Tests-MCP-Bridge.pck.st:281/308/334/360 is the first request after the handshake (stand-alone call); no test that a plugin loaded after a `get_loaded_modules` call appears in a later call (testGetLoadedModulesReflectsLaterLoads was skipped as best-effort)

Invariant 6 — no network calls; only `unreachable` / `protocol_mismatch`; an old package fails with `protocol_mismatch`, never `invalid_request`
  Static: covered — Tests-MCP-Bridge.pck.st:166 (old client sends version 2, gets protocol_mismatch "expected 3, got 2"); tools.test.ts:176 (protocol_mismatch) and :196 (unreachable). "No network calls" holds by construction, no test.

Invariant 7 — shares the single active session; a concurrent caller gets `session_busy`
  Static: covered — mcp-bridge/image/Tests-MCP-Bridge.pck.st:393 (testNewOpsShareSessionWithExistingOnes)

Invariant 8 — read-only, no side effects on the image
  Static: covered — mcp-bridge/image/Tests-MCP-Bridge.pck.st:425 (testFourVmFactOpsLeaveImageStateUnchanged)

8 invariants — 7 covered, 1 partial (invariant 5: late-load half uncovered), 0 fully uncovered
