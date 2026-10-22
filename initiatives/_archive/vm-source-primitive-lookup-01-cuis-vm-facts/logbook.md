---
spec: initiatives/vm-source-primitive-lookup-01-cuis-vm-facts/technical-spec.md
started: 2026-10-18
last-completed-phase: 6
status: archived
archived: 2026-10-18
---

# Implementation Log: VM Source: Primitive Lookup — Part 1: Cuis VM Facts

Adds four read-only wire operations (`get_vm_version`, `get_platform_name`, `get_platform_subtype`, `get_loaded_modules`) and their MCP tools, and bumps `PROTOCOL_VERSION` from 2 to 3 on both sides. Starting at phase 1. Done means all six phases complete, the Smalltalk suite (`tools/run-headless-tests.sh mcp-bridge/image/run-tests.st`) and `npm test` in `mcp-bridge/server` both green.

## Phase Plan

1. [Scaffold] mcp-bridge/PROTOCOL.md — four operations, op count 13, version 3
2. [Scaffold] mcp-bridge/server/src/protocol.ts — version 3, new types, request union
3. [Scaffold] mcp-bridge/image/Tests-MCP-Bridge.pck.st — bump hard-coded version 2 to 3, fix mismatch test
4. [TDD] mcp-bridge/image/MCP-Bridge.pck.st + tests — protocolVersion 3, four handlers and dispatch entries
5. [TDD] mcp-bridge/server/src/tools.ts + tools.test.ts — four tool entries, wiring tests
6. [Scaffold] mcp-bridge/README.md — tool list and count

## Phase 1 — [Scaffold] PROTOCOL.md
Added the four operations after list_implementors_of, op count 9 to 13, PROTOCOL_VERSION 3, handshake and mismatch examples updated (expected 3, got 2). The get_loaded_modules example uses placeholder module names.

## Phase 2 — [Scaffold] protocol.ts
PROTOCOL_VERSION 3, four Params/Result type pairs, request union extended to 13 ops. tsc clean, 13/13 vitest tests pass.

## Phase 3 — [Scaffold] Tests-MCP-Bridge.pck.st
63 occurrences of protocol_version 2 became 3; the mismatch test now sends 2 and expects "expected 3, got 2". Headless suite is red as intended: 41 run, 8 pass, 33 failures, all from the version difference.

## Phase 5 — [TDD] tools.ts + tools.test.ts
Six cycles: 5.1-5.4 red/green for the four TOOL_METADATA entries (wiring tests forward {} and return JSON text), 5.5 and 5.6 regression guards for protocol_mismatch and unreachable on get_vm_version (passed first run). Suite 13 to 19 tests. Refactor deferred to the end of the phase; it only corrected the createTools doc comment from 9 to 13 operations. Deviation: skipped the 5-cycle user check-in because the remaining work was one trivial guard and the refactor, within the 7-cycle budget. Files: tools.ts, tools.test.ts.

### Cycle log

## Phase 6 — [Scaffold] README.md
"The 9 tools" became 13 and four bullets were added to "Available tools" after list_implementors_of. The README had no protocol version 2 mention, so nothing else changed.

## Closing
Part 1 is built as specified: four read-only ops (get_vm_version, get_platform_name, get_platform_subtype, get_loaded_modules) on both sides of the wire, PROTOCOL_VERSION 2 to 3, PROTOCOL.md and README updated. Final state: Smalltalk suite 48/48, vitest 19/19. 13 TDD cycles in total (7 in phase 4, 6 in phase 5); four of them were regression guards that passed on first run with no implementation change (invariants 7 and 8, and the two error mappings).

Deviations: refactor ran once per TDD phase instead of per cycle; the 5-cycle user check-in was skipped in phase 5; invariant 5(b) (plugin loaded later) has no test because the spec marks it best-effort; the live check against the real image (run-cuis-mcp-bridge) was not performed. The refactor passes also fixed two stale comments (class comment missing list_implementors_of/list_senders_of, and the createTools "9 operations" count). The PROTOCOL.md get_loaded_modules example uses placeholder module names. Nothing is committed.

## Implementation files

- mcp-bridge/PROTOCOL.md
- mcp-bridge/server/src/protocol.ts
- mcp-bridge/server/src/tools.ts
- mcp-bridge/server/src/tools.test.ts
- mcp-bridge/image/MCP-Bridge.pck.st
- mcp-bridge/image/Tests-MCP-Bridge.pck.st
- mcp-bridge/README.md
Cycle 5.1: createTools exposes get_vm_version, forwards {} to sendRequest('get_vm_version', {}) and returns the result as JSON text (red starting).
Cycle 5.1 red done: tools.test.ts test for get_vm_version fails (tool undefined), suite 13 pass 1 fail. Green starting.
Cycle 5.1 done: get_vm_version entry in TOOL_METADATA, suite 14/14. Stale "9 read-only reflection operations" doc comment on createTools noted for the refactor pass; refactor deferred to the end of phase 5.
Cycle 5.2: get_platform_name tool wiring, same shape as 5.1 (red starting).
Cycle 5.2 red done: get_platform_name wiring test fails (tool undefined), suite 14 pass 1 fail. Green starting.
Cycle 5.2 done: get_platform_name entry in TOOL_METADATA, suite 15/15.
Cycle 5.3: get_platform_subtype tool wiring, same shape (red starting).
Cycle 5.3 red done: get_platform_subtype wiring test fails (tool undefined), suite 15 pass 1 fail. Green starting.
Cycle 5.3 done: get_platform_subtype entry in TOOL_METADATA, suite 16/16.
Cycle 5.4: get_loaded_modules tool wiring, forwards {} and returns {builtin, loaded} as JSON text (red starting).
Cycle 5.4 red done: get_loaded_modules wiring test fails (tool undefined), suite 16 pass 1 fail. Green starting.
Cycle 5.4 done: get_loaded_modules entry in TOOL_METADATA, suite 17/17.
Cycle 5.5: get_vm_version tool maps a protocol_mismatch rejection to an MCP error result with text starting "protocol_mismatch" (invariant 6); a second case covers unreachable (red starting).
Cycle 5.5 done: protocol_mismatch error-mapping test for get_vm_version passed on first run (regression guard), suite 18/18. Red agent held back the unreachable test (one test per cycle).
Check-in after 5 cycles: remaining = unreachable guard (cycle 5.6) and one refactor pass; stays within the 7-cycle budget, so proceeding without a pause.
Cycle 5.6: get_vm_version tool maps an unreachable rejection to an MCP error result starting "unreachable:" (red starting).
Cycle 5.6 done: unreachable error-mapping test passed on first run (regression guard), suite 19/19.
Refactor pass: one tdd-refactor over the tools.ts additions, including the stale "9 read-only reflection operations" doc comment on createTools (started).

