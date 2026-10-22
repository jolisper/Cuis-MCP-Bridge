---
spec: initiatives/vm-source-primitive-lookup-04-failure-handling/technical-spec.md
started: 2026-10-22
last-completed-phase: 11
status: archived
archived: 2026-10-22
---

# Implementation Log: VM Source Primitive Lookup — Part 4: Failure Handling

This part gives every `get_vm_source` and `setup_vm_mirror` failure a structured code, checked
in the order of functional invariant 3. It also adds the stamp-guided window walk (refreshing
only open windows), records failed background clones for the next `setup_vm_mirror` call,
widens the version token to any author's initials (inv 14) and splits `internal_error` from
`mirror_corrupt` (inv 15).

The plan has 10 TDD phases over `mcp-bridge/server/src/vmSource/` and one docs phase, run with
Vitest (`npm test` in `mcp-bridge/server`), starting at phase 1.

Done means:
- every invariant 1–15 has a passing test as mapped in the technical spec's
  "Testing and validation" table;
- the existing part 2/3 suites are green, apart from the assertions the spec deliberately
  changes;
- `npm run build` is clean.

## Phase Plan

1. [TDD] vmSource/errors.ts — full code union (incl. internal_error), isNetworkFailure, transferError, gitUnavailable (+ errors.test.ts)
2. [TDD] vmSource/git.ts — runGit three-way failure split, readGit → mirror_corrupt
3. [TDD] vmSource/testSupport/fixtures.ts — author? option on the core-interpreter builder
4. [TDD] vmSource/testSupport/harness.ts — failGit({stderr}|{signal}|{flood}), clearGitFailures
5. [TDD] vmSource/lookupPlan.ts — full-name token, four ordered check passes, stamp arrays required, module+number guard, V3 width check
6. [TDD] vmSource/cSource.ts — primitive_slot_empty
7. [TDD] vmSource/mirror.ts — clone stderr capture, vm-mirror.error record/consume, git probe, fs failures → mirror_write_failed
8. [TDD] vmSource/resolveCommit.ts — readGit, full-token pickaxe, {commit, hits}, commit_not_found, fetchShared + transferError, stampWindowCommit
9. [TDD] vmSource/getVmSource.ts — mirror check first, module_not_found, path_not_found, stamp-guided pick
10. [TDD] vmSource/tools.ts — description additions (+ src/tools.test.ts sparc case)
11. [Scaffold] mcp-bridge/README.md — host-side codes, vm-mirror.error in writes list

## Cycles

### Phase 1 — errors.ts

- 1.1 `isNetworkFailure` true for "Could not resolve host", false for "insufficient permission". Red: errors.test.ts (new). Green: `NETWORK_FAILURE_PATTERNS` with one pattern. Refactor: nothing.
- 1.2 `isNetworkFailure` true for the 11 other network messages (it.each). Green: full 11-pattern table. Refactor: nothing.
- 1.3 `transferError(network stderr)` → `fetch_failed` carrying the trimmed stderr. Green: union gains `fetch_failed`; `transferError` returns fetch_failed unconditionally. Refactor: nothing.
- 1.4 `transferError(non-network stderr)` → `mirror_write_failed` carrying the trimmed stderr (permission, disk full, read-only, unknown). Green: union gains `mirror_write_failed`; branch on `isNetworkFailure`. Refactor: nothing.
- 1.5 `gitUnavailable(detail)` → `git_unavailable`, message says git is required and carries the detail. Green: union gains `git_unavailable`. Refactor: `transferError` trims stderr once into `detail`.

## Phase 1 — [TDD] vmSource/errors.ts

Tested behaviors:
- `isNetworkFailure`: all 11 spec patterns, plus one negative case;
- `transferError`: `fetch_failed` for network stderr, `mirror_write_failed` for permission, disk-full, read-only and unknown stderr, both carrying the trimmed stderr;
- `gitUnavailable`.

Files: `errors.ts`, `errors.test.ts` (new). 5 cycles, 18 tests in the file; the suite is 176 tests, all green; tsc is clean.

Deviation from the spec: the code union gained only `fetch_failed`, `mirror_write_failed` and `git_unavailable` here. The other new codes (`internal_error`, `mirror_corrupt`, `version_unparseable`, …) are added in the phase that first raises them. A union member has no runtime behavior to test, and tsc rejects any use before it's added.

