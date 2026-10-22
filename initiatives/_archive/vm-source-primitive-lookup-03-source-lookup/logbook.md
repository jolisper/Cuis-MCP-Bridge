---
spec: initiatives/vm-source-primitive-lookup-03-source-lookup/technical-spec.md
started: 2026-10-20
last-completed-phase: 10
status: archived
archived: 2026-10-22
---

# Implementation Log: VM Source Primitive Lookup — Part 3: Source Lookup

This log covers adding the `get_vm_source` host-side MCP tool to `mcp-bridge/server/src/vmSource/`,
on top of the part-2 mirror. The work runs in 10 phases, from phase 1. Scaffolding phases cover
the error type, the test fixtures and harness extensions, and the docs. TDD phases cover the git
runner, the lookup plan, the C source parser, commit resolution, orchestration and tool wiring.
"Done" means every phase is complete, `npm test` in `mcp-bridge/server` is green (the existing
`mirror.test.ts`/`tools.test.ts` suites included), and functional invariants 1–20 are covered as
listed in the technical spec's test table. Cycle budget: doubled at the user's request
(check-in after 10 cycles, stop after 14).

## Phase Plan

1. [Scaffold] `vmSource/errors.ts` — `VmSourceError`, part-3 code union
2. [TDD]      `vmSource/git.ts` — `runGit`, `isLockContention`; export `mirrorPath` from `mirror.ts`
3. [Scaffold] `testSupport/fixtures.ts` builders + `testSupport/excerpts/` verbatim upstream excerpts
4. [Scaffold] `testSupport/harness.ts` — `pushUpstream`, `cloneMirror`, `freshHome`
5. [TDD]      `vmSource/lookupPlan.ts` — key, token, family, path tables, defaults
6. [TDD]      `vmSource/cSource.ts` — function index, exports/primitiveTable lookup, shared dispatchers, helpers, external calls, stamp
7. [TDD]      `vmSource/resolveCommit.ts` — pickaxe, refspec fetch, lock retry with injected `sleep`
8. [TDD]      `vmSource/getVmSource.ts` — orchestration, stamp check, response, caveats
9. [TDD]      `vmSource/tools.ts` `get_vm_source` + `VmSourceOptions`; `src/tools.ts` parameter type
10. [Scaffold] `mcp-bridge/README.md` and root `README.md` — 15 tools, `get_vm_source` bullet and call order

## Phase 1 — [Scaffold] `vmSource/errors.ts`
Wrote `mcp-bridge/server/src/vmSource/errors.ts`: the `VmSourceErrorCode` union (5 part-3 codes) and
`VmSourceError(code, message)` with `name = 'VmSourceError'`. `tsc --noEmit` is clean. No deviations.

## Phase 2 — [TDD] `vmSource/git.ts`
- Cycle 2.1: `runGit` against a bare clone at `<home>/vm-mirror` resolves stdout and passes `--git-dir=<home>/vm-mirror` first.
  - done: red `git.test.ts` "runs git against the mirror dir via --git-dir…"; green `git.ts` new, `mirrorPath` exported; refactor: none.
- Cycle 2.2: a failing git command rejects with an `Error` carrying git's `stderr`.
  - done: red "rejects with an Error whose message is git trimmed stderr…"; green try/catch rethrow; refactor: JSDoc.
- Cycle 2.3: `isLockContention` true for `Unable to create '….lock'` and `cannot lock ref`, false otherwise.
  - done: red "isLockContention > recognises…"; green regex export; refactor: none.
- Cycle 2.4: child env carries `LC_ALL=C` and `GIT_TERMINAL_PROMPT=0`.
  - done: red "runs git with LC_ALL=C and GIT_TERMINAL_PROMPT=0…"; green env option; refactor: JSDoc.
- Cycle 2.5: output larger than Node's default 1 MB maxBuffer resolves in full (64 MB maxBuffer).
  - done: red "resolves stdout larger than the 1 MB default maxBuffer"; green MAX_BUFFER; refactor: none.
- Cycle 2.6: a failure with empty stderr (missing git binary) keeps Node's error text (`ENOENT`) as the message. Added because cycle 2.5's red run showed empty-stderr failures producing an empty message.
  - done: red "rejects with a non-empty message naming ENOENT…"; green fallback to original message; refactor: one typed binding, JSDoc rewrap.

