---
spec: initiatives/vm-source-primitive-lookup-02-mirror-setup/technical-spec.md
started: 2026-10-18
last-completed-phase: 7
status: archived
archived: 2026-10-19
---

# Implementation Log: VM Source Primitive Lookup — Part 2: Mirror Setup

Builds the host-side `setup_vm_mirror` MCP tool: a shared bare clone of
`opensmalltalk-vm` at `~/.cuis-mcp-bridge/vm-mirror`, created in the background under a
link-acquired `{pid, startTime}` lock with stale-lock takeover, wired into `createTools`
through an optional `vmSource` parameter. Starts at phase 1. Done means all 7 phases are
complete, `npm test` in `mcp-bridge/server` is green, and functional-spec invariants 1–11 are
covered by the tests mapped in the technical spec.

## Phase Plan

1. [Scaffold] vmSource test harness — `src/vmSource/testSupport/harness.ts` (temp home, local bare upstream, gated wrapper git with argv log)
2. [TDD] `src/vmSource/mirror.ts` — paths, `mirrorState`, `ready` short-circuit
3. [TDD] `src/vmSource/mirror.ts` — lock (start time, link-acquire, release), background clone, `started` / `in_progress`
4. [TDD] `src/vmSource/mirror.ts` — stale-lock takeover (dead pid, reused pid, empty lock), tmp cleanup, clone-failure cleanup
5. [TDD] `src/vmSource/tools.ts` — `createVmSourceTools`, `setup_vm_mirror` definition
6. [TDD] `src/tools.ts` — optional `vmSource` param, append `createVmSourceTools(vmSource)`, doc comment, wiring test
7. [Scaffold] `mcp-bridge/README.md` (+ root `README.md` if it states a count) — docs

## Phase 1 — [Scaffold] vmSource test harness
Wrote `src/vmSource/testSupport/harness.ts` (`createHarness({gated?})` → `{root, home, upstreamUrl, git, argvLog, releaseClone, cleanup}`, plus `waitFor`) and `harness.test.ts` (3 smoke tests). Deviation from spec: helpers live in `testSupport/harness.ts` rather than inside `mirror.test.ts`, since vitest rejects a test file with no tests. `npx tsc --noEmit` clean; `npm test` 22/22.

### Phase 2 cycles
- 2.1 — `mirrorState(opts)` with a non-existent home returns `'missing'`.
  - Red: `mirrorState > returns 'missing' when home does not exist`; Green: `mirror.ts` with `MirrorOptions` and constant `'missing'`; Refactor: nothing.
- 2.2 — `mirrorState(opts)` returns `'ready'` when `<home>/vm-mirror` exists.
  - Red: `returns 'ready' when <home>/vm-mirror exists`; Green: `fs.access` check; Refactor: deferred to end of phase (code is a few lines).
- 2.3 — `setupVmMirror(opts)` returns `'ready'` when `<home>/vm-mirror` exists, with no git invocation.
  - Red: `setupVmMirror > returns 'ready' without invoking git when <home>/vm-mirror exists`; Green: `setupVmMirror` exported, constant `'ready'`; Refactor (end of phase): nothing.

## Phase 2 — [TDD] mirror.ts — paths, mirrorState, ready short-circuit
3 cycles. Behaviors: `mirrorState` → `'missing'` (no home), `'ready'` (`vm-mirror` exists); `setupVmMirror` → `'ready'` with no git call. Files: `src/vmSource/mirror.ts`, `src/vmSource/mirror.test.ts`. `setupVmMirror` is a constant stub until phase 3's `started` test drives the existence check; `'initializing'` likewise waits for the lock. Deviation: per-cycle refactor collapsed into one end-of-phase pass for cycles 2.2–2.3 (trivial code). `npm test` 25/25.

### Phase 3 cycles
- 3.1 — no mirror, gated clone: `setupVmMirror` returns `'started'` and the wrapper logged one `clone --bare --quiet <upstreamUrl> <home>/vm-mirror.tmp-<pid>`.
  - Red: `returns 'started' without awaiting the clone…`; Green: existence check via `mirrorState`, `mkdir`, background `spawn`; Refactor: deferred.
