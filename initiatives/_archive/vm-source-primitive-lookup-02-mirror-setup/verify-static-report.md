# Static verify report — vm-source-primitive-lookup-02-mirror-setup
Date: 2026-10-18

Invariant 1 — `setup_vm_mirror()` takes no parameters and makes sure the shared VM mirror exists
  Static: covered — mcp-bridge/server/src/vmSource/tools.test.ts:15 (wired: mcp-bridge/server/src/tools.test.ts:224)

Invariant 2 — The shared mirror is in one of three states: missing, initializing or ready
  Static: covered — mcp-bridge/server/src/vmSource/mirror.test.ts:37 (also :49, :62)

Invariant 3 — `setup_vm_mirror` returns immediately; `ready` / `in_progress` / `started`
  Static: covered — mcp-bridge/server/src/vmSource/mirror.test.ts:145 (also :159, :228)

Invariant 4 — Concurrent calls start at most one clone; every other caller gets `in_progress`
  Static: covered — mcp-bridge/server/src/vmSource/mirror.test.ts:245 (cross-process holder only via `mirrorState`, :95)

Invariant 5 — An interrupted clone is discarded and restarted, even under PID reuse
  Static: covered — mcp-bridge/server/src/vmSource/mirror.test.ts:282 (also :95, :122, :310)

Invariant 6 — `get_vm_source` and `setup_vm_mirror` are the only tools that make network calls
  Static: covered — mcp-bridge/server/src/vmSource/mirror.test.ts:159 (also :145; "no other tool" is a review check)

Invariant 7 — `get_vm_source` and `setup_vm_mirror` never use the Cuis-side connection
  Static: covered — mcp-bridge/server/src/tools.test.ts:224

Invariant 8 — The only writes are the mirror setup/fetch, confined to `~/.cuis-mcp-bridge/`
  Static: covered — mcp-bridge/server/src/vmSource/mirror.test.ts:328

Invariant 9 — The mirror is a bare repository; no working tree, checkout or `HEAD` move
  Static: covered — mcp-bridge/server/src/vmSource/mirror.test.ts:175 (exact git arguments at :159)

Invariant 10 — No tool reads from or writes to a project-local `opensmalltalk-vm/` checkout
  Static: covered — mcp-bridge/server/src/vmSource/mirror.test.ts:355

Invariant 11 — The mirror isn't tied to one project; other projects share it
  Static: covered — mcp-bridge/server/src/vmSource/mirror.test.ts:374 (default home: mcp-bridge/server/src/vmSource/tools.test.ts:58)

11 invariants — 11 covered, 0 uncovered