Summary: 6 cycles. `git.ts` exports `runGit` (`--git-dir=<home>/vm-mirror`, env + `LC_ALL=C` +
`GIT_TERMINAL_PROMPT=0`, 64 MB maxBuffer, rejects with `Error(stderr.trim() || original message)` plus
`stderr`) and `isLockContention`. `mirror.ts` exports `mirrorPath`. 6 tests in `git.test.ts`, 56 in the
full suite. Deviation: cycle 2.6 (falling back to the original message on empty stderr) isn't in the
spec. It was added because a failure with empty stderr otherwise reaches the caller as an empty error.

## Phase 3 — [Scaffold] fixtures and excerpts
Wrote `testSupport/fixtures.ts` (`cFunction`, `coreInterp`, `plugin`, `readExcerpt`),
`testSupport/fixtures.test.ts` (5 smoke tests), and `testSupport/excerpts/cointerp-spur64.c.txt` and
`excerpts/SocketPlugin.c.txt`, taken verbatim from opensmalltalk-vm @ 3ea6bd17 (VMMaker.oscog-eem.3794).
`tsc` is clean and the suite has 61 green tests.
Upstream shapes that refine the spec (phase 6 must handle them):
- `primitiveTable` closes with ` 0 };`, not `};`.
- Function-like defines are written `# define name(` and `#\tdefine name(`. Match `^#\s*define\s+(\w+)\(`.
- The `{` line is either bare `{` or `{   DECL_MAYBE_SQ_GLOBAL_STRUCT`. "Starts with `{`" covers both.
- A plugin's `generatedFrom` is the Smalltalk selector (with colons), and the FFI files name `ThreadedFFIPlugin>>#…`.
- Return types are `static void`/`EXPORT(void)` in the core interpreter and `EXPORT(sqInt)` in plugins.
- Export rows end `},` and carry 0 or 3 escapes. Arrays end with `{NULL, NULL, NULL}` and `};`. The spec regex matches all of them.
- In FFI files the stamp and the `<X>_exports` name use the arch file name, while `_m` is `SqueakFFIPrims`.
- A plugin's `(*name)(` pointer declarations sit under `#if !defined(SQUEAK_BUILTIN_PLUGIN)`, and its `#else`
  branch declares `extern sqInt name(…)`. `interpreterProxy->` appears only in `setInterpreter`.
- In `cointerp.c`, `primitiveTable` (:2062) comes before `interpreterVersion` (:2737), which comes before the functions and then the exports.

## Phase 4 — [Scaffold] harness extensions
Added `pushUpstream(files, message)` to `testSupport/harness.ts`. It uses a persistent work clone at
`<root>/work` and real git, commits with `--cleanup=verbatim`, and returns the SHA. Also added
`cloneMirror(home?)` (a real bare clone into `<home>/vm-mirror`, not logged), `freshHome()`
(`<root>/home-<n>`, not created), and `argvMark()`/`argvSince(mark)`. 4 smoke tests in `harness.test.ts`.
The suite has 65 green tests. Limit: concurrent `pushUpstream` calls on one harness aren't serialized.

## Phase 5 — [TDD] `vmSource/lookupPlan.ts`
- Cycle 5.1: ordinary plugin lookup → token, named key, module, `src/plugins/<M>/<M>.c`, no defaults.
  - done: red "plans an ordinary plugin lookup…"; green new `lookupPlan.ts`; refactor: JSDoc.
- Cycle 5.2: number `1` → numbered key; string `"1"` → named key `1` (inv 2).
  - done: red "treats only a JSON number lookupKey as numbered…"; green typeof ternary; refactor: none.
- Cycle 5.3: module omitted, Cog[Spur], aarch64, no platformName → `src/spur64.cog/cointerp.c`, defaults cog_variant + plain_rendering, rendering plain.
  - done: red "plans the plain 64-bit Spur interpreter…"; green early return; refactor: none.
- Cycle 5.4: subtype → word size: x64/aarch64 → spur64.cog, intel/powerpc → spur32.cog.
  - done: red "maps Cog[Spur] platformSubtype…"; green dir by subtype; refactor: none.
- Cycle 5.5: platformName Mac OS/unix → `gcc3x-cointerp.c`, rendering gcc3x, defaults [cog_variant] (inv 9).
  - done: red "plans the gcc3x Spur interpreter rendering…"; green gcc3x branch (checks only presence of platformName for now); refactor: none.
- Cycle 5.6: Cog[SqueakV3] → `src/v3.cog/cointerp.c`, no cog_variant (inv 8).
  - done: red "plans the plain V3 interpreter…"; green family-tag parse; refactor: none.
