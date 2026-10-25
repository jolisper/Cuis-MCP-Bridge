# run-smalltalk-headless — technical spec

Behavior is defined in `functional-spec.md`; invariants are cited by number (`#N`).

## Context

The server (`mcp-bridge/server/src`) builds its tool list in `createTools` (`tools.ts:152-175`):
13 Cuis-forwarded tools plus host-side tools from `createVmSourceTools` (`vmSource/tools.ts:26`),
which take injectable options (tests inject a temp `home`) and render failures as
`"<code>: <message>"` with `isError: true` (`vmSource/tools.ts:15`). `ToolDefinition.handler` takes
only `args` (`tools.ts:12-17`); `index.ts:31-40` calls it without the MCP request's abort signal.

`cuis-shared-setup` already provides everything below the tool (`src/cuisHome/`):
`runWithSharedCuis(opts, {scriptPath, timeoutMs, signal?, cwd?})` (`run.ts:77`) returns
`{outcome: passed|failed|timeout_or_crash|setup_error, exitCode, output}` and throws `HeadlessError`
for `unsupported_platform`, `cuis_initializing`, `cuis_missing` (also for a failed preparation),
`cuis_corrupt`. It never fetches. `cuisHomeStatus` / `prepareCuisHome` (`cuisHome.ts`) give the
state and start the background preparation. The runner decides `passed`/`failed` from the VM exit
status and a `DONE exitCode=` line (`runner.ts:30`), runs the VM with cwd `dist/`, and merges
stdout/stderr unbounded in `output`. It knows nothing about results, test counts or truncation;
those are this initiative's job. Constraint from the real VM: Transcript output is invisible unless
the script starts with `Transcript logToStdout: true.`, and Transcript lines carry a timestamp
prefix. Package install idiom already in the repo: `CodePackageFile installPackage: <entry>`
(`mcp-bridge/image/run-tests.st:5`).

## Proposed changes

New directory `src/runSmalltalk/`, purely additive except two small edits to existing files.

**Tool `run_smalltalk`** (`tool.ts`, `createRunSmalltalkTool(opts)`): input `{code: string,
packages?: string[], timeoutSeconds?: number}`. Options are injectable like the VM source tools:
`home`, `platform`, and `run`/`status`/`prepare` functions defaulting to the `cuisHome` ones, so
tests need no VM. Handler flow:

