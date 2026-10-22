# Dynamic verify report — vm-source-primitive-lookup-03-source-lookup
Date: 2026-10-21

Setup: `~/.cuis-mcp-bridge` was deleted before the run, so the mirror was cloned fresh from GitHub. The run recipe `run-cuis-mcp-bridge` launched a disposable Cuis server on 6790. The live VM reported `Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3738] 7.20260327.1636`, `Mac OS`, `aarch64`, plus its loaded-module stamps. `get_vm_source` and `setup_vm_mirror` were exercised through the real Node MCP server (`node dist/index.js`, freshly built) over stdio, using a scratch MCP client. Invariants 15, 16, 19 and 20 also used scratch homes: a `HOME` override, a `--shared` clone of the real mirror with `origin` set to the GitHub URL, and `url.insteadOf` redirecting that URL to a dead path or to the local mirror. Fetch counts come from `GIT_TRACE2_EVENT` traces.

Recipe drift found: `.claude/skills/run-cuis-mcp-bridge/driver.mjs` has `PROTOCOL_VERSION = 2`, but the server expects 3 ("protocol version mismatch: expected 3, got 2"). A patched scratch copy was used. The recipe itself was not modified.

Invariant 1 — `get_vm_source(vmVersion, lookupKey, module?, platformName?, platformSubtype?, moduleStamps?)` returns one VM function as JSON
  Dynamic: pass. tools/list shows exactly these 6 inputs (vmVersion and lookupKey required, no path input), and a SocketPlugin lookup returned the JSON keys function, generatedFrom, helpers, externalCalls, metadata and caveats.

Invariant 2 — The caller passes every `get_vm_source` input unprocessed
  Dynamic: pass. The raw vmVersion, build suffix included, resolved. lookupKey `1` (a number) returned primitiveAdd from table slot 1, and `"1"` (a string) returned `symbol_not_found: no exports row for '1'`. The live moduleStamps object from get_loaded_modules was accepted as is.

Invariant 3 — Which platform parameters `get_vm_source` requires depends on `module`
  Dynamic: pass. An ordinary plugin succeeded with no platform parameters, and also with junk `BeOS`/`m68k`, giving an identical result. SqueakFFIPrims without platformName, or without platformSubtype, failed and named the missing parameter. With module omitted, a missing platformSubtype failed, while a missing platformName succeeded (plain rendering).

Invariant 4 — `get_vm_source` doesn't require any Cuis-side tool to have been called first
  Dynamic: pass. In a fresh server process, `get_vm_source` was the first call and succeeded, while the server's Cuis endpoint 127.0.0.1:6789 was unreachable (a `get_vm_version` call in the same process returned `unreachable: connect ECONNREFUSED`).

Invariant 5 — No tool calls another
  Dynamic: pass. `get_vm_source` on an empty home returned `mirror_missing` naming setup_vm_mirror and created nothing, so it never invoked setup_vm_mirror. It worked with Cuis unreachable, so it never invoked a Cuis tool. The live description gives the caller-driven call order and the "mirror_missing → setup_vm_mirror, retry" step.

Invariant 6 — A successful `get_vm_source` response contains function, generatedFrom, helpers, externalCalls, metadata, caveats
  Dynamic: pass. function starts with the generated `/* SocketPlugin>>#primitiveSocketReceiveDataAvailable: */` comment. helpers are listed (e.g. primitiveCalloutWithArgs → 7 helpers). externalCalls are present. metadata carries the commit, path, lines, dispatch (exports row or table slot) and defaults. caveats is empty for a plain plugin and lists each default and warning otherwise. The live description says to state every caveat and never present a defaulted source as exact.

Invariant 7 — A response never contains a whole file, and its source never comes from a working tree
  Dynamic: pass. Run from a cwd holding a git working tree with a sentinel `src/plugins/SocketPlugin/SocketPlugin.c`, the response had no sentinel. It was 1,491 bytes against the 71,140-byte file, and `function` equals lines 1794–1821 of `git show 759d8f20:src/plugins/SocketPlugin/SocketPlugin.c`.

Invariant 8 — An undetermined build variant returns the `cog` variant, and the metadata says so
  Dynamic: pass. Numbered lookup 1 read `src/spur64.cog/cointerp.c`, with `defaults` holding `cog_variant` and the build-variant caveat.

Invariant 9 — For a lookup with `module` omitted: plain rendering without `platformName`, actual rendering with it
  Dynamic: pass. Without platformName: `cointerp.c`, `rendering: plain`, a `plain_rendering` default and its caveat. With `Mac OS`: `gcc3x-cointerp.c`, `rendering: gcc3x`, and no plain-rendering default.