- Cycle 5.7: Cog[SqueakV3] + platformName unix → `src/v3.cog/gcc3x-cointerp.c`, rendering gcc3x, defaults [].
  - done: red "plans the gcc3x V3 interpreter rendering…"; green V3 gcc3x; refactor: merged V3/Spur into family→dir then platformName→rendering.
- Cycle 5.8: SqueakFFIPrims 4-row platform table → arch-specific FFI file (inv 10).
  - done: red "maps SqueakFFIPrims…"; green FFI_PLUGIN_FILES; refactor: none.
- Cycle 5.9: core-interp/version errors → plain Error naming the value (missing/unmapped subtype, unmapped platformName, unknown family, no token).
  - done: red "throws a plain Error naming the value when module is omitted…"; green 5 throw sites; refactor: `interpreterDir` helper.
  - note: platformSubtype is checked only for Cog[Spur]. Cog[SqueakV3] ignores it (the technical spec says "each case reads only the parameters it uses"), although functional inv 3's table marks it as required whenever module is omitted.
- Cycle 5.10: FFI missing/unmapped params and an unsafe module name → plain Error. An ordinary plugin with junk platform params still succeeds (inv 3).
  - done: red "throws a plain Error naming the value when module is given…" (the junk-params guard was deferred, one test per cycle); green 4 throw sites; refactor: `pluginPath` helper.
- Check-in at cycle 10 (doubled budget). Remaining: type guards (`invalid_request`), plus the junk-param regression guard for inv 3.
- User said continue (V3 platformSubtype handling kept as-is).
- Cycle 5.11: type guards → `VmSourceError('invalid_request')` (inv 2).
  - done: red "throws VmSourceError invalid_request naming the field…"; green guards + narrowing; refactor: `interpreterDir(subtype: string|undefined)`, JSDoc on `planLookup`.

Summary: 11 cycles. `lookupPlan.ts` exports `LookupPlan` and `planLookup` and has the helpers `interpreterDir`,
`pluginPath` and `FFI_PLUGIN_FILES`. `lookupPlan.test.ts` has 35 tests, the full suite 100, and `tsc` is clean.
Deviations: (1) the inv 3 regression test for "an ordinary plugin with junk platform params succeeds" was
not added here, because it would be green from the start. Phase 8's end-to-end plugin lookup covers it.
(2) Cog[SqueakV3] doesn't require platformSubtype (see the note under 5.9). (3) A `moduleStamps` array
passes the type guard because no test covers it.

## Phase 6 — [TDD] `vmSource/cSource.ts`
- Cycle 6.1: `indexFunctions` finds one function with its generated comment: start, end, source, generatedFrom.
  - done: red "indexes a function from its generatedFrom comment line…"; green new `cSource.ts`; refactor: module JSDoc.
- Cycle 6.2: a function without a comment starts at its return-type line with no generatedFrom, the DECL brace form is recognized, and several functions per file are indexed.
  - done: red "starts an uncommented function at its return-type line…"; green optional comment; refactor: regex constants, JSDoc.
- Cycle 6.3: drift check, `indexFunctions` on the verbatim excerpts (`primitiveAdd`, `primitiveSocketReceiveDataAvailable`).
  - done: red drift check (green from the start, a characterization guard, so no green/refactor was needed).
- Cycle 6.4: `findExport` hit returns {fn, row}, on fixtures and on the excerpt rows.
  - done: red "findExport > returns the exported function and its trimmed exports row…"; green EXPORT_ROW + hit path; refactor: none.
- Cycle 6.5: `findExport` miss → VmSourceError symbol_not_found; a prefix name doesn't match.
  - done: red "findExport > throws symbol_not_found…"; green throw; refactor: message style.
- Cycle 6.6: `findTableSlot` with an identifier row → {fn, row}; drift: excerpt slot 1 → primitiveAdd. (Upstream slot 255 is empty; quick primitives start at 256.)
  - done: red "findTableSlot > returns the identifier…"; green findTableSlot identifier path, scoped to the initializer; refactor: none.
- Cycle 6.7: no row → symbol_not_found; empty slot `(void (*)(void))0` → plain Error.
  - done: red "findTableSlot > throws symbol_not_found for a missing row and a plain Error for an empty slot…"; green; refactor: none.