### Phase 2 — git.ts

- 2.1 `runGit` with a nonexistent `opts.git` → `git_unavailable` naming ENOENT. Green: ENOENT → `gitUnavailable(err.message)`. Refactor: nothing.
- 2.2 `runGit` with a non-executable `opts.git` (EACCES) → `git_unavailable`. Green: EACCES joins ENOENT. Refactor: JSDoc re-wrapped.
- 2.3 git exiting non-zero → rejection carries numeric `exitCode` alongside `stderr`. Green: `exitCode: err.code`, set unconditionally (the number check is driven by 2.4). Refactor: nothing.
- 2.4 git killed by a signal (stub script `kill -9 $$`) → `internal_error` naming SIGKILL. Green: union gains `internal_error`; `err.signal` branch. Refactor: JSDoc re-wrapped.
- 2.5 output beyond maxBuffer (65 MiB stub) → `internal_error` naming maxBuffer. Green: the signal branch is replaced by the spec rule (non-numeric `code` → internal_error). Refactor: nothing.
- 2.6 `readGit` on an empty `vm-mirror/` → `mirror_corrupt` naming the mirror path and `setup_vm_mirror`. Green: union gains `mirror_corrupt`; `readGit` wraps every rejection. Refactor: nothing.
- 2.7 `readGit` passes `git_unavailable` and `internal_error` through untouched. Green: `instanceof VmSourceError` rethrow. Refactor: nothing.

## Phase 2 — [TDD] vmSource/git.ts

`runGit` now sorts every failure three ways:
- ENOENT/EACCES → `git_unavailable`;
- a numeric exit → plain Error with `{stderr, exitCode}`;
- anything else (a signal, maxBuffer overflow, a spawn errno) → `internal_error`.

New `readGit` wraps git-reported failures as `mirror_corrupt` (naming the mirror path and `setup_vm_mirror`) and passes `VmSourceError`s through.

Files: `git.ts`, `errors.ts` (union gains `internal_error`, `mirror_corrupt`), `git.test.ts`. 7 cycles; the suite is 184 tests, green; tsc is clean.

Deviation: the signal/maxBuffer tests use small stub scripts written by the test itself instead of the phase-4 `failGit` harness, so phase 2 doesn't depend on phase 4.

### Phase 3 — testSupport/fixtures.ts

- 3.1 `coreInterp({author: 'mt', version: '3568'})` → banner and `interpreterVersion` carry `VMMaker.oscog-mt.3568`, no `oscog-eem`. Green: `author?` (default `eem`) threaded through `emitBanner`; `plugin()` passes `eem`. Refactor: nothing.

## Phase 3 — [TDD] vmSource/testSupport/fixtures.ts

There's one new `author?` option on `CoreInterpSpec`, so tests can build interpreters for any author's initials (inv 14). Files: `fixtures.ts`, `fixtures.test.ts`. 1 cycle; the suite is 185 tests, green.

### Phase 4 — testSupport/harness.ts

- 4.1 `failGit('clone', {stderr})` → the wrapper prints the stderr, exits 128 without running git, and still logs argv/done. Green: `<root>/fail-<sub>` file checked after the gate. Refactor: one `failPrefix` constant.
- 4.2 `failGit('rev-parse', {signal: 'KILL'})` → the `--git-dir=… rev-parse` call dies by SIGKILL after appending to done.log. Green: `GitFailure` union, `kill-<sub>` marker. Refactor: nothing.
- 4.3 `failGit('show', {flood: true})` → ≥ 65 MiB on stdout, exit 0. Green: `flood-<sub>` marker + `head -c`. Refactor: `failGit` picks prefix/contents in one expression.
- 4.4 `clearGitFailures()` → subcommands that had failures injected run real git again. Green: remove all markers under root. Refactor: shared `failurePrefixes` list.

## Phase 4 — [TDD] vmSource/testSupport/harness.ts

`failGit(subcommand, failure)` takes three kinds of `GitFailure`:
- `{stderr}`: print it and exit 128;
- `{signal: 'KILL'}`: append to done.log, then `kill -KILL $$`;
- `{flood: true}`: write 65 MiB to stdout and exit 0.

The subcommand is the first non-option argv entry. Argv and done.log are still logged, so `cleanup` keeps working. `clearGitFailures()` removes all injected failures.

