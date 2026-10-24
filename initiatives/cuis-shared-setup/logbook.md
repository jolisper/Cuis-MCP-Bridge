---
status: complete
started: 2026-10-23
spec: /Users/jolisper/Source/Cuis-MCP-Bridge/initiatives/cuis-shared-setup/technical-spec.md
last-completed-phase: 9
---

## 2026-10-23 — open questions 1 and 2 resolved

- Runner delivery: reimplemented in the bridge server in TypeScript; the server owns fetch,
  verification, base-image build and run. No bundled shell script, no split between
  technologies. Reasons: fetch/verify/errors are server work anyway (like `setup_vm_mirror`),
  watchdog and output handling are small and testable in Node, and the server being built is
  already a prerequisite for the capability.
- Scope narrowed (supersedes the dogfooding goal): purely additive. This repo's setup scripts,
  `tools/run-headless-tests.sh`, `tools/run-vm-primitive-test.sh` and the test skill are not
  touched; the checkout-local `Cuis7-8-main/` and `.headless-base` stay. Two Cuis locations
  coexist for now.
- Migration question dropped: nothing existing changes, so nothing to migrate.
- Known follow-up (separate initiative, after this capability is running): retire the repo's
  own setup in favor of the shared one.
- Known risk: `tools/fetch-cuis.sh` downloads the unpinned `main` branch, the new setup is
  pinned, so the two copies can differ until the follow-up. Mitigation: test fetch,
  verification and base-image build directly in this initiative, since no repo flow exercises
  them.

## 2026-10-23 — open question 3 resolved