- Cycle 6.8: slot 117 `primitiveExternalCall` → shared external_call (inv 12).
  - done: red "findTableSlot > marks slot 117…"; green EXTERNAL_CALL_APPLIES; refactor: EXTERNAL_CALL_SLOT.
- Cycle 6.9: quick primitives 256–519 → externalQuickPrimitiveResponse + shared quick_primitive with the branch in `applies` (inv 12).
  - done: red "maps quick slot %i…" (10 rows + excerpt 256/257); green QUICK_ROW/quickResult; refactor: single-pass row classification.
- Cycle 6.10: `helpers` gives in-file callees in first-appearance order, one level, no cap; excludes the function itself and non-indexed names, and ignores comments, strings, chars and `#` lines (inv 6).
  - done: red "helpers > returns indexed callees…" (25 helpers); green helpers + calledNames; refactor: body-only scan.
- Cycle 6.11: `externalCalls` classifies non-indexed callees as vm_interface (`interpreterProxy->x(` or a `(*x)(` declaration) or platform_code_unavailable.
  - done: red "externalCalls > classifies non-indexed callees…"; green externalCalls; refactor: `ExternalCall` type.
- Cycle 6.12: `externalCalls` leaves out keywords, ALL_CAPS names, and function-like defines in all three spellings (`#define`, `# define`, `#\tdefine`).
  - done: red "externalCalls > excludes C keywords…"; green filters (keyword set limited to the 6 tested words); refactor: none.
- Cycle 6.13: `moduleStamp` reads the trimmed stamp (plugin, FFI, excerpt) and returns undefined when there is no moduleName.
  - done: red "moduleStamp > reads the trimmed moduleName stamp…"; green; refactor: module header.
  - note: `mirror.test.ts` "returns 'started'…" failed once under full-suite load (the argv log was read mid-write) and passed 3/3 when run alone. This harness timing flake predates part 3 and isn't caused by it.

Summary: 13 cycles. `cSource.ts` exports `indexFunctions`/`CFunctionEntry`, `findExport`, `findTableSlot`/`TableSlot`,
`helpers`, `externalCalls`/`ExternalCall` and `moduleStamp`. `cSource.test.ts` has 22 tests, the full suite 122, and `tsc` is clean.
Each lookup has a drift check against the verbatim excerpts, and all of them passed.
Decided shapes: `findTableSlot` → `{fn, row, shared?}`, `helpers(fn, index)` → `{name, source}[]`,
`externalCalls(fn, index, text)` → `{name, kind}[]`, `moduleStamp` → `string | undefined`.
`applies` texts: slot 117 gives "the named primitive in the method's first literal (module and function name), looked up and called at run time".
Quick primitives give "quick primitive K: return self|true|false|nil|SmallInteger K−261|instance variable K−264".
Deviations: the call scan covers only the function body (after the `{` line), so `EXPORT(sqInt)` isn't counted as a call.
The C keyword set holds only the 6 tested words (`if`, `while`, `for`, `switch`, `return`, `sizeof`).
A numeric slot outside 256–519 that isn't 0 falls through to symbol_not_found.

## Phase 7 — [TDD] `vmSource/resolveCommit.ts`
- Cycle 7.1: the pickaxe resolves a token already in the mirror to its introducing commit (by content, not title, not `.37380`), with no fetch (inv 13–15).
  - done: red "returns the commit whose cointerp.c introduced the token…"; green new resolveCommit.ts; refactor: `pickaxe` helper.
- Cycle 7.2: a token only upstream → one refspec fetch, then resolved (inv 16).
  - done: red "fetches Cog once and re-runs the pickaxe…"; green; refactor: none.
- Cycle 7.3: a token found nowhere → plain Error after exactly one fetch (inv 16).
  - done: red "rejects with a plain Error naming the token when no Cog commit carries it…"; green; refactor: none.
- Cycle 7.4: lock contention retries with sleep and a pickaxe before each re-fetch, and succeeds after 2 sleeps [500, 700] (inv 19).
  - done: red "retries a lock-contended fetch after sleeping 500 then 700 ms…"; green retry loop; refactor: LOCK_RETRY_DELAYS_MS.
- Cycle 7.5: a lock held forever → 5 sleeps, 6 fetches, then VmSourceError mirror_busy (inv 19).
  - done: red "rejects with mirror_busy after the sixth lock-contended fetch…"; green; refactor: `fetchCogAndPickaxe`, JSDoc.
- Cycle 7.6: characterization of the lost race (no second fetch), a non-lock fetch failure (plain Error with stderr), and 4 concurrent resolves with fsck clean (inv 19, 20).
  - done: characterization test for the lost race, non-lock failure and 4 concurrent calls (green from the start).