1. Validate input (#1-#6): `code` non-empty string; each package resolved against `process.cwd()`
   (the MCP server is launched in the session directory), must be an existing regular `.pck.st`
   file; `timeoutSeconds` an integer in range. **Default 60 s, maximum 300 s** (the reference
   script's default; resolves the open question in #6). Failure → `setup_error` outcome with codes
   `invalid_code`, `package_not_found`, `package_not_pck`, `invalid_timeout`, from a local
   `RunInputError` class (not widening `HeadlessError`). Nothing is fetched or started (#4, #5).
2. Check the home with `cuisHomeStatus` (macOS guard first, #28): `missing` → call
   `prepareCuisHome`, return `setup_error` `cuis_missing` ("preparation started"); `preparing` →
   `cuis_initializing`; `failed` → return the recorded specific code (`cuis_fetch_failed`,
   `cuis_checksum_mismatch`, `cuis_write_failed`, `cuis_base_build_failed`) and start a fresh attempt
   in the same call, so the next call reports `cuis_initializing` (#23-#26). Tradeoff: #26 says the
   next call after a failure retries; starting the retry immediately after reporting is simpler and
   never repeats a stale error. `ready` → continue. `cuis_corrupt` comes from `runWithSharedCuis`.
3. `mkdtemp` a per-call dir `cuis-mcp-run-*` under `os.tmpdir()` holding `user-code.st` (the
   caller's code verbatim) and `harness.st`; removed in `finally`, including on abort (#19, #30).
4. Call `runWithSharedCuis({home}, {scriptPath: harness.st, timeoutMs, signal})`.
5. Parse, build the outcome, truncate, return JSON (`isError: true` only for `setup_error`).

**Harness script** (`harness.ts`, `buildHarness({nonce, codePath, packagePaths})`): Smalltalk text,
all strings escaped. It starts with `Transcript logToStdout: true.` (#16), then each step runs in
its own `[...] on: Error, Warning do:` handler so nothing opens a debugger and hangs (#14, logbook
2026-10-23): install each package with `CodePackageFile installPackage:`; read `user-code.st` and
`Compiler evaluate:` it; capture the value. It then prints single-line markers, each carrying a
fresh random per-run `nonce` so caller output cannot forge them:
`<nonce> RESULT <escaped printString>`, `<nonce> ERROR <escaped description>` (with the stage:
package path or code), and, if the value `isKindOf: TestResult`, `<nonce> TESTS run=N passed=N
failures=N errors=N` plus `<nonce> FAILING <id>` / `<nonce> ERRORING <id>` lines (id =
`ClassName>>#selector`). Escaping is one line: `\` → `\\`, newline → `\n`. Last it prints
`DONE exitCode=N` and `Smalltalk quitPrimitive: N` with N = 1 on any error/failure/error-test,
else 0. A single line per marker avoids having to strip Transcript timestamp prefixes: the parser
locates the nonce inside a line and reads what follows.

**Parsing and limits** (`outcome.ts`): from the full output, extract markers; remove marker lines
from the displayed `output`; then cap output at 64 KB (first 16 KB + last 48 KB, with a visible
cut marker) and result at 4 KB, setting `truncated` and `outputBytes` (#15). Status table:
`passed` (runner passed, no ERROR marker, no failing tests), `failed` (ERROR marker, failing tests,
or runner `failed`), `timeout` (runner `timeout_or_crash`), `setup_error` (runner `setup_error`
or input/home errors). The runner already streams output to a log file, so memory is bounded by
the file read; the tool reads it once and caps what it keeps in the response. Errors render as
`error: "<code>: <message>"` in the outcome (#8).

**Cancellation** (#30): `ToolDefinition.handler` gains an optional second argument
`{signal?: AbortSignal}`; `index.ts` passes the MCP request's `extra.signal` combined
(`AbortSignal.any`) with a process-wide controller aborted on SIGTERM/SIGINT/stdin end. Existing
handlers ignore the argument. The signal goes to `runWithSharedCuis`, which kills the process group.

**Wiring**: `createTools` appends `createRunSmalltalkTool(runSmalltalk)` with a new optional options
argument. The tool does not use `CuisClient` and does no work at load (#20, #29).

**Docs**: `PROTOCOL.md` sentence reworded to scope read-only/no-evaluation to the live-image wire
channel (no version bump, #32); root `README.md` and `mcp-bridge/README.md` (tool, parameters,
outcomes, side-effects warning, first-use flow, write location `dist/`, #22); the
`test-cuis-mcp-bridge` skill gets a pointer. The tool `description` tells the assistant to review
code for host side effects, ask the user and wait for explicit confirmation before running, and what each error code means.

## Implementation sequence

1. `src/runSmalltalk/realRun.integration.test.ts` — opt-in (`CUIS_INTEGRATION=1`) real-VM test skeleton
2. `src/runSmalltalk/errors.ts` — `RunInputError` and codes
3. `src/runSmalltalk/input.ts` — input validation and path resolution
4. `src/runSmalltalk/harness.ts` — Smalltalk harness generator and escaping
5. `src/runSmalltalk/outcome.ts` — marker parsing, status table, truncation
6. `src/runSmalltalk/tool.ts` — handler flow, first-use handling, scratch dir, cancellation
7. `src/tools.ts`, `src/index.ts` — handler signal argument, wiring, shutdown abort
8. `README.md`, `mcp-bridge/README.md`, `mcp-bridge/PROTOCOL.md`, `.claude/skills/test-cuis-mcp-bridge/SKILL.md` — docs

## Testing and validation

Vitest in `src/runSmalltalk/`, run by `npm test --prefix mcp-bridge/server`. Unit tests inject fake
`status`/`prepare`/`run`; the real-VM test is run once early (step 1, finished at step 6), because the
fake VM hid four real defects in `cuis-shared-setup`.

- #1-#6 — `input.test.ts`: every invalid input yields the specific code and path, with
  `prepare` and `run` spies never called; relative paths resolve against `process.cwd()`;
  out-of-range timeout rejected, default and maximum applied.
- #2, #9-#11 — `outcome.test.ts` with canned runner output (including timestamp-prefixed lines):
  passed, failed by error, failed by test failures, `tests` present only for TestResult, absent
  otherwise; real-VM test runs `3 + 4`, a passing and a failing SUnit suite.
- #7, #8, #12, #13 — status table over all runner outcomes; every outcome has the required fields;
  timeout test with a real hanging script bounded by timeout plus grace.
- #14 — real-VM: syntax error, runtime error and a package that fails to load each end `failed`
  well before the timeout.
- #15 — `outcome.test.ts`: 1 MB output → 64 KB with first 16/last 48 KB, `truncated`, `outputBytes`;
  status derived from the full stream even when the marker lies in the cut part; 4 KB result cap.
- #16 — `harness.test.ts`: script begins with `logToStdout`; real-VM output shows Transcript text.
- #17, #18, #19 — real-VM: a run defining a class is invisible to the next; two simultaneous calls
  independent; after each outcome no `cuis-mcp-run-*` or `cuis-run-*` dir remains and the base
  files hash identically.
- #20 — tool test where the `CuisClient` fails on any send; the call still succeeds.
- #21 — package file hash and mtime unchanged after a run with it.
- #22 — documented text asserted in the tool description; real-VM relative write lands in `dist/`.
- #23-#27 — `tool.test.ts` with fake status/prepare: missing starts exactly one preparation and
  executes nothing; preparing starts none; each failed code is surfaced and followed by a fresh
  attempt; ready needs no network (fetch stubbed to throw); corrupt names the directory.
- #28 — `platform: 'linux'`: `setup_error` unsupported-platform, no spy called.
- #29 — importing `tools.ts` performs no fs/network calls (spy at load).
- #30 — abort mid-run: process group gone and scratch removed (fake VM with grandchild, as in
  `runner.test.ts`); `index.ts` signal combination covered by a unit test of the helper.
- #31 — real-VM run with the tool's cwd set to an empty temp directory.
- #32, #33 — existing suites pass unchanged (`tools.test.ts` tool count updated); `git diff` shows no
  change under `tools/`; PROTOCOL.md diff limited to the sentence, version constant untouched.

## Risks and mitigations

- Cuis API details are unverified: `Compiler evaluate:`, loading a package from an absolute path
  (`'/abs' asFileEntry`), `TestResult` accessors and test ids. Mitigation: step 1 real-VM test
  validates each before the harness is finalized; adjust the generator, not the design.
- Code that calls `Smalltalk quit` or snapshots skips the markers: the runner reports
  `timeout_or_crash`/no DONE, mapped to `timeout`. Accepted and documented (#22, #12).
- A marker-looking line printed by caller code is harmless without the nonce.
- Output after the harness's own result markers (e.g. forked processes) is kept in `output` but
  never affects status.

## Follow-ups

- Fold `.claude/skills/run-cuis-shared-setup` into `run-cuis-mcp-bridge` once this ships.
- Make `cuis_base_build_failed` explain empty VM output (from `cuis-shared-setup`).
- Optional progress surface for long first-use preparation.