Invariant 10 — A `SqueakFFIPrims` lookup returns the function from the architecture-specific FFI source
  Dynamic: pass. `Mac OS`/`aarch64` gave path `src/plugins/SqueakFFIPrims/ARM64AppleFFIPlugin.c` (primitiveCalloutWithArgs, lines 2794–3448).

Invariant 11 — When `moduleStamps` is given on a lookup with `module`, the metadata includes `moduleStampCheck`
  Dynamic: pass. Using the live VM's stamps:
  - SocketPlugin → `match`.
  - The same stamps with SocketPlugin altered to .3700 → `mismatch`, with both stamps and a caveat, and still a success.
  - Mpeg3Plugin (not reported by the VM) → `not_verifiable` with a caveat.
  - FT2Plugin (older multi-line stamp form) → `match`.
  - moduleStampCheck is absent without moduleStamps, and also when module is omitted but moduleStamps is given.

Invariant 12 — For a numbered primitive served by a shared dispatcher, `function` is that dispatcher
  Dynamic: pass. 256 → `externalQuickPrimitiveResponse`, shared `{reason: quick_primitive, applies: "quick primitive 256: return self"}`. 117 → `primitiveExternalCall`, shared `{reason: external_call, …}`. Each has a shared-dispatcher caveat.

Invariant 13 — `get_vm_source` resolves the `VMMaker.oscog-eem.<N>` token to the Cog commit that introduced it
  Dynamic: pass. Every lookup resolved `759d8f204b9c7f2e4e69a138a55d96209ec2d552`, the first Cog commit whose interpreter source carries `VMMaker.oscog-eem.3738]` (independently checked with `git log -S`). Its title reads "CogVM source as per VMMaker.oscog-eem.3739", a real case of a title naming a different revision.

Invariant 14 — The same inputs give the same response on every call
  Dynamic: pass. 8 lookups gave byte-identical responses across 4 runs: 2 sequential and 2 concurrent, in 4 separate server processes with different cwds. The invariant 1–12 call sets were also byte-identical to the previous verify run's.

Invariant 15 — If the commit is already in the shared mirror, resolving it needs no network access
  Dynamic: pass. In a scratch home with upstream redirected to `/nonexistent/upstream.git`, the .3738 lookup succeeded (759d8f20). An absent token (.99999) failed with git's "'/nonexistent/upstream.git' does not appear to be a git repository", which proves the redirect was active.

Invariant 16 — If it isn't, `get_vm_source` fetches from upstream first and then resolves
  Dynamic: pass. In a scratch home with Cog rewound to `759d8f20^` (b651d85) and upstream redirected to the local mirror, the lookup ran exactly 1 fetch (Cog advanced to upstream tip c700440) and resolved 759d8f20 in 10.3 s, against about 5.3 s without a fetch. The live description says a lookup may fetch and take tens of seconds, and tells the assistant to tell the user.

Invariant 17 — `get_vm_source` never starts a clone; `mirror_missing` / `mirror_initializing`
  Dynamic: pass. On the emptied real home, the lookup returned `mirror_missing: … call setup_vm_mirror, then retry get_vm_source` and the home stayed absent (no clone). Right after setup_vm_mirror returned `started`, the lookup returned `mirror_initializing`.

Invariant 18 — A half-finished clone is never treated as ready
  Dynamic: pass. During the real GitHub clone, all 7 polls over about 1 m 50 s returned `mirror_initializing` while the home held `vm-mirror.lock` and `vm-mirror.tmp-97630`. The lookup succeeded only once `vm-mirror` alone remained.

Invariant 19 — When concurrent calls need to fetch into the mirror at once: shared in-process fetch, else `mirror_busy` at once
  Dynamic: pass.
  - Held `refs/heads/Cog.lock` in a scratch mirror that needed a fetch: `mirror_busy: another session is fetching into the VM source mirror; try again once it has finished` after 5.0 s (one search, one fetch, no retries).
  - 4 concurrent lookups in one process, all needing a fetch: all succeeded with exactly 1 fetch.
  - 2 processes × 3 concurrent lookups into one scratch mirror: all 6 succeeded with 1 fetch per process.
  - The live description explains `mirror_busy` as another session fetching and tells the assistant to tell the user.

Invariant 20 — Concurrent `get_vm_source` calls never corrupt each other's results or the mirror
  Dynamic: pass. 8 mixed lookups run concurrently in each of 2 server processes at once equalled the sequential results, and `git fsck` on the real mirror was clean. Concurrent lookups across 2 processes, all needing a fetch into one scratch mirror, all resolved 759d8f20, and every scratch mirror passed `fsck`.

20 invariants — 20 passed, 0 failed, 0 skipped