Summary: 6 cycles. `resolveCommit.ts` exports `VmSourceOptions` and `resolveCommit`, with private `pickaxe` and
`fetchCogAndPickaxe`. `resolveCommit.test.ts` has 6 tests. The real-lock tests plant `vm-mirror/refs/heads/Cog.lock`.
No deviations from the spec. The `mirror_busy` message is "the VM source mirror is busy with another fetch; try again".

## Phase 8 — [TDD] `vmSource/getVmSource.ts`
- Cycle 8.1: an end-to-end plugin lookup returns function, generatedFrom, commit, path, lines, exports dispatch and empty defaults (inv 1, 6).
  - done: red "returns a named plugin primitive with its exports-row dispatch…"; green new getVmSource.ts; refactor: none.
- Cycle 8.2: helpers and externalCalls in the response; caveats [] for an exact plugin lookup (inv 6).
  - done: red "lists the in-file helpers and the external calls…"; green; refactor: none.
- Cycle 8.3: a numbered core lookup → primitiveTable dispatch, defaults, rendering plain, and 2 caveats (inv 8, 9).
  - done: red "returns a numbered core primitive with its table-row dispatch…"; green; refactor: caveat constants.
- Cycle 8.4: platformName Mac OS → reads gcc3x-cointerp.c (different content), rendering gcc3x, no rendering caveat (inv 9).
  - done: red "returns the gcc3x rendering…" (green from the start, a regression guard for inv 9; no green/refactor).
- Cycle 8.5: shared dispatchers (slots 256 and 117) → metadata.shared + shared caveat as the 3rd item (inv 12).
  - done: red "returns the shared dispatcher for primitive %i…" (256, 117); green; refactor: `dispatchFor` helper.
- Cycle 8.6: moduleStampCheck match / mismatch (+caveat) / not_verifiable (+caveat), absent without moduleStamps (inv 11).
  - done: red "checks the plugin module stamp against moduleStamps (%s)"; green stampCheck; refactor: ModuleStamps type.
- Cycle 8.7: mirror_missing / mirror_initializing / success after the clone completes; type guards run before the mirror check (inv 17, 18).
  - done: red "refuses with mirror_missing / mirror_initializing…"; green `checkArgTypes` (lookupPlan) + mirrorState step; refactor: `requireReadyMirror`, JSDoc.
- Cycle 8.8: end-to-end FFI with decoys (inv 10), "1" → symbol_not_found (inv 2), plugin with junk platform params (inv 3).
  - done: characterization test for inv 2, 3 and 10 (green from the start).
- Cycle 8.9: inv 7/14/20 characterization: size, argv, cwd sentinel, later commit, byte-identical output, 8 concurrent mixed calls.
  - done: characterization test for inv 7/14/20 (green from the start); final refactor: explicit symbol_not_found when the dispatch fn has no definition, type aliases grouped.

Summary: 9 cycles. `getVmSource.ts` exports `VmSourceResult` and `getVmSource`, with private `requireReadyMirror`,
`dispatchFor`, `stampCheck` and the caveat constants. `lookupPlan.ts` gained an exported `checkArgTypes`, so the
guards can run before the mirror check. `getVmSource.test.ts` has 13 tests, the full suite 141, and `tsc` is clean.
Deviations / notes:
- The final refactor added a `symbol_not_found` throw for "dispatch fn has no definition in the file" (the spec calls for it). No test covers it.
- `stampCheck` assumes the module file has a `moduleName` stamp (`moduleStamp(text)!`). Every plugin file has one; the spec doesn't cover a missing stamp.
- The SocketPlugin fixture carries 2000 padding lines so the inv 7 size check means something.
- Caveat sentences follow the fixed templates recorded in this phase.

## Phase 9 — [TDD] `vmSource/tools.ts` get_vm_source + `src/tools.ts`
- Cycle 9.1: `createVmSourceTools` lists [setup_vm_mirror, get_vm_source] with a six-property schema, required vmVersion and lookupKey, and lookupKey typed string|number (inv 1).
  - done: red (2 tests in vmSource/tools.test.ts); green definition + stub handler; the `src/tools.test.ts` tool-list expectation was updated to include get_vm_source (spec-driven); refactor skipped.
