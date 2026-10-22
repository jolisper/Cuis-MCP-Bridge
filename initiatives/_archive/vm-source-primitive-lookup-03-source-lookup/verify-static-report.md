# Static verify report — vm-source-primitive-lookup-03-source-lookup
Date: 2026-10-21

Test files (from logbook Implementation files): mcp-bridge/server/src/vmSource/{getVmSource,resolveCommit,lookupPlan,cSource,git,tools}.test.ts, mcp-bridge/server/src/tools.test.ts, mcp-bridge/server/src/vmSource/testSupport/{harness,fixtures}.test.ts

Invariant 1 — `get_vm_source(vmVersion, lookupKey, module?, platformName?, platformSubtype?, moduleStamps?)` returns one VM function as JSON
  Static: covered — mcp-bridge/server/src/vmSource/tools.test.ts:28 (schema has no path-like input), :139 (handler returns JSON); getVmSource.test.ts:141

Invariant 2 — The caller passes every `get_vm_source` input unprocessed
  Static: covered — mcp-bridge/server/src/vmSource/lookupPlan.test.ts:28 (only a JSON number is numbered); getVmSource.test.ts:258 ("1" → symbol_not_found; vmVersion with build suffix throughout)

Invariant 3 — Which platform parameters `get_vm_source` requires depends on `module`
  Static: covered — mcp-bridge/server/src/vmSource/lookupPlan.test.ts:192 (module omitted, incl. Cog[SqueakV3] subtype), :243 (SqueakFFIPrims), :6; getVmSource.test.ts:258 (junk platform ignored for an ordinary plugin)

Invariant 4 — `get_vm_source` doesn't require any Cuis-side tool to have been called first
  Static: covered — mcp-bridge/server/src/tools.test.ts:266 (first and only call while Cuis is unreachable)

Invariant 5 — No tool calls another
  Static: covered — mcp-bridge/server/src/tools.test.ts:225, :266 (neither touches the Cuis connection); getVmSource.test.ts:379 (never starts a clone); vmSource/tools.test.ts:51 (description gives the call order)

Invariant 6 — A successful `get_vm_source` response contains function, generatedFrom, helpers, externalCalls, metadata, caveats
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:141 (function, generatedFrom, commit, path, lines, dispatch), :164 (helpers, externalCalls, empty caveats), :184 (defaults + caveats); vmSource/tools.test.ts:51 (description tells the assistant to state caveats)

Invariant 7 — A response never contains a whole file, and its source never comes from a working tree
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:434 (response smaller than the file, cwd sentinel ignored, git only `rev-parse Cog` / `log` / `show <sha>:src/…`)

Invariant 8 — An undetermined build variant returns the `cog` variant, and the metadata says so
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:184; lookupPlan.test.ts:67

Invariant 9 — For a lookup with `module` omitted: plain rendering without `platformName`, actual rendering with it
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:184 (plain + caveat), :209 (gcc3x); lookupPlan.test.ts:88, :135

Invariant 10 — A `SqueakFFIPrims` lookup returns the function from the architecture-specific FFI source
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:258 (Apple file, not the decoys); lookupPlan.test.ts:157

Invariant 11 — When `moduleStamps` is given on a lookup with `module`, the metadata includes `moduleStampCheck`
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:316 (match / mismatch / not_verifiable / absent without moduleStamps), :359 (no stamp in file). Gap: no test that `moduleStampCheck` is absent when `module` is omitted but `moduleStamps` is given.

Invariant 12 — For a numbered primitive served by a shared dispatcher, `function` is that dispatcher
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:233 (slots 256 and 117, shared metadata + caveat)

Invariant 13 — `get_vm_source` resolves the `VMMaker.oscog-eem.<N>` token to the Cog commit that introduced it
  Static: covered — mcp-bridge/server/src/vmSource/resolveCommit.test.ts:33 (fixture at :20 has a title naming .3739 over .3738 source; near-miss .37380 excluded)

Invariant 14 — The same inputs give the same response on every call
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:434 (byte-identical after an upstream change and across two services)

Invariant 15 — If the commit is already in the shared mirror, resolving it needs no network access
  Static: covered — mcp-bridge/server/src/vmSource/resolveCommit.test.ts:33 (`rev-parse Cog` and one pickaxe log, no fetch)

Invariant 16 — If it isn't, `get_vm_source` fetches from upstream first and then resolves
  Static: covered — mcp-bridge/server/src/vmSource/resolveCommit.test.ts:58 (one fetch, then pickaxe), :129 (absent token fails after one fetch); vmSource/tools.test.ts:74 (description tells the assistant to tell the user a call may be fetching)

Invariant 17 — `get_vm_source` never starts a clone; `mirror_missing` / `mirror_initializing`
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:379

Invariant 18 — A half-finished clone is never treated as ready
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:379 (mirror_initializing during a gated clone, success only after it completes)

Invariant 19 — When concurrent calls need to fetch into the mirror at once: shared in-process fetch, else `mirror_busy` at once
  Static: covered — mcp-bridge/server/src/vmSource/resolveCommit.test.ts:204 (4 concurrent calls, one fetch), :229 (Cog moved by another fetch → no fetch of its own), :100 (held Cog.lock → mirror_busy, one fetch, no retry); vmSource/tools.test.ts:74 (description: mirror_busy means another session is fetching, tell the user)

Invariant 20 — Concurrent `get_vm_source` calls never corrupt each other's results or the mirror
  Static: covered — mcp-bridge/server/src/vmSource/getVmSource.test.ts:434 (8 mixed concurrent lookups across two services equal sequential); resolveCommit.test.ts:150 (concurrent resolves agree, mirror passes fsck)

20 invariants — 20 covered, 0 uncovered