- 3.2 — after the gated clone is released, `<home>/vm-mirror` appears and is a bare repo (tmp renamed on exit 0).
  - Red: `renames the finished bare clone to <home>/vm-mirror on clone exit 0`; Green: `close` handler renames tmp on exit 0; Refactor: `mirrorPath` / `tmpMirrorPath` helpers.
- 3.3 — while a gated clone is running, `mirrorState(opts)` returns `'initializing'`.
  - Red: `returns 'initializing' while a started clone is still running`; Green: `lockPath`, empty lock written before spawn, `mirrorState` checks lock; Refactor: deferred.
- 3.4 — while a gated clone runs, a second `setupVmMirror` returns `'in_progress'` and only one clone is spawned.
  - Red: `returns 'in_progress' and does not spawn a second clone while one is running`; Green: `'initializing'` → `'in_progress'`. Surprise: the test's fixed 200 ms settle was shorter than wrapper-git startup (~300 ms), so the clone count read 0; the test was corrected to `waitFor` the first clone line, then settle 500 ms. Refactor: deferred.
- 3.5 — `Promise.all` of 5 calls over two option objects sharing a home → one `'started'`, four `'in_progress'`, one clone.
  - Red: `starts exactly one clone when called concurrently…`; Green: temp file + `fs.link` acquire, `EEXIST` → `'in_progress'`; Refactor: extracted `tryAcquireLock(home)`, `setupVmMirror` JSDoc rewritten. 30/30.
- Check-in after 5 cycles in phase 3 (see below).
  - User chose (a): continue with 3.6 and 3.7. Lock content `{pid, startTime}` and `ps` liveness moved to phase 4 (only stale-lock tests drive them).
- 3.6 — after a released clone completes, `<home>/vm-mirror.lock` is gone (rename first, then release).
  - Red: `releases <home>/vm-mirror.lock after renaming the finished clone`; Green: rename → unlink lock on exit 0, plus spec-mandated `process.once('exit', kill)` while cloning; Refactor: deferred.
- 3.7 — re-check after acquire: with `vm-mirror` a symlink to `vm-mirror.lock` (dangling until the lock exists), `setupVmMirror` returns `'ready'`, spawns no clone, and releases the lock.
  - Red: `re-checks <home>/vm-mirror after acquiring the lock…`; Green: re-check via `mirrorState` + `releaseLock`; Refactor (end of phase): `finishClone(home, tmp)`, `setupVmMirror` JSDoc completed. 32/32.

## Phase 3 — [TDD] mirror.ts — lock, background clone, started / in_progress
7 cycles (check-in after 5; user chose to continue). Behaviors: `'started'` without awaiting; `clone --bare --quiet` into `vm-mirror.tmp-<pid>`; rename on exit 0; `'initializing'` while the lock exists; `'in_progress'` for a second caller; atomic link acquire (5 concurrent → 1 started); lock released after rename; re-check after acquire. Files: `mirror.ts`, `mirror.test.ts`. Deviations: lock content `{pid, startTime}` and `ps` liveness moved to phase 4; the exit-kill one-liner was added without a test (spec: review). Surprise: fixed sleeps are shorter than wrapper-git startup (~300 ms) — tests `waitFor` the first clone line, then settle. The re-check race is made deterministic with a `vm-mirror` → `vm-mirror.lock` symlink.

### Phase 4 cycles
- 4.1 — `mirrorState` with a lock holding an exited process's pid returns `'missing'`.
  - Red: `returns 'missing' when the lock is held by a pid that is no longer running`; Green: lock holds `{pid}`, `isLockLive` via `process.kill(pid, 0)`; Refactor: deferred.
- 4.2 — lock `{pid: process.pid, startTime: <wrong>}` → `'missing'`; lock of a live `sleep 30` child with its real `ps` start time → `'initializing'`.
  - Red: `treats a lock as live only when its pid runs with the recorded start time`; Green: `processStartTime` (ps lstart, LC_ALL=C), liveness = start time match (replaced `kill(pid,0)`), lock writes `{pid, startTime}`; Refactor: deferred.
- 4.3 — an empty (unparseable) lock → `mirrorState` `'missing'`.
  - Red: `returns 'missing' when the lock content is unparseable`; Green: `JSON.parse` failure → not live; Refactor: deferred.