- Cycle 9.2: the handler returns JSON.stringify(getVmSource(...)); options widen to Partial<VmSourceOptions> with a default setTimeout sleep (inv 1).
  - done: red "get_vm_source handler returns the getVmSource result as JSON text"; green handler + widened options + default sleep; refactor: naming/JSDoc.
- Cycle 9.3: the handler formats a VmSourceError as "code: message" with isError, and other errors as the plain message with isError (inv 17).
  - done: red "get_vm_source handler formats a VmSourceError…"; green try/catch; refactor deferred to the 9.4 pass (the change was a single try/catch).
- Cycle 9.4: the get_vm_source description covers verbatim inputs, call order, the platform table, mirror_missing → setup_vm_mirror, and the caveats instruction (inv 3, 5, 6).
  - done: red "get_vm_source description covers…"; green full description.
- Cycle 9.5: through `createTools(fake, harnessOpts)`, get_vm_source succeeds as the first and only call and the fake client is never invoked (inv 4, 5).
  - done: characterization test in src/tools.test.ts (green from the start); final refactor: shared `errorResult` helper covering 9.3–9.5.

Summary: 5 cycles. `get_vm_source` is defined after `setup_vm_mirror` with a six-property schema, a full description,
and a handler that returns JSON text and formats `VmSourceError` as "code: message" with isError.
`createVmSourceTools` and `createTools` now take `Partial<VmSourceOptions>`, with a default setTimeout sleep.
The full suite has 146 tests and `tsc` is clean.
Deviation: one existing `src/tools.test.ts` expectation (the tool list) was updated to include get_vm_source, as the spec requires.

## Phase 10 — [Scaffold] READMEs
`mcp-bridge/README.md`: the tool count is now 15, with a `get_vm_source` bullet, the call order, the platform-parameter
table, and the host-side error codes (invalid_request, mirror_missing, mirror_initializing, mirror_busy, symbol_not_found).
The Cuis-side "six codes" sentence is scoped to Cuis-side calls. Root `README.md`: the host-side sentence now names `get_vm_source` too.

## Closing
Part 3 adds the host-side `get_vm_source` tool. It parses the VM version and pragma into a lookup plan,
resolves the `VMMaker.oscog-eem.N` token to its introducing Cog commit with a content pickaxe, fetching (with lock
retry) only on a miss, and reads one blob with `git show <sha>:<path>`. It then extracts the function, its in-file
helpers, its classified external calls, the dispatch entry, any shared-dispatcher info and the stamp check, and
returns JSON with plain-language caveats. All 10 phases are done: 4 scaffolding phases and 6 TDD phases with 50 cycles
(git 6, lookupPlan 11, cSource 13, resolveCommit 6, getVmSource 9, tools 5). `npm test` is green with 146 tests in
11 files (it was 50 tests in 5 files before part 3), and `npm run build` succeeds.

How the design moved away from the spec:
- Several upstream shapes refine the spec's parser rules (the ` 0 };` table close, `# define`/`#\tdefine`, the DECL brace line).
  They were found while copying the excerpts and handled in phase 6.
- `checkArgTypes` was pulled out of `planLookup` so the type guards run before the mirror check, in the spec's step order.
- `runGit` falls back to Node's error message when stderr is empty.
- The call scan covers only the function body.
- The C keyword set holds only the six tested words.
- Caveat sentences and the `applies` texts are fixed strings, recorded in the phase summaries.

Surprises:
- Several characterization tests passed on the first run: drift, concurrency, gcc3x, FFI/key/junk, determinism, and the wiring
  through createTools. The composition of the earlier modules already satisfied those invariants.
- A pre-existing timing flake showed up once in `mirror.test.ts` under full-suite load.

Open points for review:
- Cog[SqueakV3] doesn't require platformSubtype.
- A `moduleStamps` array passes the type guard.
- `stampCheck` assumes the file carries a moduleName stamp.
- The `symbol_not_found` throw for "dispatch fn has no definition" has no test.

## Implementation files