Files: `harness.ts`, `harness.test.ts`. 4 cycles; the suite is 189 tests, green; tsc is clean.

### Phase 5 — lookupPlan.ts

Deviation: the full-name token (inv 14) is moved to cycle 8.1. `getVmSource` hands `plan.token` to `resolveCommit`, which adds the `VMMaker.oscog-eem.` prefix itself. Changing the token format here alone would break `resolveCommit`, which phase 8 owns, so the change is made there for both files at once.

- 5.1 missing `]` token → `version_unparseable` naming the vmVersion. Green: union gains `version_unparseable`; that throw converted. Refactor: nothing.
- 5.2 a required platform parameter missing → `missing_platform_info` naming it (4 cases). Green: union gains `missing_platform_info`; 3 throw sites converted. Refactor: nothing.
- 5.3 unmapped values the case uses → `unsupported_platform` naming the value (sparc, Win32 platformName, Stack[Spur], FFI Win32/x64). The red step also updated the `sparc` case in `src/vmSource/tools.test.ts` (the spec says `src/tools.test.ts`; that path is wrong) to expect `unsupported_platform: `. Green: union gains `unsupported_platform`; 4 throws converted. Refactor: nothing.
- 5.4 `platformName: 'Win32'` on an ordinary plugin → `unsupported_platform`. Green: Win32 check on the ordinary-plugin path. Refactor: JSDoc path rule updated.
- 5.5 `module` given with a numeric `lookupKey` → `invalid_request` ("a numbered primitive can't have a module"). The red step moved the `"1"`-is-a-name test to the interpreter path. Green: guard in `checkArgTypes`. Refactor: nothing.
- 5.6 `moduleStamps` without both `builtin` and `loaded` → `invalid_request` naming the field. Green: also reject missing fields, but after wrongly typed ones (keeps existing rows). Refactor: one `find ?? find` expression.
- 5.7 `Cog[SqueakV3]` with an unmapped `platformSubtype` → `unsupported_platform`. Green: subtype mapping checked before the V3 return. Refactor: JSDoc line rejoined.
- 5.8 check order: missing_platform_info before unsupported_platform; Win32 first among unsupported checks (3 two-fault rows plus a version_unparseable guard row). Green: `planLookup` restructured into four commented passes with `vmFamily`/`spurDir`/`interpreterDir` helpers. Deviation: there's no separate FFI "platformName not Mac OS/unix" check, because the `FFI_PLUGIN_FILES` lookup rejects the same inputs with the same code. Refactor: `spurDir` JSDoc.
- 5.9 a malformed module name (`../etc`) no longer throws in `planLookup`; the path is built (`module_not_found` comes in phase 9). Green: regex throw removed. Refactor: JSDoc wrap.

## Phase 5 — [TDD] vmSource/lookupPlan.ts

`planLookup` now runs four ordered passes, each throwing the first fault it finds:
1. `invalid_request`: type guards, plus a numbered key with a module, plus both stamp arrays required;
2. `version_unparseable`;
3. `missing_platform_info`, naming the parameter;
4. `unsupported_platform`: Win32 first in every case, then platformName, then the subtype mapping (V3 included), then the family.

The module-name regex is gone.

Files: `lookupPlan.ts`, `errors.ts` (union gains `version_unparseable`, `missing_platform_info`, `unsupported_platform`), `lookupPlan.test.ts`, `vmSource/tools.test.ts` (sparc case). 9 cycles; the suite is 198 tests, green; tsc is clean.

Deviations:
- The full-name token (inv 14) moved to cycle 8.1.
- There's no separate FFI platformName check (see 5.8).
- Until phase 9, a malformed module name reaches `git show` as a tree path, which git doesn't resolve `..` in.

### Phase 6 — cSource.ts

- 6.1 empty `(void (*)(void))0` slot (fixture slot 3, upstream excerpt slot 255) → `primitive_slot_empty` naming the slot and the Smalltalk fallback. Green: union gains `primitive_slot_empty`; throw converted. Refactor: the check uses the parsed cast value `k === 0`, not a row-text match.

## Phase 6 — [TDD] vmSource/cSource.ts

`findTableSlot` throws `primitive_slot_empty` for an empty slot (inv 8). Files: `cSource.ts`, `errors.ts`, `cSource.test.ts`. 1 cycle; the suite is 198 tests, green.

### Phase 7 — mirror.ts

