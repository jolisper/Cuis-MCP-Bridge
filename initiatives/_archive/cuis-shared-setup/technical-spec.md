# cuis-shared-setup — technical spec

Behavior is defined in `functional-spec.md`; invariants are cited by number (`#N`).

## Context

Today the Cuis distribution is fetched by `tools/fetch-cuis.sh` (unpinned `refs/heads/main`
zip, no verification) into `Cuis7-8-main/`, and `tools/run-headless-tests.sh` is the only
headless runner: it builds `.headless-base` from the zip (image, sources, changes plus
`JSON.pck.st` and `Network-Kernel.pck.st`), copies it to a scratch dir, runs
`Squeak -headless <image> -s <script>` with a `kill -9` watchdog, and treats the absence of a
`DONE exitCode=` line in the output as timeout/crash (exit 124). Those scripts stay untouched.

The server (`mcp-bridge/server/src`) already has the pattern to follow: the VM source mirror in
`vmSource/`. `mirror.ts` keeps its state as siblings under `~/.cuis-mcp-bridge/`
(`vm-mirror/` = ready, `vm-mirror.lock` = JSON `{pid, startTime}` live-checked via `ps`,
`vm-mirror.tmp-<pid>` = in-progress, `vm-mirror.error` = last failure, consumed once), builds in
the temp dir and renames into place (`mirror.ts:210-237`, `:311-315`). Errors are a code-tagged
class (`vmSource/errors.ts:22`). Tools are built by `createVmSourceTools` (`vmSource/tools.ts:26`)
with injectable options, and tests inject a `home` temp dir plus fake binaries
(`vmSource/testSupport/harness.ts`). `index.ts` and `tools.ts:174` are not touched: this
initiative adds no MCP tool (the tool belongs to `run-smalltalk-headless`).

## Proposed changes

All new code, in a new directory `mcp-bridge/server/src/cuisHome/`. No existing source file
changes.