- mcp-bridge/server/src/vmSource/errors.ts
- mcp-bridge/server/src/vmSource/git.ts
- mcp-bridge/server/src/vmSource/git.test.ts
- mcp-bridge/server/src/vmSource/mirror.ts
- mcp-bridge/server/src/vmSource/lookupPlan.ts
- mcp-bridge/server/src/vmSource/lookupPlan.test.ts
- mcp-bridge/server/src/vmSource/cSource.ts
- mcp-bridge/server/src/vmSource/cSource.test.ts
- mcp-bridge/server/src/vmSource/resolveCommit.ts
- mcp-bridge/server/src/vmSource/resolveCommit.test.ts
- mcp-bridge/server/src/vmSource/getVmSource.ts
- mcp-bridge/server/src/vmSource/getVmSource.test.ts
- mcp-bridge/server/src/vmSource/tools.ts
- mcp-bridge/server/src/vmSource/tools.test.ts
- mcp-bridge/server/src/tools.ts
- mcp-bridge/server/src/tools.test.ts
- mcp-bridge/server/src/vmSource/testSupport/fixtures.ts
- mcp-bridge/server/src/vmSource/testSupport/fixtures.test.ts
- mcp-bridge/server/src/vmSource/testSupport/excerpts/cointerp-spur64.c.txt
- mcp-bridge/server/src/vmSource/testSupport/excerpts/SocketPlugin.c.txt
- mcp-bridge/server/src/vmSource/testSupport/harness.ts
- mcp-bridge/server/src/vmSource/testSupport/harness.test.ts
- mcp-bridge/README.md
- README.md

## Post-implementation follow-ups

