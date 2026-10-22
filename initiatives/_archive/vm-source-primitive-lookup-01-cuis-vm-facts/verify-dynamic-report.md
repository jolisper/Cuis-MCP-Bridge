# Dynamic verify report — vm-source-primitive-lookup-01-cuis-vm-facts
Date: 2026-10-18

Run: disposable headless instance on 127.0.0.1:6790 (recipe run-cuis-mcp-bridge), driven with a throwaway protocol-3 client because the recipe's driver.mjs still sends protocol_version 2 (recipe not modified). Dev session on 6789 untouched.

Invariant 1 — `get_vm_version` returns the running image's `Smalltalk vmVersion` string
  Dynamic: pass — returned "Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3738] 7.20260327.1636"

Invariant 2 — `get_platform_name` returns the running image's `Smalltalk platformName` string
  Dynamic: pass — returned "Mac OS"

Invariant 3 — `get_platform_subtype` returns the running image's `Smalltalk platformSubtype` string
  Dynamic: pass — returned "aarch64"

Invariant 4 — `get_loaded_modules` returns the plugin stamps as `builtin` and `loaded` string arrays
  Dynamic: pass — 35 builtin and 8 loaded stamps, every one keeping its (i)/(e) suffix, e.g. "ADPCMCodecPlugin VMMaker.oscog-eem.3739 (i)", unsorted as reported

Invariant 5 — each tool reflects the VM's state at call time and depends on no other call; a later-loading plugin appears in a later call
  Dynamic: pass (stand-alone half) — each op answered as the first request after the handshake on its own connection; repeated get_loaded_modules calls agreed. skip — late-load half: no external way to make the headless VM load a new plugin, so not exercised

Invariant 6 — no network calls; only `unreachable` / `protocol_mismatch`; an old package fails with `protocol_mismatch`, never `invalid_request`
  Dynamic: pass — an old client (protocol 2) got `protocol_mismatch` "expected 3, got 2" on the handshake, not `invalid_request`; with the server stopped the driver got ECONNREFUSED (the unreachable condition). "No network calls" not observable from outside (holds by construction)

Invariant 7 — shares the single active session; a concurrent caller gets `session_busy`
  Dynamic: pass — with connection A handshaken, connection B got `session_busy`, and A's `get_vm_version` still answered

Invariant 8 — read-only, no side effects on the image
  Dynamic: pass — after calling all four ops, list_categories count stayed 67 and builtin/loaded module lists were identical

8 invariants — 8 passed (invariant 5 partly: late-load half skipped), 0 failed, 0 skipped