- 7.1 a failed background clone (nonexistent upstream) → the next `setupVmMirror` rejects with `fetch_failed` carrying git's text and starts no clone. The red step rewrote the old "next call starts again" test (mirror.test.ts:310). Green: clone stderr piped; `abandonClone` writes `vm-mirror.error` (temp+rename) before tmp removal and lock release; `setupVmMirror` consumes it after the ready/initializing checks. Not yet: the 64 KB stderr cap and spawn-`error` recording. Refactor: `uniqueSiblingPath` helper.
- 7.2 disk-full clone stderr → `mirror_write_failed`; `mirror_missing` in between; the call after the report starts a new clone that completes. This passed on first run: it's a regression guard for inv 2, so there was no green or refactor step.
- 7.3 `setupVmMirror` with a nonexistent `opts.git` → `git_unavailable`, not `started`; no lock, no tmp dir left. The first green attempt was reverted because the extra `git --version` argv entry broke two existing tests that assumed the clone was the first logged call (mirror.test.ts "returns 'started'…" and vmSource/tools.test.ts "defaults the mirror home…"). A red step updated both to look for the `clone` entry, and the second green attempt added the probe. Refactor: JSDoc.
- 7.4 an unwritable home → `setupVmMirror` rejects with `mirror_write_failed` carrying the errno text (skipped when running as root). Green: `mapWriteFailure` wraps `fs.mkdir(home)` and `acquireLock`. Refactor: nothing.
- 7.5 a spawn `error` event on the clone (self-deleting stub git that passes the `--version` probe) is recorded as `mirror_write_failed` carrying ENOENT and reported by the next call. Green: `settle`/`abandonClone`/`writeErrorFile` take a `VmSourceError`; the error handler builds one. Refactor: `settle(failure?)` replaces the boolean flag.
- 7.6 clone stderr is capped at the last 64 KB when recorded (200 KB stderr; message keeps TAIL-MARKER, drops HEAD-MARKER, stays under 70,000 chars). Green: `MAX_CLONE_STDERR_CHARS` and a `slice(-N)` on each append. Refactor: nothing.
- 7.7 two concurrent `setupVmMirror` calls after a failure: exactly one reports `mirror_write_failed`, the other gets `started` or `in_progress`, and there are exactly 2 clone entries in total. This passed on first run (3 runs, no flakiness), so it's a regression guard for inv 2 and there was no green or refactor step. The rename-based consumption already gives one winner.
- 7.8 a failed clone writes nothing under `h.root` beyond `home` and `home/vm-mirror.error` (and nothing but `home` once the error is consumed). This passed on first run, so it's a regression guard for p2 inv 8, with no green or refactor step.

## Phase 7 — [TDD] vmSource/mirror.ts

A failed background clone is now recorded and reported once:
- stderr is piped and capped at 64 KB;
- `abandonClone` writes `vm-mirror.error` (temp+rename) before the tmp dir is removed and the lock released;
- the next `setupVmMirror` consumes it and throws `fetch_failed` or `mirror_write_failed`, with git's text;
- the call after that starts a new clone.

A spawn `error` event is recorded as `mirror_write_failed`. `setupVmMirror` probes `git --version` and throws `git_unavailable` instead of `started`, leaving no lock or tmp dir. `mkdir` and lock-write failures (EACCES/ENOSPC/EROFS) become `mirror_write_failed`.

Files: `mirror.ts`, `mirror.test.ts`, and `vmSource/tools.test.ts` (the first-logged-call assumption). 8 cycles (7.2, 7.7 and 7.8 passed on first run and are regression guards); the suite is 205 tests, green.

Deviations:
- The `--version` probe broke two argv-log tests that assumed the clone was the first logged call; they were updated to find the `clone` entry.
- The probe catches any failure, so ENOENT and EACCES aren't distinguished.

### Phase 8 — resolveCommit.ts