**`pin.ts`** — the constants file (initiative decision): release label `7.8`, commit SHA
`d4f9cc1243175bd022c1b5dfa6a6a432fb07a035`, SHA-256 of that commit's zip, archive URL
`https://github.com/Cuis-Smalltalk/Cuis7-8/archive/<sha>.zip`, the layout key `7.8-d4f9cc1`
(`<release>-<first 7 of sha>`), and the file names inside the distribution (image, sources,
changes, VM path) so the Cuis version appears in exactly one place (#1, #3, #12, #13).

**`errors.ts`** — `HeadlessError(code, message)` with codes `unsupported_platform`,
`cuis_missing`, `cuis_initializing`, `cuis_fetch_failed`, `cuis_checksum_mismatch`,
`cuis_write_failed`, `cuis_base_build_failed`, `cuis_corrupt`, `internal_error`. Same
`"<code>: <message>"` rendering as `vmSource/tools.ts:15`. A separate class rather than widening
`VmSourceErrorCode`, which is VM-source specific.

**`processLock.ts`** — the lock/stale-takeover algorithm of `mirror.ts:75-183`, generalized to a
lock-file path argument. Tradeoff: copying instead of extracting leaves `mirror.ts` (and its
632-line test file) untouched, keeping this initiative purely additive, at the cost of a
duplicated subtle algorithm. Chosen on purpose; deduplicating is a follow-up.

**`cuisHome.ts`** — state and preparation for one pinned Cuis home under
`<home>/cuis/<key>/` (default `home` = `~/.cuis-mcp-bridge`, injectable like the mirror).
Layout (#2, #4):

```
cuis/<key>/dist/    extracted distribution (CuisVM.app, CuisImage, Packages, ...)
cuis/<key>/base/    frozen base: <name>.image, .sources, .changes copied from dist/CuisImage
cuis/<key>.lock | .error | .tmp-<pid>   siblings, exactly as vm-mirror.*
```

- `cuisHomeStatus(opts)` — read-only, no network (#6): `ready` if `<key>/` exists, `preparing`
  if the lock is live, `failed` (with the recorded `{code, message}`) if an error file exists
  and nothing is live, else `missing`. Unlike the mirror, status does not consume the error.
- `prepareCuisHome(opts)` — returns `'ready' | 'in_progress' | 'started'` (#7, #9). Platform
  check first (`unsupported_platform`, #30), then acquire the lock (a failed or stale state is
  cleaned: error file removed, leftover `.tmp-*` removed, #10, #16), then start the work in the
  background without awaiting it. Work: stream the archive with global `fetch` into
  `<key>.tmp-<pid>/archive.zip` while feeding a SHA-256 hash; compare with the pin before
  anything else touches it (#13); extract with `/usr/bin/unzip` (already what the reference
  script uses; no new dependency); copy the three image files into `base/`; smoke-boot the
  base through the runner with a generated one-line script that prints `DONE exitCode=0` and
  quits, so a base that cannot boot fails here (#18, #19); delete `archive.zip`; rename the tmp
  dir to `<key>/` (the atomic "ready" edge, #8); release the lock. Any failure writes the error
  file (atomic temp+rename as `mirror.ts:289`), removes the tmp dir and releases the lock
  (#14, #15). Failure mapping: fetch rejection or non-200 → `cuis_fetch_failed`; hash mismatch →
  `cuis_checksum_mismatch` with expected/actual; EACCES/ENOSPC/EROFS → `cuis_write_failed`;
  smoke boot failing or exceeding its limit → `cuis_base_build_failed` with VM output.
  In-flight children are killed on process exit and on SIGTERM/SIGINT/SIGHUP like
  `mirror.ts:255-261`; a hard kill is covered by the live-lock check, which treats the dead pid
  as stale (#16).
- No network and no work at server start; nothing here is imported by `index.ts` (#31).

**`runner.ts`** — `runHeadless({cuisDir, baseDir, scriptPath, timeoutMs, cwd?, vm?, signal?})`
→ `{outcome, exitCode, output}` (#21). It never throws for a run-level condition:
1. Validate pieces: script file, VM (default `<cuisDir>/CuisVM.app/Contents/MacOS/Squeak`,
   overridable so tests can use a fake VM), a single `*.image` in `baseDir`. Missing → outcome
   `setup_error` (2), nothing spawned (#24).
2. `mkdtemp` a scratch dir, copy every file of `baseDir` into it (#22), always `rm -rf` it in
   `finally`, including on abort, timeout and runner exceptions (#23).
3. Spawn the VM with `-headless <scratch image> -s <script>`, `detached: true`, stdin ignored,
   stdout and stderr both redirected to one log file in the scratch dir (preserves interleaving,
   bounded memory, #25). `cwd` defaults to `cuisDir` so the script's relative package paths
   resolve (the reference script `cd`s to the repo for the same reason).
4. Timer kills the whole process group (`process.kill(-pid, 'SIGKILL')`, #26); an abort of
   `signal` does the same; a run that ends early clears the timer.
5. Read the log. Marker rule is the reference's: no `DONE exitCode=` line → `timeout_or_crash`
   (124); otherwise exit status 0 → `passed`, nonzero → `failed` (exit code carried through).
   The run is independent of the process cwd (#29) and uses nothing but its arguments, so
   concurrent runs only share the read-only base (#22, #28, #27).

**`run.ts`** — `runWithSharedCuis(opts, {scriptPath, timeoutMs, signal?, cwd?})`: the home-aware
entry point the run tool will call. Platform check (#30); read status; `missing`/`failed` →
`cuis_missing`, `preparing` → `cuis_initializing` (#11, never fetches); `ready` but with a missing
VM, image, sources or changes → `cuis_corrupt` naming the directory to delete (#20); else
`runHeadless` on `dist/` and `base/`. Status check is cheap `fs.access`, not a re-hash.

**Docs** — root `README.md` (Cuis location section) and `mcp-bridge/README.md` get a short note on
the shared location and that it is not yet used by the repo's own scripts (per the keep-README-in-
sync rule). `PROTOCOL.md` and the test skill are not touched.

## Implementation sequence

1. Compute the pin: download the commit archive twice, confirm identical SHA-256, record it —
   `src/cuisHome/pin.ts`
2. `src/cuisHome/errors.ts` — `HeadlessError` and codes
3. `src/cuisHome/testSupport/` — fake VM script, tiny fake-distribution zip builder, local HTTP
   archive server, temp-home helper
4. `src/cuisHome/runner.ts` (+ `runner.test.ts`) — `runHeadless`
5. `src/cuisHome/processLock.ts` (+ test) — generalized lock
6. `src/cuisHome/cuisHome.ts` (+ `cuisHome.test.ts`) — status and preparation
7. `src/cuisHome/run.ts` (+ `run.test.ts`) — `runWithSharedCuis`
8. `src/cuisHome/realCuis.integration.test.ts` — opt-in test against the real pinned archive
9. `README.md`, `mcp-bridge/README.md` — document the shared location

## Testing and validation

All new tests are Vitest in `src/cuisHome/`, run by the existing `npm test --prefix
mcp-bridge/server`. The fake VM is a shell script that copies nothing and prints/quits per the
script it is given, so tests need no real Cuis and run on any platform; platform-gated cases
inject `platform`.

- #1–#3, #32 — `cuisHome.test.ts`: with an injected `home`, the finished layout sits at
  `<home>/cuis/7.8-d4f9cc1/`; a pin with a different key produces a sibling dir and leaves the
  first byte-identical; deleting a ready home yields `missing` with no siblings left.
- #4 — the checkout's `Cuis7-8-main/` and `.headless-base` are not referenced anywhere in
  `src/cuisHome/` (grep assertion in the test) and `git status` shows no change under `tools/`.
- #5–#7, #9, #10 — state machine tests: status in each state without network (fetch stubbed to
  fail if called); prepare on `ready` is a no-op; two concurrent `prepareCuisHome` calls cause
  one download (counted on the local server); after a forced failure, status is `failed` with the
  recorded error and the next prepare reports `started` and can succeed.
- #8, #16 — kill the preparing process mid-download (child node process, as `mirror.test.ts` does
  for the clone): afterwards status is never `ready`/`preparing`, and a new prepare completes.
- #12–#15 — local HTTP server serves the fake zip: correct hash → ready; wrong hash →
  `cuis_checksum_mismatch` and no `<key>/` or tmp dir; server down / 404 / mid-stream reset →
  `cuis_fetch_failed`; unwritable home (chmod) → `cuis_write_failed`.
- #17 — after ready, run with the HTTP server stopped and `fetch` stubbed to throw.
- #18–#20 — fake VM that fails to boot → `cuis_base_build_failed` with its output, home not
  ready; remove `base/*.image` from a ready home → `cuis_corrupt`; base files byte-identical
  (hash) before and after runs.
- #21–#29 — `runner.test.ts` with a directory pair that is not a shared home; fake VM scripts for
  pass (0), fail (1), no marker (124), hang (killed at timeout, including a grandchild process the
  fake VM spawns, checked gone); missing VM/script/image → `setup_error` with no spawn; scratch
  dir count in `os.tmpdir()` unchanged after each outcome and after `AbortSignal`; two
  simultaneous runs writing distinct files into their scratch copy do not see each other; output
  of a >1 MB run returned in full and in order; running from two different process cwd values
  gives the same result.
- #11 — `run.test.ts`: `missing`, `preparing` and `failed` homes refuse with the right code and the
  HTTP server records zero requests.
- #30 — `platform: 'linux'` injected: `prepareCuisHome` and `runWithSharedCuis` reject with
  `unsupported_platform` before the HTTP server or VM is touched.
- #31 — existing suites still pass unmodified; the new directory is not imported from `index.ts`
  or `tools.ts` (the full `npm test` run plus a build).
- Real-world check (the logbook's drift/risk mitigation): `realCuis.integration.test.ts`, skipped
  unless `CUIS_INTEGRATION=1`, prepares a home from the real pinned archive in a temp `home`, then
  runs a trivial script and a script that uses `Packages/` relative paths. Run once manually before
  merge on macOS; asserts the checksum from step 1 and a booting base.

## Risks and mitigations

- GitHub commit archives might not be byte-stable, which would break the zip checksum without any
  tampering. Mitigation: step 1 downloads twice; if hashes differ, switch to hashing the extracted
  tree (already the logbook's stated fallback) before writing `pin.ts`.
- The archive's top-level directory name is assumed to be `Cuis7-8-<full sha>/`; confirmed in
  step 1, kept as a `pin.ts` constant. A wrong assumption shows up as `cuis_corrupt`-style failure
  in the integration test, not silently.
- Invariant 18 says the base is built "headlessly"; the reference only copies files. This plan
  copies the pristine image and then verifies it by a headless smoke boot, so it satisfies the
  failure behavior of #19 without mutating the pristine image. If a later need arises to
  load packages into the base, that is a new decision, not part of this plan.
- `/usr/bin/unzip` is assumed present (macOS-only, same as the reference). Its absence surfaces as
  `cuis_write_failed` carrying the spawn error.
- A server killed with SIGKILL during the smoke boot can leave a VM process; the VM is spawned in
  its own group and has the preparation time limit, so it ends by itself. Accepted.

## Follow-ups

- Make `mirror.ts` use `processLock.ts` and delete the duplicate.
- Retire the repo's own Cuis setup in favor of this one (already logged as the next initiative).