- 4.4 — `setupVmMirror` with a stale (dead-pid) lock and a leftover `vm-mirror.tmp-<deadpid>/` → `'started'`, leftover removed, one clone.
  - Red: `takes over a stale lock, removes leftover tmp dirs, and starts a new clone`; Green: `takeOverStaleLock` (rename-and-verify), `vm-mirror.tmp-*` removal before spawn; Refactor: deferred.
- 4.5 — a failing clone (non-existent upstream) removes lock and tmp; the next call is `'started'`.
  - Red: `removes the tmp dir and releases the lock on clone failure…`; Green: one-shot `fail` (non-zero close / `error`) → `abandonClone` (rm tmp, release); Refactor: deferred.
- 4.6 — release only if ours: lock overwritten with foreign content mid-clone survives the clone's completion.
  - Red: `does not unlink <home>/vm-mirror.lock on release when another holder has taken it over`; Green: cached `ownLockContent()`, `releaseLock` only-if-ours. Surprise: an intermittent `ENOTEMPTY` in teardown (a test's trailing clone still writing while cleanup rm'd root). Fixed in the harness: the wrapper records completions in `done.log`, and cleanup waits for them, then `rm` with retries; 5/5 runs green. Side effect: the wrapper no longer `exec`s git (killing the wrapper doesn't kill git in tests; the exit-kill isn't tested). Refactor (end of phase): `acquireLock`, `startClone` with one `settle`, `TMP_MIRROR_PREFIX`, `hasErrnoCode`, module doc of the on-disk layout.

## Phase 4 — [TDD] mirror.ts — stale-lock takeover, tmp cleanup, clone-failure cleanup
6 cycles. Behaviors: dead-pid lock → `'missing'`; reused pid (start-time mismatch) → `'missing'`, live foreign holder → `'initializing'`; unparseable lock → `'missing'`; setup takes over a stale lock and removes `vm-mirror.tmp-*`; a failed clone removes tmp and lock so the next call starts; release only if ours. Also from the spec (absorbed from phase 3): lock content `{pid, startTime}` via `ps -o lstart=`; an `error` handler on the child (untested path). Files: `mirror.ts`, `mirror.test.ts`, `testSupport/harness.ts`. 38/38.

### Phase 5 cycles
- 5.1 — `createVmSourceTools()` returns one tool `setup_vm_mirror` with schema `{ type: 'object', properties: {} }`.
  - Red: `returns a single setup_vm_mirror tool that takes no parameters`; Green: `vmSource/tools.ts`, definition + stub handler; Refactor: deferred.
- 5.2 — the handler with `{}` (harness options) returns text `{"status":"started"}`, no `isError`.
  - Red: `setup_vm_mirror handler returns the setup status as JSON text`; Green: per-field defaults, the handler calls `setupVmMirror`; Refactor: deferred.
- 5.3 — `home` under a regular file → the handler resolves `isError: true` with text containing `ENOTDIR` (doesn't throw).
  - Red: `setup_vm_mirror handler turns a thrown fs error into an MCP error result`; Green: try/catch → `isError` result; Refactor: deferred to phase 6.

## Phase 5 — [TDD] vmSource/tools.ts — createVmSourceTools, setup_vm_mirror
3 cycles. Behaviors: one `setup_vm_mirror` tool with an empty-object schema; the handler returns `{"status": …}` JSON text; a thrown fs error → `isError` text. Defaults are filled per field (`~/.cuis-mcp-bridge`, GitHub upstream, `git`) and aren't exercised by tests (they'd touch the real home). Files: `src/vmSource/tools.ts`, `src/vmSource/tools.test.ts`. 41/41.

### Phase 6 cycles
- 6.1 — `createTools(fake, {home, upstreamUrl, git})` lists the 13 forwarded tools + `setup_vm_mirror`; its handler returns `started`; the fake `sendRequest` (rejects `unreachable`) is never called.
  - Red: `createTools > with vm source options > appends setup_vm_mirror after the forwarded tools and it starts without touching the Cuis connection`; Green: optional `vmSource` param, `[...forwarded, ...createVmSourceTools(vmSource)]`, doc comment; Refactor (phases 5–6): default-option constants in `vmSource/tools.ts`.