- 8.1 the version token is the full name `VMMaker.oscog-<initials>.<N>` end to end (inv 14). Red: 17 tests updated or added (6 digits-only plan expectations, an `oscog-mt.3568` plan and unparseable test, and the `mt.3568`/`eem.3568` collision test in its own describe with its own harness; `nice.3568` is not found after one fetch). Green: regex keeps the initials; `LookupPlan.token` is the whole name; the pickaxe is `'-S' + token + ']'`. The cycle also surfaced a tsc error from a phase-7 test (`h` possibly undefined in `mirror.test.ts`), fixed with a `!` in a separate test-only edit. Refactor: nothing. This is the deviation from phase 5, where the token change was deferred.
- 8.2 a corrupt mirror (empty `vm-mirror/`) on `resolveCommit` → `mirror_corrupt` naming the mirror path and `setup_vm_mirror`, after only the `rev-parse Cog` (argv pinned). Green: the two `rev-parse Cog` calls and the pickaxe `log` go through `readGit`; fetch stays on `runGit`. Refactor: nothing.
- 8.3 `resolveCommit` with a nonexistent git → `git_unavailable`; with a git killed by SIGKILL → `internal_error` naming it. These passed on first run, because phase 2's classification already covers them, so they're regression guards (inv 12, 15) with no green or refactor step.
- 8.4 no commit carries the token even after the fetch → `commit_not_found` naming the full token (after exactly one fetch). Red: the old plain-Error test for `eem.9999` was updated. Green: union gains `commit_not_found`; the throw converted. Refactor: nothing.
- 8.5 a network fetch failure → `fetch_failed` carrying git's text (a `failGit('fetch', 'Could not resolve host')` test and the updated non-lock fetch-failure test, which now expects `fetch_failed` for a removed upstream), never `commit_not_found`, after exactly one fetch. Green: after the lock check, `VmSourceError`s pass through and any other failure becomes `transferError(stderr)`. Refactor: flat guard clauses in `fetchCog`.
- 8.6 `resolveCommit` returns `{ commit, hits }`: every pickaxe SHA, oldest first (7 assertions moved to `.commit`, plus a test that `hits` for `eem.3738` is `[sha3738, sha3739]` with `commit === hits[0]`). Green: `ResolvedCommit`; `pickaxe` returns all lines; `getVmSource` reads `.commit`. Refactor: nothing.
- 8.7 `stampWindowCommit` on a closed window (history c1 `eem.3794` with plugin stamp 3700, c2 plugin stamp 3743, c3 unrelated, c4 `eem.3795`): running 3743 → c2, 3700 → c1, 9999 → `undefined`, no `fetch` in argv. Green: window end by `git grep -q -F '<token>]'`, `rev-list` candidates touching the plugin path, `moduleStamp` match; a missing file counts as no match. The green step also added `probeGit` to `git.ts` (true on exit 0, false on exit 1 with empty stderr, else `mirror_corrupt`) and a private `asMirrorError` shared with `readGit`. `probeGit` has no direct test yet (8.9). Refactor: `windowEnd` helper.
- 8.8 a pickaxe hit that only adds the token to a second interpreter file (`spur32.cog/cointerp.c`) doesn't end the window: `hits` is `[c1, c2, c4, c5]` and stamp 3743, set by c3 after the second-file hit, still resolves to c3. This passed on first run, so it's a regression guard for inv 1 with no green or refactor step.
- 8.9 `probeGit` has direct tests: true on a match, false on no match, `mirror_corrupt` on an empty `vm-mirror/`. These passed on first run, so it's a coverage guard with no green or refactor step.
- 8.10 open window, no local stamp match: exactly one fetch, then the new upstream commit with the running stamp (4000, pushed after the clone) is found by a `log <c1>..Cog` pickaxe, with no full-range pickaxe re-run. A running stamp of 9999 gives `undefined` after exactly one fetch. Each test has its own harness, because the first fetch would consume the second test's. Green: private `fetchShared`, `firstWithStamp`, tip trimmed. Refactor: `windowEnd` returns `{ end, open }`; module header updated.
- 8.11 a failed refresh fetch on an open window → `fetch_failed` carrying git's text (not the introducing commit). This passed on first run, so it's a regression guard for inv 1 and 13 with no green or refactor step.
- 8.12 a stamp mismatch on a closed window, with every fetch set to fail, → `undefined` and no `fetch` in argv. This passed on first run, so it's a regression guard for inv 1 and 13.

## Phase 8 — [TDD] vmSource/resolveCommit.ts