- Pinning: the upstream release repo (`Cuis-Smalltalk/Cuis7-8`) has no tags or releases, and per
  the Cuis release process (https://cuis.st/documentation/reference/release-process) each
  stable release has its own repo that stays in maintenance after release (bug-fix updates
  land on `main`, no new features). So `main` is not frozen; pin a commit SHA (currently
  `d4f9cc1243175bd022c1b5dfa6a6a432fb07a035`, 2026-06-03) and download that commit's archive,
  never `refs/heads/main`.
- Verification: SHA-256 of the downloaded zip. Revisit (hash the extracted tree instead) if
  GitHub archives prove byte-unstable.
- Where it lives: a constants file in the server source (commit, checksum, release label), so
  bumping Cuis is a reviewed code change and a given server build always fetches the same bits.
- Layout key: release plus short commit, e.g. `~/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/`. The
  release part is the repo name; a new release (about every six months, May and November) is a
  new repo and a new pin.
- All initiative open questions are now resolved; the open-questions section was removed from
  `initiative.md`.

# Implementation Log: cuis-shared-setup

Implementing src/cuisHome/ in mcp-bridge/server: a pinned, per-user shared Cuis home (fetch, verify, frozen base) and a parameterized headless runner. Nine phases, starting at phase 1. Done means all functional invariants have passing Vitest tests, the full suite and build pass, and the READMEs document the shared location.

## Phase Plan

1. [Scaffold] src/cuisHome/pin.ts - compute and record the pin
2. [TDD] src/cuisHome/errors.ts - HeadlessError
3. [Scaffold] src/cuisHome/testSupport/ - fake VM, zip builder, HTTP server, temp home
4. [TDD] src/cuisHome/runner.ts - runHeadless
5. [TDD] src/cuisHome/processLock.ts - generalized lock
6. [TDD] src/cuisHome/cuisHome.ts - status and preparation
7. [TDD] src/cuisHome/run.ts - runWithSharedCuis
8. [Scaffold] src/cuisHome/realCuis.integration.test.ts - opt-in real archive test
9. [Scaffold] README.md, mcp-bridge/README.md - docs

## Phase 1 — [Scaffold] pin.ts

Wrote src/cuisHome/pin.ts. Two downloads gave identical SHA-256 ffa56eb08112c3167ab2be3748e8deeb2d5329b848bee25945da64a4241c6025 (archives byte-stable). Top dir Cuis7-8-plus-full-sha confirmed. tsc passes.

### Phase 2 cycles

- cycle 2.1 [covered=1]: HeadlessError('cuis_missing','not installed') is an Error with code, message and name HeadlessError — red: HeadlessError carries code/message/name; green: errors.ts class and code union; refactor: nothing
- cycle 2.2 [covered=2]: formatHeadlessError renders a HeadlessError as code colon space message — red: formatHeadlessError missing; green: one-line formatter; refactor: skipped, single-line function

## Phase 2 — [TDD] errors.ts

HeadlessError with nine codes, formatHeadlessError rendering. 2 cycles, 2 tests. Refactor skipped on cycle 2.2 (one-line function). No spec deviations.

## Phase 3 — [Scaffold] testSupport

Wrote fakeVm.ts, fakeDistribution.ts, archiveServer.ts, tempHome.ts and testSupport.test.ts under src/cuisHome/testSupport. tsc clean, 8 tests pass. Fake VM contract: first line fake-sh script is run with sh, other scripts print the DONE marker, bootFails option. Server exposes requestCount(). reset-midstream mode has no self-test yet.

### Phase 4 cycles

- cycle 4.1 [covered=1]: runHeadless with a nonexistent scriptPath returns outcome setup_error, exitCode 2, and never spawns the VM — red: missing script gives setup_error; green: runner.ts with script-exists check; refactor: deferred to end of phase
- cycle 4.2 [covered=2]: runHeadless with a nonexistent VM binary returns setup_error exit 2 — red: missing VM; green: VM path resolution and access check; refactor: deferred
- cycle 4.3 [covered=3]: runHeadless with a baseDir containing no image file returns setup_error exit 2 — red: no image in baseDir; green: baseDir read and image check; refactor: deferred
- cycle 4.4 [covered=4]: runHeadless with a fake-sh script printing DONE exitCode=0 and exiting 0 returns passed, exitCode 0, output containing the DONE line and earlier output — red: passed outcome with output; green: spawn VM, capture output, passed on marker plus exit 0; refactor: deferred
- cycle 4.5 [covered=5]: a script printing DONE exitCode=1 and exiting 1 returns failed with exitCode 1 and the output — red: failed outcome; green: nonzero exit with marker gives failed; refactor: deferred
- cycle 4.6 [covered=6]: a script that exits without printing the DONE marker returns timeout_or_crash with exitCode 124 and the output — red: no marker gives 124; green: return timeout_or_crash; refactor: deferred
- cycle 4.7 [covered=7]: a hanging VM with timeoutMs 500 is killed with its grandchild process and returns timeout_or_crash 124 promptly — red: hang plus grandchild killed at timeout; green: detached spawn, group SIGKILL on timer; refactor: deferred
- cycle 4.8 [covered=8]: the VM runs on a scratch copy of baseDir: a script that modifies the image file leaves baseDir byte-identical, and the VM is given an image path outside baseDir — red: base modified without scratch copy; green: temp scratch copy with cleanup in finally; refactor: runOnScratch helper extracted by green
- cycle 4.9 [covered=9]: no cuis-run- scratch directory remains in os.tmpdir() after passed, failed, crash, timeout and setup_error runs — red: cleanup across five outcomes, green on arrival since cleanup came with 4.8, uses a private TMPDIR to avoid flakiness; green: none needed; refactor: none
- cycle 4.10 [covered=10]: output of more than 1 MB from the VM is returned in full and in order, while memory-bounded by writing stdout and stderr to one log file in the scratch dir — red: interleaved 1MB output lost order via separate pipes; green: single log file fd for stdout and stderr, waitAndMap helper; refactor: deferred
- cycle 4.11 [covered=11]: aborting the AbortSignal mid-run kills the VM group and returns promptly, scratch removed — red: abort signal ignored; green: abort treated like timeout in waitAndMap; note: already-aborted signal still spawns then kills, untested; refactor: deferred
- cycle 4.12 [covered=12]: two simultaneous runs each get their own scratch copy and do not see each other's files — red: concurrent isolation, green on arrival (characterizes per-run scratch copies); green: none; refactor: none
- cycle 4.13 [covered=13]: the VM runs with cwd defaulting to cuisDir regardless of the process cwd, and opts.cwd overrides it — red: cwd default and override, green on arrival; green: none; refactor: phase-end refactor next

## Phase 4 — [TDD] runner.ts

runHeadless covers invariants 21 to 29. 13 cycles, 13 tests in runner.test.ts. Cycles 4.9, 4.12 and 4.13 were green on arrival (characterization). Deviation: an already-aborted signal spawns the VM then kills it, untested. Phase-end refactor done: named constants, setupError helper, doc comments.

### Phase 5 cycles

- cycle 5.1 [covered=1]: acquireLock on a free lock path resolves true and writes JSON with this process pid and start time — red: acquire on free path; green: processLock.ts with temp file hard-link acquire; refactor: deferred to phase end
- cycle 5.2 [covered=2]: isLockLive is true for a lock held by this process and false when the lock file is absent — red: isLockLive true/false; green: isLockLive via ps start time; refactor: deferred
- cycle 5.3 [covered=3]: acquireLock resolves false and leaves the file untouched when a live lock already exists — red: live lock refuses second acquire, green on arrival; green: none; refactor: none
- cycle 5.4 [covered=4]: acquireLock takes over a stale lock whose recorded pid is dead or whose start time does not match, and also a corrupt lock, resolving true with this process content — red: stale takeover for dead pid, pid reuse, corrupt content; green: takeOverStaleLock ported from mirror.ts; refactor: deferred
- cycle 5.5 [covered=5]: releaseLock unlinks a lock that holds this process content, leaves another process lock in place, and is a no-op when the file is missing — red: releaseLock own foreign missing; green: releaseLock with shared ownLockContent helper, no caching; refactor: deferred
- cycle 5.6 [covered=6]: several concurrent acquireLock calls on the same stale lock resolve true for exactly one caller — red: found real race, two winners among 8 concurrent acquires on a stale lock (same race likely exists in mirror.ts, untouched, noted as follow-up); green: takeover serialized by exclusive .takeover marker with token, stable over 6 runs; refactor: phase-end next

## Phase 5 — [TDD] processLock.ts

acquireLock, isLockLive, releaseLock over a lock file path. 6 cycles, 10 tests. Deviation from spec: not a verbatim port of mirror.ts. A concurrency test found a real two-winner race in the rename-aside takeover, so takeover is now serialized by an exclusive .takeover marker. mirror.ts is untouched and likely has the same race; add to follow-ups with the plan to adopt processLock.ts there. Phase-end refactor done.

### Phase 6 cycles

- cycle 6.1 [covered=1]: cuisHomeStatus on an empty home reports state missing and creates nothing on disk — red: status missing creates nothing; green: cuisHome.ts with option and status types, path helpers, stub missing status; refactor: deferred
- cycle 6.2 [covered=2]: cuisHomeStatus reports ready when the key directory exists, with no lock or error files needed — red: ready when key dir exists; green: stat of layoutDir; refactor: deferred
- cycle 6.3 [covered=3]: cuisHomeStatus reports preparing while the lock file is live and no key directory exists — red: preparing with live lock, stale lock gives missing; green: isLockLive check; refactor: deferred
- cycle 6.4 [covered=4]: cuisHomeStatus reports failed with the recorded code and message when an error file exists and nothing is live, and does not consume it — red: failed status from error file, non-consuming, unreadable file gives internal_error; green: error file read; refactor: deferred
- cycle 6.5 [covered=5]: prepareCuisHome with platform linux rejects with unsupported_platform before any fetch, lock or directory creation — red: prepare rejects on linux before any side effect; green: platform guard, rest not implemented; refactor: deferred
- cycle 6.6 [covered=6]: prepareCuisHome on a missing home returns started and ends ready with dist and base laid out and no lock, error or tmp siblings left — red: full happy path layout; green: prepareInBackground (lock, fetch with hashing, unzip, base copy, smoke boot, atomic rename); checksum mismatch and smoke failure throw but are not yet recorded; refactor: deferred
- cycle 6.7 [covered=7]: a checksum mismatch ends failed with cuis_checksum_mismatch naming expected and actual, with no key directory, tmp dir or lock left — red: checksum mismatch not recorded; green: recordFailure writes error file atomically before lock release; refactor: deferred
- cycle 6.8 [covered=8]: a 404 response, an unreachable server and a mid-stream connection reset each end failed with cuis_fetch_failed and leave no tmp dir or key dir — red: network failures mapped wrongly (red report claimed checksum_mismatch even for refused connection, unexplained, test verified valid); green: fetchArchive maps rejected fetch, non-2xx, missing body and mid-stream errors to cuis_fetch_failed, fs write errors excluded; refactor: deferred
- cycle 6.9 [covered=9]: an unwritable home ends failed with cuis_write_failed and leaves no partial state — red: write failures raw or internal_error; green: toWriteFailure mapping in foreground and background, unzip spawn failure mapped; note: unwritable-home case passes silently when run as root; refactor: deferred
- cycle 6.10 [covered=10]: a base that cannot boot ends failed with cuis_base_build_failed carrying the VM output, and the home is never ready — red: base build failure recorded with VM output, green on arrival since 6.6 already threw it; green: none; refactor: none
- cycle 6.11 [covered=11]: prepareCuisHome on a ready home returns ready without any network request, and while another preparation is live returns in_progress; two concurrent calls on a missing home cause exactly one download — red: one preparation for concurrent calls and no refetch once ready, green on arrival; also exposed a flake in the base-build-failed test: failed status visible before tmp dir removal (becomes cycle 6.12); green: none; refactor: none
- cycle 6.12 [covered=12]: the first observation of failed status never sees leftover tmp dir or lock, because cleanup finishes before the lock is released — red: failed status visible before tmp cleanup, 4 of 4 runs red; green: lock released last in nested finally; design decision by green: cuisHomeStatus reports preparing while a layout dir coexists with a live lock, ready only once the lock is gone (avoids a window for a second preparation); refactor: deferred
- cycle 6.13 [covered=13]: after a failed attempt, prepareCuisHome starts a fresh attempt returning started, clears the old error and can succeed — red: stale error file survived a successful retry; green: error file removed when a fresh attempt takes the lock; refactor: deferred
- cycle 6.14 [covered=14]: after a crash leaving a dead-pid lock and a leftover tmp dir, status is not preparing and a new prepare discards the leftovers and completes — red: foreign tmp leftover survived recovery; green: tmp siblings of the key removed after taking the lock; refactor: deferred
- cycle 6.15 [covered=15]: a home for another key is never touched by preparing this key, and deleting a ready home returns it to missing with no leftovers — red: key isolation and deletion, green on arrival; green: none; refactor: none
- cycle 6.16 [covered=16]: status never calls fetch in any state, a ready home is usable with fetch stubbed to throw, and no source under src/cuisHome references the repo-local Cuis7-8-main or .headless-base paths — red: no network in any status, offline reuse of a ready home, static guard against repo-local paths and server wiring, all green on arrival; green: none; refactor: phase-end next
- cycle 6.17 [covered=17]: a mid-stream connection reset never produces an unhandled error or rejection, over repeated runs — red: could not reproduce the one observed unhandled ERR_STREAM_DESTROYED; added two regression guards (30 mid-stream resets, tmp dir vanishing mid-download) plus a chunkSize/chunkGapMs option in testSupport archiveServer; green: defensive fix in fetchArchive (error listener on the write stream, no write after destroy, write errors classified as cuis_write_failed), not demonstrably test-driven; refactor: none

## Phase 6 — [TDD] cuisHome.ts

cuisHomeStatus and prepareCuisHome cover invariants 1 to 20, 30 to 32. 17 cycles, about 24 tests in cuisHome.test.ts. Real defects found by tests: failed status visible before tmp cleanup (lock now released last), ready-with-live-lock window (status reports preparing until the lock is gone), stale error file and foreign tmp leftovers on retry. Deviations: no SIGTERM, SIGINT or exit handlers that kill the smoke-boot VM (spec mentioned them; the VM has its own time limit and process group, so it ends by itself); defensive stream error handling is not proven by a deterministic test; the unwritable-home test passes silently as root. Phase-end refactor done.

### Phase 7 cycles

- cycle 7.1 [covered=1]: runWithSharedCuis on a non-macOS platform rejects with unsupported_platform before reading status or starting any process — red: platform guard for runWithSharedCuis; green: run.ts with guard, rest not implemented; refactor: deferred
- cycle 7.2 [covered=2]: runWithSharedCuis refuses a missing or failed home with cuis_missing and a preparing home with cuis_initializing, making no network request — red: refusal states with no fetch; green: status mapped to cuis_missing and cuis_initializing; refactor: deferred
- cycle 7.3 [covered=3]: on a ready home runWithSharedCuis runs the script on dist and base and returns passed, leaving base byte-identical and working offline — red: ready home run, offline, base and dist unchanged; green: runHeadless on dist and base, DIST_DIR and BASE_DIR exported from cuisHome.ts; refactor: deferred
- cycle 7.4 [covered=4]: a ready home with a missing VM, base image, sources or changes file is refused with cuis_corrupt naming the directory to delete, without starting any process — red: four damaged parts gave setup_error or passed instead of cuis_corrupt; green: fs.access checks of VM, image, sources and changes before running; refactor: deferred; side finding: runner.test.ts grandchild test flaked under load (see 7.5)
- cycle 7.5 [covered=4]: runner kill tests no longer depend on the VM script starting within the time limit, so they pass reliably under parallel load — red: deflaked two runner kill tests (larger timeout, abort only after pid file exists), 6 full-folder runs green, no stray processes; green: none, tests only; refactor: none

## Phase 7 — [TDD] run.ts

runWithSharedCuis covers invariants 11, 17, 20, 30 on top of the runner. 5 cycles, 6 tests in run.test.ts. Cycle 7.5 deflaked two runner tests that failed under parallel load (found while verifying 7.4). Phase-end refactor done: shared MACOS_ONLY_MESSAGE exported from cuisHome.ts.

## Phase 8 — [Scaffold] realCuis.integration.test.ts

Wrote the opt-in integration test (CUIS_INTEGRATION=1, darwin only). Skipped by default, tsc clean, 64 tests pass and 1 skipped. Real run, partially verified: the real GitHub archive downloaded and the pinned SHA-256 matched, but the smoke boot failed with cuis_base_build_failed and an EMPTY message because the real VM exits 0 silently without running -s scripts in the agent environment (same VM binary also made the repo's own headless harness time out earlier). Steps 2 to 4 of the test never ran. Unverified here; needs a manual run from a normal terminal. Also noted: an empty VM output yields a bare cuis_base_build_failed message with no hint, worth improving.

## Phase 9 — [Scaffold] README docs

Root README: Setup paragraph on the shared Cuis and Testing bullet with the opt-in integration command. mcp-bridge/README.md: new Shared Cuis home section (layout, pinning and verification, runs, nine error kinds). Error kinds not added to Troubleshooting because no MCP tool exposes them yet.

Built src/cuisHome/ in the bridge server: a pinned per-user shared Cuis home (status, on-demand preparation with SHA-256 verification, extraction, smoke-booted frozen base, atomic publish, crash recovery) and a parameterized headless runner (scratch copy per run, process-group kill on timeout or abort, merged ordered output), plus runWithSharedCuis. 316 tests pass with 1 opt-in skip, tsc is clean, and no existing source file changed. Deviations from the spec: processLock.ts is not a verbatim port of mirror.ts, because a concurrency test found a two-winner race in its rename-aside takeover, so takeover is now serialized by an exclusive .takeover marker (mirror.ts likely has the same race, untouched, follow-up). cuisHomeStatus reports preparing while a layout dir coexists with a live lock. No SIGTERM or exit handlers kill the smoke-boot VM. The defensive stream error handling in fetchArchive is not proven by a deterministic test. The real-VM integration test now passes (CUIS_INTEGRATION=1). It first exposed three defects the fake VM could not: the completion-marker regex was anchored at line start but the real VM prefixes Transcript lines with a timestamp (fixed in runner.ts); the smoke script lacked `Transcript logToStdout: true.`, without which a headless Cuis prints nothing (fixed in cuisHome.ts, with `newLine` instead of `cr`); and two integration-test scripts had the same omission or used `//` for a directory. Each fix was test-first, and the fake VM now mimics the prefix and requires logToStdout. Follow-up for run-smalltalk-headless: its tool must prepend `Transcript logToStdout: true.` to user scripts or document the requirement. Dynamic verification then found that real runs wrote `dist/UserChanges/*` (VM cwd is dist/); fixed test first by cleaning `UserChanges` after each run and after the smoke boot (new src/cuisHome/userChanges.ts), and 314 tests now pass with 1 opt-in skip. A later pass fixed relative scriptPath handling (runHeadless resolves it against the caller's cwd, test first), added a default-home test, and verified on the real VM beside a live instance; 316 tests now pass with 1 opt-in skip. The failure-path dynamic run found and fixed an uncaught undici assertion when downloading from an HTTP/1.0 close-after-body server (fetchArchive now buffers the body instead of pausing it), added pin.test.ts and a concurrency test for invariant 28, and the driver gained CUIS_ARCHIVE_URL, CUIS_ARCHIVE_SHA256, CUIS_PLATFORM and runhl; 325 tests now pass with 1 opt-in skip.

Follow-ups: once `run-smalltalk-headless` exposes the shared home as an MCP tool and the repo's own Cuis setup is retired in favor of it, fold `.claude/skills/run-cuis-shared-setup` into `.claude/skills/run-cuis-mcp-bridge` (one recipe, one driver) and delete the former.

## Implementation files

- mcp-bridge/server/src/cuisHome/pin.ts
- mcp-bridge/server/src/cuisHome/pin.test.ts
- mcp-bridge/server/src/cuisHome/errors.ts
- mcp-bridge/server/src/cuisHome/errors.test.ts
- mcp-bridge/server/src/cuisHome/runner.ts
- mcp-bridge/server/src/cuisHome/runner.test.ts
- mcp-bridge/server/src/cuisHome/processLock.ts
- mcp-bridge/server/src/cuisHome/processLock.test.ts
- mcp-bridge/server/src/cuisHome/cuisHome.ts
- mcp-bridge/server/src/cuisHome/cuisHome.test.ts
- mcp-bridge/server/src/cuisHome/run.ts
- mcp-bridge/server/src/cuisHome/run.test.ts
- mcp-bridge/server/src/cuisHome/realCuis.integration.test.ts
- mcp-bridge/server/src/cuisHome/testSupport/fakeVm.ts
- mcp-bridge/server/src/cuisHome/testSupport/fakeDistribution.ts
- mcp-bridge/server/src/cuisHome/testSupport/archiveServer.ts
- mcp-bridge/server/src/cuisHome/testSupport/tempHome.ts
- mcp-bridge/server/src/cuisHome/testSupport/testSupport.test.ts
- README.md
- mcp-bridge/README.md
- .claude/skills/run-cuis-shared-setup/SKILL.md
- .claude/skills/run-cuis-shared-setup/driver.mjs
- initiatives/cuis-shared-setup/verify-static-report.md
- mcp-bridge/server/src/cuisHome/userChanges.ts
- initiatives/cuis-shared-setup/verify-dynamic-report.md