## Phase 6 — [TDD] src/tools.ts — vmSource param and wiring
1 cycle. Behavior: `createTools(fake, opts)` lists the 13 forwarded tools + `setup_vm_mirror`, which returns `started` and never calls `sendRequest` (inv 7). `index.ts` unchanged. Files: `src/tools.ts`, `src/tools.test.ts`. 42/42, `tsc --noEmit` clean.

## Phase 7 — [Scaffold] README docs
`mcp-bridge/README.md`: tool count 13 → 14, a `setup_vm_mirror` bullet (host-side, no image needed), and a note on `~/.cuis-mcp-bridge/` and the git requirement. Root `README.md`: one sentence noting the host-side mirror tool. Left alone and flagged: the `mcp-bridge/README.md` intro (lines 3–5) still says image reflection only, and "the first tool call triggers the first connection attempt" (lines ~130–134) now applies only to image tools.

## Closing
Built `setup_vm_mirror`: a shared bare mirror of `opensmalltalk-vm` at `~/.cuis-mcp-bridge/vm-mirror`, created by a background `git clone --bare` under a hard-link-acquired `{pid, startTime}` lock. It takes over stale locks (dead pid, reused pid, unparseable), cleans up after a failed clone, releases the lock only if it's ours, and re-checks after acquiring. It's wired through `createTools(client, vmSource?)`. 7 phases, 20 TDD cycles; final `npm test` 42/42 and `tsc --noEmit` clean.

How the design moved from the spec: lock content and `ps` liveness landed in phase 4 rather than phase 3, because only stale-lock tests could drive them; an `error` handler on the child and the exit-kill are present but untested (the spec marked the exit-kill review-only). Surprises: wrapper-git startup (~300 ms) beat fixed sleeps, so tests `waitFor` the first clone line; the post-acquire re-check race was made deterministic with a `vm-mirror` → `vm-mirror.lock` symlink; and a teardown `ENOTEMPTY` flake was fixed in the harness (the wrapper records completions, and cleanup waits, then `rm` with retries), so the wrapper no longer `exec`s git. Still to do: the live checks from the technical spec (a `tools/list` against `node dist/index.js`, one real ~750 MB clone) weren't run in this session. Test-suite time is now ~20–27 s.

## Implementation files

- mcp-bridge/server/src/vmSource/mirror.ts
- mcp-bridge/server/src/vmSource/mirror.test.ts
- mcp-bridge/server/src/vmSource/tools.ts
- mcp-bridge/server/src/vmSource/tools.test.ts
- mcp-bridge/server/src/vmSource/testSupport/harness.ts
- mcp-bridge/server/src/vmSource/testSupport/harness.test.ts
- mcp-bridge/server/src/tools.ts
- mcp-bridge/server/src/tools.test.ts
- mcp-bridge/README.md
- README.md

## Retrospective

All 7 phases are done, across 20 TDD cycles. The final suite was 42/42 and `tsc --noEmit` was clean. The static verify covered all 11 invariants, and the dynamic verify passed all 11 against the built bridge and real GitHub.

**Where the work departed from the spec**
- The test helpers moved into `testSupport/harness.ts`, because vitest won't accept a test file with no tests.
- Lock content `{pid, startTime}` and the `ps` liveness check landed in phase 4 instead of phase 3. Only the stale-lock tests could drive them.
- The child `error` handler and the exit-kill have no tests. The spec had already marked the exit-kill as review-only.
- Dynamic verify found that SIGTERM left the clone orphaned. A signal-handler fix followed, and SIGTERM now ends git cleanly. SIGKILL still orphans it, which can't be avoided, but the stale-lock takeover keeps things correct.

**Lessons**
- Fixed sleeps lost to wrapper-git startup (~300 ms), so the tests wait for observable events instead.
- A `vm-mirror` → `vm-mirror.lock` symlink made the post-acquire re-check race deterministic.
- A teardown `ENOTEMPTY` flake was fixed in the harness: cleanup now waits for clones to finish, then removes with retries. The cost is that the wrapper no longer `exec`s git.
- The suite now takes ~20–27 s.

**Still open**
- A harness wrapper-process leak is still unfixed.
- Two README statements are stale: the `mcp-bridge/README.md` intro, and the "first tool call connects" note.
- The "image unreachable" case for invariant 7 wasn't run live.
- PID reuse can only be checked statically.