- **Token:** the full name `VMMaker.oscog-<initials>.<N>` end to end (inv 14), in `lookupPlan.ts` and in the pickaxe.
- **Reads:** they go through `readGit` (`mirror_corrupt`, `git_unavailable`, `internal_error`).
- **Errors:** `commit_not_found` names the token. Fetch failures are classified by `transferError`: `fetch_failed` for network failures, with git's text.
- **Return value:** `resolveCommit` returns `{ commit, hits }`.
- **`stampWindowCommit`:** it ends the window by a content `git grep` (`probeGit`), picks the oldest commit with the running stamp, and returns `undefined` for a closed window with no fetch. For an open window it fetches once through `fetchShared` and searches only `<oldTip>..Cog`.

Files: `resolveCommit.ts`, `git.ts` (`probeGit`, `asMirrorError`), `lookupPlan.ts`, `errors.ts`, `getVmSource.ts` (reads `.commit`), `resolveCommit.test.ts`, `lookupPlan.test.ts`, `git.test.ts`, and `mirror.test.ts` (one type fix). 12 cycles (8.3, 8.8, 8.9, 8.11 and 8.12 passed on first run and are guards); the suite is 221 tests, green.

Deviation: the full-name token (inv 14) was moved here from phase 5.

### Phase 9 — getVmSource.ts