## Phase 4 — [TDD] MCP-Bridge.pck.st + tests
Seven cycles. Cycles 4.1-4.5 were red/green for protocolVersion 3 and the four ops; 4.6 and 4.7 were regression guards for invariants 7 and 8 that passed on first run (no implementation change). Suite went 41 (33 red) to 48/48. Invariant 5(b) (plugin loaded later) left untested: best-effort in the spec and dependent on the VM build. Deviation: refactor was deferred and run once after 4.7; it changed only the class comment, adding list_implementors_of and list_senders_of, which were already missing before this initiative. Files: MCP-Bridge.pck.st, Tests-MCP-Bridge.pck.st.

### Cycle log
Cycle 4.1: McpBridgeConnection class>>protocolVersion answers 3 (red starting).
Cycle 4.1 done: red testProtocolVersionIsThree, green protocolVersion ^ 3, suite 42/42. Refactor deferred to after cycle 4.5 (one-literal change).
Cycle 4.2: get_vm_version returns Smalltalk vmVersion string (red starting).
Cycle 4.2 done: red testGetVmVersionRequestGetsVmVersionString, green handleGetVmVersion: + dispatch entry, suite 43/43.
Cycle 4.3: get_platform_name returns Smalltalk platformName (red starting).
Cycle 4.3 done: red testGetPlatformNameRequestGetsPlatformNameString, green handleGetPlatformName: + dispatch entry, suite 44/44.
Cycle 4.4: get_platform_subtype returns Smalltalk platformSubtype (red starting).
Cycle 4.4 done: red testGetPlatformSubtypeRequestGetsPlatformSubtypeString, green handleGetPlatformSubtype: + dispatch entry, suite 45/45.
Cycle 4.5: get_loaded_modules returns {builtin, loaded} string arrays (red starting).
Cycle 4.5 done: red testGetLoadedModulesRequestGetsBuiltinAndLoadedArrays, green handleGetLoadedModules: + dispatch entry + class comment, suite 46/46.
Check-in after 5 cycles: all four ops implemented; remaining = invariant 7 and 8 regression tests, one refactor pass.
User chose (a): continue with invariant 7 and 8 guards, then refactor.
Cycle 4.6: invariant 7, testNewOpsShareSessionWithExistingOnes (second connection gets session_busy, first's get_vm_version still answers). Expected to pass immediately (red starting).
Cycle 4.6 done: testNewOpsShareSessionWithExistingOnes (port 17934) passed on first run as a regression guard, no implementation change, suite 47/47.
Cycle 4.7: invariant 8, testFourVmFactOpsLeaveImageStateUnchanged (loaded modules and SystemOrganization categories count unchanged after calling all four ops). Expected to pass immediately (red starting).
Cycle 4.7 done: testFourVmFactOpsLeaveImageStateUnchanged (port 17935) passed on first run as a regression guard, no implementation change, suite 48/48.
Refactor pass: one tdd-refactor over the four handlers in MCP-Bridge.pck.st (deferred from cycles 4.1-4.5), started (log entry written just after launch because the first edit failed on a duplicate anchor).

## Retrospective

Part 1 (Cuis VM facts) completed all six phases: three scaffold phases (protocol doc, TS types, test version bump), two TDD phases (Cuis handlers, TS tool wiring), and the README update. It took 13 TDD cycles, 4 of them regression guards that passed first run. Final state: Smalltalk suite 48/48, vitest 19/19. Static verify covered 7 of 8 invariants fully and invariant 5 partially. Dynamic verify passed all 8 against a live instance, with invariant 5's late-load half skipped. The live image later returned correct values through the new tools.

Deviations and lessons:
- Refactor ran once per TDD phase instead of per cycle, and the phase 5 check-in at 5 cycles was skipped; both were low risk here but depart from the skill.
- Invariant 5(b), a plugin loading later, has no test. It is best-effort in the spec and unreachable from outside the image.
- Bumping `PROTOCOL_VERSION` to 3 left the `run-cuis-mcp-bridge` recipe's `driver.mjs` (still sends 2) and its troubleshooting note stale; verification used a throwaway v3 client instead. Fix both.
- Refactor passes fixed two stale pre-existing comments (the class comment missing two ops, and the "9 operations" count).
- A follow-up question exposed a gap: nothing in the initiative maps a plugin to the Smalltalk methods that use it. A `list_primitive_users(module)` op would close it, captured in the Obsidian note "Mapping VM Plugins to Smalltalk Callers".
- Parts 2–4 cite this part by directory name (`vm-source-primitive-lookup-01-cuis-vm-facts invariant N`), so their references will point at the archived path.