- 2026-10-20 — Open point "Cog[SqueakV3] subtype": resolved per functional inv 3. `interpreterDir` now requires `platformSubtype` for every module-omitted lookup, V3 included (message: "missing platformSubtype (required when module is omitted)"). New row in the `lookupPlan.test.ts` failure table. Suite: 147 passed.
- 2026-10-20 — Open point "no-definition symbol_not_found untested": covered. The SocketPlugin fixture in `getVmSource.test.ts` gains a dangling exports row `primitiveSocketUndefined`; a new test expects `symbol_not_found` with "no definition of 'primitiveSocketUndefined' in src/plugins/SocketPlugin/SocketPlugin.c". Mutation-checked (fails when the code is changed). Suite: 148 passed.
- 2026-10-20 — Open point "moduleStamps array passes the type guard": fixed in `checkArgTypes`. Arrays now fail with `invalid_request` "moduleStamps must be an object"; `builtin`/`loaded`, when present, must be arrays of strings ("moduleStamps.<field> must be an array of strings"). Before, a flat array or a string field gave a false `not_verifiable` caveat, and a non-string entry crashed with a raw TypeError. Four new rows in the `lookupPlan.test.ts` type-error table. Suite: 152 passed.
- 2026-10-20 — Open point "stampCheck assumes a moduleName stamp": fixed. On the real mirror 7 of 81 `src/plugins/**/*.c` files on Cog lacked the single-line stamp, and `stampCheck` crashed on them with a TypeError. Six use an older `#ifdef SQUEAK_BUILTIN_PLUGIN`-split form (FT2Plugin, EventsHandlerPlugin, IOSPlugin, ObjectiveCPlugin, SDL2DisplayPlugin, TestOSAPlugin). `moduleStamp` now reads that form's builtin string and strips the ` (i)`/` (e)` suffix (drift check: new excerpt `excerpts/FT2Plugin.c.txt` @ 3ea6bd17, lines 196-202). The seventh, SqueakFFIPrims.c, is an `#include` dispatcher that lookups never read. A file still lacking a stamp now gives `not_verifiable` with no `source`, plus a sixth caveat template: "The returned source carries no moduleName stamp, so it could not be checked against the running VM." Re-run over the real mirror: 80/81 files yield a stamp, and the one without is SqueakFFIPrims.c. Suite: 154 passed.
- 2026-10-21 — Open point "keyword filter covers only 6 words": fixed using the real mirror (5,947 functions across 81 plugin files and the three interpreter files). The scan found 156 false external calls. Most were return types of function-pointer casts or declarators (`void`, `sqInt`, `double`, `float`, `int`, `usqIntptr_t`, `usqLong`, `struct dprr`, `SixteenByteReturn*`); 4 were `case (`. `CALL` now skips an identifier whose `(` opens a declarator `(*)(…)`/`(*name)(…)`. A blanket `(*` lookahead was rejected because it would drop real calls like `f(*p)`. `C_KEYWORDS` gains only `case`: no other keyword precedes `(` anywhere in the corpus. A rescan shows external calls falling from 21,660 to 21,504, and `f(*p)` calls are still detected. Drift check: new `excerpts/call-shapes.c.txt` @ 3ea6bd17 (UnixOSProcessPlugin.c:4523, spur64 cointerp.c:48594). Suite: 155 passed.
- 2026-10-21 — Open point "mirror.test.ts timing flake": root-caused and fixed in `testSupport/harness.ts`. The git shim appended argv one `printf` at a time, and `argvLog()` counted the unfinished last line, so `waitFor(length === 1)` could fire on a truncated `clone` argv (the observed failure: url and target path missing). Fixes: (1) the shim builds the full line and appends it with a single write, which also stops concurrent shims interleaving; (2) `argvLog()` drops the last, unterminated segment. New `harness.test.ts` case reproduces the truncated read deterministically (red before the fix). Full suite 5/5 consecutive runs green, 156 tests.
- 2026-10-21 — Dynamic-verify finding on inv 19 (caller waited ~36 s before `mirror_busy`, not ~5.6 s): each lock retry re-ran the full-history pickaxe (~5 s on real Cog). Resolved by changing the spec rather than the timing: no retries at all. Calls in one bridge instance now share one in-flight fetch (module-level map keyed by mirror dir); a fetch that hits git's ref lock (another instance fetching, or a stale `Cog.lock`) gives `mirror_busy` at once. `LOCK_RETRY_DELAYS_MS` and the `sleep` option are gone (`VmSourceOptions = MirrorOptions`). The `get_vm_source` description now tells the assistant to tell the user when a call may be fetching, and that `mirror_busy` means another session is fetching. Functional inv 16 and 19, technical spec and `mcp-bridge/README.md` updated. TDD: 3 cycles (shared fetch; immediate `mirror_busy`, replacing the retry tests; description). Suite: 157 passed. Live: held `Cog.lock` → `mirror_busy` in 6.1 s; 4 concurrent lookups needing a fetch in one process → all succeed, 1 fetch.
- 2026-10-21 — Dynamic-verify finding: 4 concurrent lookups in one process ran 3 fetches, not 1. The shared fetch only covers overlap: the searches finished a few hundred ms apart, and each fetch (~100 ms against a local upstream) had ended before the next call missed, so later calls fetched again (no-ops, but each takes git's ref lock, which can push another session into `mirror_busy`). Fix: `resolveCommit` reads `rev-parse Cog` before its first pickaxe and again after a miss; if Cog moved, it re-runs the pickaxe instead of fetching. This also covers fetches by other bridge instances. argv: hit → rev-parse, log; moved → rev-parse, log, rev-parse, log; fetch → rev-parse, log, rev-parse, fetch, log. TDD: 1 cycle (deterministic test via a git wrapper that fetches during the first pickaxe; exact-argv expectations updated). Suite: 158 passed. Live: 4 concurrent in one process → 1 fetch; 2 processes × 3 concurrent → 1 fetch each, all 6 succeed; real-mirror responses byte-identical to before the fix.

## Retrospective

Part 3 went through all 10 planned phases: 4 scaffolding phases and 6 TDD phases with 50 cycles. Nine follow-ups came after that, and both verifies ended at 20/20.

There were two deviations from the original functional spec, both from live verification rather than tests:
- **Invariant 19 was redesigned.** The planned lock retry (5 retries over about 5.6 s) actually made a caller wait about 36 s, because each retry re-ran the full-history pickaxe. It was replaced with a simpler rule: calls within one bridge instance share one fetch, and a call that finds another instance fetching fails at once with `mirror_busy`.
- **Fetch results are now reused.** The shared fetch only covered calls that overlapped, so later calls fetched again. `resolveCommit` now runs a `rev-parse` check before fetching and reuses a fetch that has already finished.

The spec got two further refinements:
- the `get_vm_source` description now tells the assistant when to tell the user about fetches;
- Cog[SqueakV3] now requires `platformSubtype`, as invariant 3 says.

Lessons:
- **Verbatim upstream excerpts paid off.** They exposed several C-shape details the spec missed, such as ` 0 };`, `# define`, and the DECL brace line.
- **Scanning the real mirror found what fixtures missed.** It turned up the older stamp form in 7 plugin files and 156 false external calls.
- **Fake-git tests miss timing problems.** Problems that depend on how long git operations take, like the 36 s wait and the repeated fetches, only showed up against the real ~5 s pickaxe. The dynamic verify should stay part of the workflow.
- **The test harness had a timing bug.** A truncated read of the logged git calls caused a flake that predated part 3; it was fixed in the harness.

Still open:
- invariant 11 has a static coverage gap (`moduleStampCheck` with `module` omitted is checked only live);
- the run recipe's `driver.mjs` still uses `PROTOCOL_VERSION = 2`.