- 9.1 the mirror check runs before the type guards: a missing mirror beats an invalid request. Red: the gated-harness test was flipped (ill-typed request on an empty home → `mirror_missing`; while the gated clone runs → `mirror_initializing`; with a ready mirror → `invalid_request`). Green: `requireReadyMirror` first, then `planLookup` (which already runs `checkArgTypes`; the explicit call and its import are gone). Refactor: nothing.
- 9.2 a module that isn't in `src/plugins/` at the resolved commit → `module_not_found` naming it, before any `show` (an `ls-tree` entry is in argv, no `show`); a malformed name (`../etc`) is `module_not_found` too and never reaches git as a path. Green: `ls-tree --name-only <commit> src/plugins/` must list `src/plugins/<module>` exactly; the union gains `module_not_found`. The green step broke the argv allow-list assertion in "reads only via … subcommands" (it didn't allow `ls-tree`); a red step widened it to `rev-parse/log/show/ls-tree/grep/rev-list` and added a never-appear check for `checkout/worktree/reset/update-ref/symbolic-ref`. Refactor: private `requireModule` helper. (`--version` is not in that `argv[1]` allow-list because it isn't a subcommand.)
- 9.3 the resolved commit lacks the file for the case → `path_not_found` naming the path (core interpreter: a commit with the token only in `spur32.cog/cointerp.c`; plugin: a commit with `SocketPlugin.h` but no `SocketPlugin.c`). Green: private `readFile` around `git show`; stderr matching `does not exist in|exists on disk, but not in` → `path_not_found`; other git-reported failures go through the now-exported `asMirrorError`; `VmSourceError`s pass through. Refactor: nothing.
- 9.4 the file read: an unrelated git-reported `show` failure (`failGit('show', 'fatal: bad object …')`) → `mirror_corrupt` naming `setup_vm_mirror`; a killed `show` → `internal_error` naming SIGKILL; a flooding `show` → `internal_error` naming maxBuffer (fresh harness per row, `clearGitFailures` in `finally`, 20 s timeout). These passed on first run, so they're a coverage guard for inv 11 and 15 with no green or refactor step.
- 9.5 with `module` and `moduleStamps`, a later commit in the closed window carries the running stamp (c1 stamp 3700, c2 stamp 3743, c3 closes the window; live 3743) → `metadata.commit` is c2, `moduleStampCheck` is `{ result: 'match' }`, `caveats` is `[]`, and no `fetch` in argv. Green: a private `runningStamp(text, moduleStamps)` and a call to `stampWindowCommit` when the running stamp differs from the file's; the SHA replaces `commit` and the text is re-read; no walk when the file has no stamp, the plugin has no live entry, or the stamps are equal. Refactor: private `reportedStamp` shared by `stampCheck` and `runningStamp`; private `pickCommit(opts, plan, resolved, moduleStamps)` returning `{ commit, text }`, so `getVmSource` reads as: mirror → plan → resolve → pick → dispatch → assemble.
- 9.6 coverage guards for the other stamp outcomes, one table with a harness per row: (a) no match in a closed window → the introducing commit with `mismatch` carrying both stamps, one caveat, no fetch; (b) equal stamp → `match`, no `rev-list` or `grep` in argv; (c) plugin absent from the stamps → `not_verifiable`, no `rev-list`, `grep` or `fetch`; (d) open window and a matching commit pushed upstream after the clone → that commit with `match`, exactly one `fetch`. These all passed on first run, so they're regression guards for inv 1 with no green or refactor step.
- 9.7 through `getVmSource`: a missing exports row, the string `"1"` and a missing table slot → `symbol_not_found` (never `module_not_found` or `path_not_found`); an empty slot 3 → `primitive_slot_empty` naming it; a Stack VM `vmVersion` resolves with a module and gives `unsupported_platform` naming `Stack[Spur]` without one. All six rows passed on first run, so they're regression guards for inv 7, 8 and 9 with no green or refactor step.

## Phase 9 — [TDD] vmSource/getVmSource.ts

`getVmSource` now runs: `requireReadyMirror` → `planLookup` (type guards, version, platform info, unsupported platform) → `resolveCommit` → `pickCommit` (module check via `ls-tree`, file read with `path_not_found` / `mirror_corrupt` / `internal_error` mapping, and the stamp-guided choice through `stampWindowCommit`) → dispatch, helpers and external calls → assemble.

Files: `getVmSource.ts`, `git.ts` (`asMirrorError` exported), `errors.ts` (`module_not_found`, `path_not_found`), `getVmSource.test.ts`. 7 cycles (9.4, 9.6 and 9.7 passed on first run and are guards); the suite is 237 tests, green.

Deviations:
- The old `reads only via log/show` argv allow-list was widened to the spec's `ls-tree`, `grep` and `rev-list`, with a new never-appear check for `checkout/worktree/reset/update-ref/symbolic-ref`.
- `--version` isn't in that allow-list, because it checks `argv[1]` and `--version` isn't a subcommand.

### Phase 10 — tools.ts

- 10.1 the `setup_vm_mirror` and `get_vm_source` tool descriptions carry the new guidance. Red: two description tests (the `setup_vm_mirror` one asserts fetch_failed, mirror_write_failed, git_unavailable and `/the next call reports it/i`; the `get_vm_source` one asserts mirror_corrupt tied to "delete … setup_vm_mirror", fetch_failed, and internal_error tied to "do not delete"). Green: appended sentences; the `~/.cuis-mcp-bridge` path sits after `setup_vm_mirror` because the regexes use `[^.]*`. Refactor: the `setup_vm_mirror` sentence now reads "If the background clone fails, the next call reports it (…) and the call after that retries. The tool needs git (git_unavailable)."

## Phase 10 — [TDD] vmSource/tools.ts

Only description strings changed (additions). Files: `tools.ts`, `tools.test.ts`. 1 cycle; the suite is 241 tests, green. Deviation: the spec names `src/tools.test.ts` for the `sparc` case, but it lives in `src/vmSource/tools.test.ts` (updated in cycle 5.3).

## Phase 11 — [Scaffold] mcp-bridge/README.md

The writes paragraph now lists `vm-mirror.error`, says `setup_vm_mirror` needs `git` (`git_unavailable`), and says a failed background clone is reported by the next call (`fetch_failed` or `mirror_write_failed`, with git's text) and the call after that retries. The `get_vm_source` bullet mentions the stamp-guided commit choice. The Troubleshooting host-side list gains 12 codes, with `invalid_request` extended. The root `README.md` doesn't list host-side codes, so it's unchanged. A docs-only phase, so no build step; `npm test` and `npm run build` were run at the end.

## Closing

Part 4 gives every `get_vm_source` failure a code, checked in the order of functional invariant 3, and makes `setup_vm_mirror` report a failed background clone on its next call. The suite grew from 158 to 241 tests, and `npm run build` is clean. Across 11 phases there were about 70 red-green-refactor cycles, of which a dozen passed on first run and are logged above as regression guards.

How the build departed from the plan:
- **Token (inv 14):** the full-name version token moved from phase 5 to phase 8, where `lookupPlan.ts` and `resolveCommit.ts` changed together. Doing it earlier in one file would have broken the other.
- **Platform check:** there's no separate SqueakFFIPrims "platformName not Mac OS/unix" check. The `FFI_PLUGIN_FILES` lookup rejects the same inputs with the same code.
- **Git probe:** the `git --version` probe broke two tests that assumed the clone was the first logged git call. They were updated to look for the `clone` entry.
- **Test path:** the spec's `src/tools.test.ts` `sparc` case lives in `src/vmSource/tools.test.ts`.
- **Allow-list:** the argv allow-list in `getVmSource.test.ts` was widened to `ls-tree`, `grep` and `rev-list`, with a never-appear check for `checkout/worktree/reset/update-ref/symbolic-ref`. `--version` isn't in it, because it checks `argv[1]` and `--version` isn't a subcommand.
- **Helpers:** `probeGit` and an exported `asMirrorError` were added to `git.ts`, and `failGit`/`clearGitFailures` to the test harness.

The only `new Error(` left in `vmSource/` is the internal marker `runGit` raises for a git-reported failure. `readGit` and `getVmSource`'s file read convert it to `mirror_corrupt`, and `fetchCog` converts it via `transferError`.

Known gaps:
- **Malformed module names:** until phase 9's `module_not_found` check, a malformed module name could reach `git show` as a tree path. That check now runs first, so the window is closed.
- **Live check:** the spec's live check against the real mirror (`run-cuis-mcp-bridge` driver) has not been run.

## Implementation files

- mcp-bridge/README.md
- mcp-bridge/server/src/vmSource/errors.ts
- mcp-bridge/server/src/vmSource/errors.test.ts
- mcp-bridge/server/src/vmSource/git.ts
- mcp-bridge/server/src/vmSource/git.test.ts
- mcp-bridge/server/src/vmSource/lookupPlan.ts
- mcp-bridge/server/src/vmSource/lookupPlan.test.ts
- mcp-bridge/server/src/vmSource/cSource.ts
- mcp-bridge/server/src/vmSource/cSource.test.ts
- mcp-bridge/server/src/vmSource/mirror.ts
- mcp-bridge/server/src/vmSource/mirror.test.ts
- mcp-bridge/server/src/vmSource/resolveCommit.ts
- mcp-bridge/server/src/vmSource/resolveCommit.test.ts
- mcp-bridge/server/src/vmSource/getVmSource.ts
- mcp-bridge/server/src/vmSource/getVmSource.test.ts
- mcp-bridge/server/src/vmSource/tools.ts
- mcp-bridge/server/src/vmSource/tools.test.ts
- mcp-bridge/server/src/vmSource/testSupport/fixtures.ts
- mcp-bridge/server/src/vmSource/testSupport/fixtures.test.ts
- mcp-bridge/server/src/vmSource/testSupport/harness.ts
- mcp-bridge/server/src/vmSource/testSupport/harness.test.ts

## Retrospective

Part 4 was implemented in 11 phases (about 70 red-green-refactor cycles). The test suite grew from 158 to 241 tests and `npm run build` is clean. `get_vm_source` and `setup_vm_mirror` now return structured failure codes, checked in the order of invariant 3. Resolution includes a stamp-guided window walk, which refreshes only an open window. Failed background clones are recorded in `vm-mirror.error` and reported by the next `setup_vm_mirror` call.

**Deviations from the plan**
- The full-name version token (invariant 14) moved from phase 5 to phase 8, where `lookupPlan.ts` and `resolveCommit.ts` changed together.
- There is no separate SqueakFFIPrims "platformName not Mac OS/unix" check, because the `FFI_PLUGIN_FILES` lookup rejects the same inputs with the same code.
- The spec's `src/tools.test.ts` `sparc` case lives in `src/vmSource/tools.test.ts`.

**Verification**
- Static verification found one gap: invariant 5 had no test for `mirror_write_failed` on a non-network fetch failure in `resolveCommit`. It was closed with one regression-guard test, which passed first time.
- Dynamic verification passed 15 of 15 invariants against the running bridge. It used a fresh scratch clone, with failures injected through an unreachable URL, a read-only home, a corrupt mirror, a PATH without git, and wrapper `git` scripts.
- A successful refresh fetch that then finds a matching commit (invariant 1) was not run live.

**Observations**
- The recipe's `driver.mjs` has drifted: it sends protocol 2 and the server expects 3. It also only reaches Cuis-side operations, not the Node-side vmSource tools.
- The version token regex requires the closing `]`, so a bare `VMMaker.oscog-eem.N` is `version_unparseable`.
- The introducing commit is chosen by the interpreter file's `-S` match. That is why `mt.3568` resolves to the Lowcode commit rather than the earlier NewspeakVM ones.
- The "live check against the real mirror" known gap in the logbook is now closed by the dynamic run, apart from the driver.
