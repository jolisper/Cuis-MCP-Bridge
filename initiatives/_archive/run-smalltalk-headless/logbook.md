---
status: archived
archived: 2026-10-24
started: 2026-10-23
spec: /Users/jolisper/Source/Cuis-MCP-Bridge/initiatives/run-smalltalk-headless/technical-spec.md
last-completed-phase: 9
---

## 2026-10-23 — open questions resolved

- Code delivery: write the code to a file in a per-run scratch directory; the harness reads it
  and evaluates it. Every harness step runs inside an error handler (an unguarded error in a
  headless image hangs until the watchdog; the earlier prototype hung on a nonexistent
  `DirectoryEntry fromString:`, not on file reading).
- Protocol wording: reword PROTOCOL.md's read-only/no-evaluation sentence to scope it to the
  live-image wire channel and mention host-side tools; no PROTOCOL_VERSION bump; archived
  functional-spec untouched; new spec states the tool never evaluates in, or reads from, the
  live image.
- Package paths: any existing regular `.pck.st` file; relative paths resolve against the
  session's working directory (not the bridge checkout), made absolute before the run; invalid
  paths give a `setup_error` with a specific code; dependencies (JSON, Network-Kernel) listed
  explicitly by the caller. Code is not sandboxed: the assistant must review it for host side
  effects (file writes, network, processes, quit/snapshot, dynamic evaluation) and tell the
  user; no tool-side scan. Relative writes land in the bridge checkout (runner cds there):
  documented warning.
- Test detail: `result` is the printString; a `tests` object `{ run, passed, failures, errors }`
  with test ids only when the value is a TestResult; failed on any failure or error.
- Output limits: output capped at 64 KB (first 16 KB + last 48 KB), result at 4 KB, with
  `truncated` and `outputBytes`; markers parsed from the stream before truncation; no
  parameter; the timeout bounds floods.
- Reuse tools/run-headless-tests.sh unmodified; the harness must print `DONE exitCode=N` then
  quit. Known limit: concurrent first runs may race populating `.headless-base`.
- Base image: bundled pristine Cuis + caller-listed packages (not the project's image, not a
  copy of the live image).
- Runner/Cuis location (supersedes "reuse the script unmodified"): the runner and harness ship
  inside the bridge server (not downloaded; avoids fetching executable code at run time); the
  Cuis distribution is downloaded on first need into `~/.cuis-mcp-bridge/`, version-keyed,
  pinned to a tag/commit with checksum verification; first-use handled like `setup_vm_mirror`
  (background fetch, `cuis_missing`-style code). The script is parameterized (Cuis dir,
  frozen-base dir) instead of hard-coding the repo root. This repo's own tools (setup.sh,
  run-headless-tests.sh, run-vm-primitive-test.sh) adopt the same setup ("eat our own dog
  food"), enabling multiple Cuis versions later.
- Split in two (2026-10-23): `cuis-shared-setup` first (shared per-user versioned Cuis location
  with pinned, verified on-demand fetch; parameterized runner shipped with the server; this
  repo's setup/test scripts migrated onto it), then this initiative (the run tool on top).
  Decisions above about the runner, Cuis location and migration belong to `cuis-shared-setup`.

## 2026-10-23 — runner and Cuis location superseded by cuis-shared-setup

`cuis-shared-setup` resolved its open questions after the entries above were written. Where they
differ, it wins (see `initiatives/cuis-shared-setup/logbook.md`):

- The runner is a TypeScript reimplementation inside the server, not a parameterized shell
  script. "Reuse tools/run-headless-tests.sh unmodified" and "the script is parameterized" no
  longer apply; the script remains only the behavioral reference (scratch copy of the frozen
  base, watchdog, `DONE exitCode=N` marker, exit codes 0/1/124/2).
- Pinning is a commit SHA of the `Cuis7-8` repo verified by SHA-256 of the zip, held in a
  server source constants file; layout key is release plus short commit under
  `~/.cuis-mcp-bridge/`. Not "tag/commit".
- This repo's own tools (setup.sh, run-headless-tests.sh, run-vm-primitive-test.sh) are not
  migrated; the repo's setup is untouched and retired in a later initiative. The dogfooding
  decision no longer applies.
- The `.headless-base` race note is moot for the new setup; the shared frozen base is built by
  the server, and concurrent first-run handling is a technical-spec concern.

## 2026-10-24 — cuis-shared-setup completed: what this initiative now inherits

Read from `initiatives/_archive/cuis-shared-setup/` (spec, logbook). Adjustments:

- Entry point is `runWithSharedCuis(opts, {scriptPath, timeoutMs, signal?, cwd?})`; it returns
  `{outcome, exitCode, output}` and throws `HeadlessError` for home problems. Output is one merged,
  ordered log; the 64 KB cap and marker parsing are this tool's job.
- First use: `runWithSharedCuis` never fetches. The tool calls `prepareCuisHome` on
  `cuis_missing`, then reports `cuis_initializing`-style progress like `setup_vm_mirror`.
- The runner's cwd defaults to the home's `dist/`, not the bridge checkout. This supersedes the
  "relative writes land in the bridge checkout" warning: they land in `dist/` (the runner cleans
  `UserChanges/` after each run). Package paths are made absolute before the run, as already decided.
- The tool must prepend `Transcript logToStdout: true.` to the script (shared-setup follow-up), and
  the harness must print the `DONE exitCode=N` line; the marker may carry a timestamp prefix.
- Base is pristine Cuis only; JSON and Network-Kernel are not preloaded. Callers list them (they
  are under `dist/Packages`).
- `scriptPath` may be relative (resolved against the caller's cwd); we write absolute scratch paths.
- Error codes to map into the tool's code-tagged style: `unsupported_platform` (macOS only),
  `cuis_missing`, `cuis_initializing`, `cuis_fetch_failed`, `cuis_checksum_mismatch`,
  `cuis_write_failed`, `cuis_base_build_failed`, `cuis_corrupt`, `internal_error`.
- Concurrent first runs: handled by the home's lock; the tool just reports `cuis_initializing`.
- Known gaps: invariant 17 (offline) not verified against the real VM; `cuis_base_build_failed`
  has a bare message on empty VM output; `.claude/skills/run-cuis-shared-setup` is to be folded
  into `run-cuis-mcp-bridge` once this ships.

# Implementation Log: run-smalltalk-headless

Implementing the run_smalltalk host-side MCP tool in mcp-bridge/server (src/runSmalltalk/): validates input, generates a Smalltalk harness with nonce-tagged markers, runs it via runWithSharedCuis, and returns a structured, truncated outcome; plus cancellation plumbing, wiring and docs. Nine phases, starting at phase 1. Done means every functional invariant has a passing Vitest test (real-VM tests opt-in), the full suite and build pass, and docs are updated.

## Phase Plan

1. [Scaffold] src/runSmalltalk/realRun.integration.test.ts - opt-in real-VM test skeleton
2. [TDD] src/runSmalltalk/errors.ts - RunInputError
3. [TDD] src/runSmalltalk/input.ts - input validation
4. [TDD] src/runSmalltalk/harness.ts - harness generator
5. [TDD] src/runSmalltalk/outcome.ts - parsing, status, truncation
6. [TDD] src/runSmalltalk/tool.ts - handler flow
7. [TDD] signal combination helper
8. [Scaffold] src/tools.ts, src/index.ts - wiring
9. [Scaffold] docs

## Phase 1 — [Scaffold] realRun.integration.test.ts

Wrote src/runSmalltalk/realRun.integration.test.ts (opt-in, 3 real-VM tests pass; default suite 325 pass, tsc clean from mcp-bridge/server). Confirmed Cuis idioms, deviating from spec: (1) harness handler must be on: UnhandledError, Warning, SyntaxErrorNotification and NOT on: Error, because an outer Error handler aborts the suite before SUnit counts test errors; error text comes from ex exception description for UnhandledError and messageText for SyntaxErrorNotification. (2) Evaluate with instance side Compiler new evaluate: src in: nil to: nil notifying: nil ifFail: [nil]; class-side Compiler evaluate: returns nil on syntax errors and can hang on undeclared variables. Source is read via asFileEntry fileContents. (3) Package install is CodePackageFile installPackage: path asFileEntry; a missing file is silent, so TS must validate existence. (4) Harness must first run Utilities setAuthorName: 'MCP Bridge' initials: 'mcp' or class and method creation hangs on an author prompt. (5) TestResult accessors: runCount passedCount failureCount errorCount, collections passed, failures, errors; test id is the TestCase printString (ClassName then selector). (6) A script that fails to parse as a whole hangs until timeout. (7) Code defining a class and using it in the same evaluated text fails with UndeclaredVariableWarning; use Smalltalk at: instead. Unverified: realistic broken packages, partial output after hang kill.

### Phase 2 cycles

- cycle 2.1 [covered=1]: RunInputError('invalid_code','empty') is an Error with code, message and name RunInputError — red: RunInputError carries code/message/name; green: errors.ts class and code union; refactor: skipped, trivial

## Phase 2 — [TDD] errors.ts

RunInputError with four codes. 1 cycle, 1 test. Refactor skipped. No spec deviations.

### Phase 3 cycles

- cycle 3.1 [covered=1]: validateInput rejects code that is missing, not a string, empty or whitespace-only with RunInputError invalid_code — red: invalid_code for missing/non-string/empty code; green: input.ts with code check and stub return; refactor: deferred
- cycle 3.2 [covered=2]: validateInput converts timeoutSeconds to timeoutMs (default 60000 when absent, 5 gives 5000, 300 gives 300000) and rejects 0, 301, 1.5, negative and non-number values with RunInputError invalid_timeout — red: timeout default, conversion and range; green: constants and integer range check; refactor: deferred
- cycle 3.3 [covered=3]: validateInput resolves packages (relative against the cwd argument, absolute kept) to absolute paths in the given order, accepting existing regular .pck.st files; a missing file rejects with package_not_found naming the path; a directory or a file not ending .pck.st rejects with package_not_pck naming the path — red: relative and absolute packages resolve to absolute paths in order; green: path.resolve map; refactor: deferred
- cycle 3.4 [covered=4]: validateInput rejects a package path that does not exist with package_not_found, and one that is a directory or does not end in .pck.st with package_not_pck, each message naming the offending path; invalid packages input (not an array of strings) rejects with package_not_found naming the problem — red: missing package gives package_not_found naming absolute path; green: stat check in order; refactor: deferred
- cycle 3.5 [covered=5]: validateInput rejects a package that is a directory or whose name does not end in .pck.st with RunInputError package_not_pck naming the absolute path — red: directory or non-pck file gives package_not_pck; green: isFile and suffix check; refactor: deferred
- cycle 3.6 [covered=6]: validateInput rejects a packages value that is not an array of non-empty strings with RunInputError invalid_packages (new code added to the union, deviation from spec) — red: invalid_packages for malformed packages; green: shape check and new code; refactor: helpers validateCode, validateTimeoutMs, validatePackages

## Phase 3 — [TDD] input.ts

validateInput covers invariants 1-6: code, timeout (default 60 s, max 300 s), package resolution against cwd, existence, .pck.st file check. 6 cycles, 7 tests. Deviation: added invalid_packages code to RunInputError for malformed packages input. Phase-end refactor done.

### Phase 4 cycles

- cycle 4.1 [covered=1]: buildHarness({nonce, codePath, packagePaths}) returns a Smalltalk script string whose first line is Transcript logToStdout: true. and which sets the author name via Utilities setAuthorName:initials: — red: harness starts with logToStdout then author setup; green: buildHarness stub; refactor: deferred
- cycle 4.2 [covered=2]: buildHarness emits, per package in order, a guarded install step using CodePackageFile installPackage: with the absolute path as an escaped Smalltalk string literal (single quotes doubled) followed by asFileEntry, each inside an on: UnhandledError, Warning, SyntaxErrorNotification do: handler that records an ERROR marker for the package — red: guarded per-package install with escaped path and nonce ERROR marker; green: install lines and stString helper; refactor: deferred
- cycle 4.3 [covered=3]: buildHarness evaluates the user code file after the packages via the instance-side Compiler new evaluate:in:to:notifying:ifFail: on the contents of codePath asFileEntry fileContents (escaped literal), inside the same UnhandledError, Warning, SyntaxErrorNotification handler, which on failure prints a nonce ERROR code marker, and stores the value in a variable named value — red: guarded evaluation of the code file with instance-side Compiler; green: evaluateCode block storing McpRunValue, shared errorText; refactor: deferred
- cycle 4.4 [covered=4]: buildHarness prints a single-line nonce RESULT marker with the escaped printString of the stored value (backslash doubled, line feed and carriage return as backslash n and backslash r), only when evaluation stored a value (guarded by Smalltalk includesKey: #McpRunValue), inside the same handler family — red: RESULT marker with escaped printString guarded by includesKey; green: printResult helper; refactor: deferred; note: Smalltalk not yet run on real VM
- cycle 4.5 [covered=5]: when the stored value isKindOf: TestResult, buildHarness prints a nonce TESTS marker with run, passed, failures and errors counts (runCount, passedCount, failureCount, errorCount) and one nonce FAILING or ERRORING marker per failing or erroring test with the test printString escaped, all inside the guard handler — red: TESTS, FAILING, ERRORING markers for TestResult; green: printTests and escaped helper; refactor: deferred
- cycle 4.6 [covered=6]: every ERROR marker text produced by the harness handlers (package, code, result, tests) is passed through the same backslash, line feed, carriage return escaping, so a multi-line error description stays on one line — red: ERROR marker texts escaped; green: errorText constant wrapped by escaped; refactor: deferred
- cycle 4.7 [covered=7]: buildHarness initializes Smalltalk at: #McpRunFailed put: false right after the preamble, every guard handler sets it to true, a TestResult with failures or errors sets it to true, and the script ends with a nonce-free DONE exitCode= line (1 if McpRunFailed else 0) followed by Smalltalk quitPrimitive: with the same code — red: McpRunFailed tracking and DONE plus quitPrimitive ending; green: markFailed in handlers, tests block failure flag, final lines; note: green agent used sed through Bash on harness.ts, within scope
- cycle 4.8 [covered=8]: the generated harness, run on the real Cuis VM via runWithSharedCuis (opt-in CUIS_INTEGRATION=1), yields nonce markers and DONE exitCode for: 3 + 4 (RESULT 7, exit 0), a syntax error and a runtime error (ERROR code markers, exit 1, no hang), a multi-line result (single escaped line), a passing and a failing SUnit suite (TESTS counts and FAILING or ERRORING ids), and a package from dist Packages loaded by absolute path — red: real-VM end-to-end harness hung at scenario 1; green: statements terminated with periods and parenthesized includesKey test (two real-VM bugs the string tests could not catch); test fix for scenario 5 user code; unit regressions added; refactor: reportError helper, constants, header doc

## Phase 4 — [TDD] harness.ts

buildHarness: preamble, guarded package installs, instance-side evaluation, escaped RESULT/ERROR/TESTS/FAILING/ERRORING markers, McpRunFailed tracking, DONE exitCode and quitPrimitive. 8 cycles, 9 unit tests plus a real-VM end-to-end test with 5 scenarios, all green. Real VM exposed two defects invisible to string tests (missing statement periods, non-existent includesKey:ifTrue: selector); fixed and pinned by a unit regression. Deviations: handler is UnhandledError, Warning, SyntaxErrorNotification (not on: Error); evaluation block uses Compiler new instance side; author setup line added; values passed via Smalltalk globals McpRunValue and McpRunFailed. Phase-end refactor done.

### Phase 5 cycles

- cycle 5.1 [covered=1]: parseRun(output, nonce) extracts from the full output the RESULT text (unescaped: backslash n to line feed, backslash r to carriage return, double backslash to backslash), ERROR entries with stage and message, and cleans the displayed output by removing every line that contains the nonce marker; marker lines may be preceded by a timestamp prefix — red: parseRun result/errors/marker stripping; green: outcome.ts parseRun with single-pass unescape; refactor: deferred
- cycle 5.2 [covered=2]: parseRun also parses a nonce TESTS marker with run, passed, failures, errors counts and FAILING and ERRORING marker lines (unescaped test ids) into tests {run, passed, failures, errors, failing, erroring}, removes those marker lines from output, and tests is absent when no TESTS marker exists — red: tests summary from TESTS/FAILING/ERRORING markers; green: parseRun tests field; refactor: deferred
- cycle 5.3 [covered=3]: buildOutcome(run, nonce) maps a runner result to status passed (runner passed, no ERROR markers, no failing or erroring tests; carries result and tests when present) or failed (any ERROR marker, failing or erroring tests, or runner failed), with a code-tagged error string: evaluation_error for stage code, package_load_error for a package stage, harness_error for result or tests stages, tests_failed with counts when tests failed — red: buildOutcome passed/failed with typed errors; green: buildOutcome and errorFor; refactor: deferred
- cycle 5.4 [covered=4]: buildOutcome maps runner timeout_or_crash to status timeout with error timeout: and keeps the output so far, and runner setup_error to status setup_error with error setup_error: carrying the runner message, in both cases without a result — red: timeout and setup_error mapping, no trusted result on timeout; green: buildOutcome branches; refactor: deferred
- cycle 5.5 [covered=5]: buildOutcome caps displayed output at 64 KB keeping the first 16 KB and last 48 KB with a visible cut marker and truncated true, reports outputBytes of the full cleaned output, caps result at 4 KB with resultTruncated true, and derives status, tests and error from the full output even when markers fall in the cut region; short output has truncated false — red: output cap 16K+48K, result 4K, truncated/outputBytes/resultTruncated; green: withCaps wrapper on all paths; refactor: ParsedRun/RunOutcome types, header, constants

## Phase 5 — [TDD] outcome.ts

parseRun (RESULT, ERROR, TESTS, FAILING, ERRORING markers, single-pass unescape, marker stripping) and buildOutcome (passed/failed/timeout/setup_error, typed errors evaluation_error/package_load_error/harness_error/tests_failed/timeout/setup_error, output cap 64 KB, result cap 4 KB). 5 cycles, 6 tests. Deviation: status derives from full output before truncation; timeout drops any RESULT marker. Phase-end refactor done.

### Phase 6 cycles

- cycle 6.1 [covered=1]: createRunSmalltalkTool(opts) returns a ToolDefinition named run_smalltalk with an input schema (code required string, packages array of strings, timeoutSeconds integer) and a description telling the assistant to review code for host side effects and tell the user; invalid input returns an isError result whose JSON has status setup_error and a code-tagged error (code colon message) without calling status, prepare or run — red: tool definition, schema, description, invalid input rejected without host calls; green: createRunSmalltalkTool and RunSmalltalkOptions; refactor: deferred
- cycle 6.2 [covered=2]: on a ready home the handler writes the code verbatim to user-code.st and the generated harness to harness.st in a fresh per-call scratch directory under the OS temp dir, calls run with that harness path, the validated timeout in milliseconds and the abort signal, returns the outcome as JSON text with isError false for passed, and removes the scratch directory afterwards — red: ready-home flow with scratch dir and parsed outcome; test fake corrected to take run options as second argument and to allow the kept DONE line; green: handler writes the code and harness files, runs, buildOutcome, scratch directory removed in finally; refactor: deferred
- cycle 6.3 [covered=3]: when the home status is missing the handler calls prepare exactly once, does not call run, and returns an isError setup_error whose error starts with cuis_missing; when preparing it returns cuis_initializing without calling prepare or run; when failed it returns the recorded error code and message from the status and starts a fresh preparation by calling prepare once — red: missing starts preparation, preparing refuses, failed reports recorded code and retries; green: status branches and shared setupError helper; refactor: deferred
- cycle 6.4 [covered=4]: when run throws a HeadlessError (for example cuis_corrupt naming the directory to delete) the handler returns an isError setup_error with the code-tagged error text and still removes the scratch directory; an unexpected non-Headless error from run propagates as a thrown error after the scratch directory is removed — red: HeadlessError from run becomes setup_error, other errors rethrown, scratch always removed; green: try/catch around run; refactor: deferred
- cycle 6.5 [covered=5]: on a non-macOS platform the handler returns an isError setup_error unsupported_platform after input validation and before calling status, prepare or run; the code and packages given are still validated first so invalid input reports its own code — red: non-macOS refused after input validation and before host calls; green: platform guard; refactor: deferred
- cycle 6.6 [covered=6]: end to end on the real VM (opt-in CUIS_INTEGRATION=1) the run_smalltalk handler returns passed with result 7 for 3 + 4, failed with a tests summary for a failing SUnit suite, timeout bounded by timeoutSeconds for an endless loop, two simultaneous calls independent, and leaves no cuis-mcp-run or cuis-run scratch directories and an unchanged base image — red: real-VM tool scenarios (pass, fail, timeout, concurrency, cleanliness, package) all green on arrival; green: none; refactor: handler split into validateOrSetupError, checkSharedCuis, writeScratchFiles, runHarness; note: tsc error in realRun test (handler called with two args) until ToolDefinition gains the optional second parameter in phase 8

## Phase 6 — [TDD] tool.ts

createRunSmalltalkTool: schema and description, input validation first, platform guard, first-use handling (missing starts preparation, preparing refuses, failed reports recorded code and retries), scratch dir with harness and code files, HeadlessError mapping, outcome JSON with isError only for setup_error. 6 cycles, 6 unit tests plus a real-VM tool test with 6 scenarios (green on arrival). Test fixes: fake run takes options as second argument; DONE line is kept in output. Deviation: failed state also starts a fresh attempt in the same call. Phase-end refactor done.

### Phase 7 cycles

- cycle 7.1 [covered=1]: combineSignals(a, b) returns an AbortSignal that is already aborted if either input is aborted, and aborts with the reason of the first input to abort; with undefined inputs it ignores them; a never-aborted pair stays unaborted — red: combineSignals semantics; green: AbortSignal.any wrapper; refactor: deferred
- cycle 7.2 [covered=2]: createShutdownSignal(proc, stdin) returns an AbortSignal that is not aborted initially and aborts when proc emits SIGTERM, SIGINT or SIGHUP or when stdin emits end, using injectable emitters so no real signals are involved — red: shutdown signal aborts on SIGTERM, SIGINT, SIGHUP or stdin end; green: createShutdownSignal; refactor: skipped, tiny module

## Phase 7 — [TDD] shutdownSignal.ts

combineSignals and createShutdownSignal in src/shutdownSignal.ts. 2 cycles, 2 tests. Refactor skipped. No spec deviations.

## Phase 8 — [Scaffold] tools.ts and index.ts wiring

ToolDefinition.handler takes optional second argument with signal; createTools appends run_smalltalk with injectable options; index.ts creates the shutdown signal and passes combineSignals of the request signal and the shutdown signal; tools.test.ts tool list updated. tsc clean, npm test 352 passed with 6 skipped, build ok.

## Phase 9 — [Scaffold] docs

PROTOCOL.md sentence scoped to the live-image wire channel (no version change); mcp-bridge README run_smalltalk section, tool count, shared home and troubleshooting notes; root README mention; test skill pointer.

Built the run_smalltalk host-side MCP tool in mcp-bridge/server: input validation, a generated Smalltalk harness with nonce-tagged single-line markers, outcome parsing with a status table and output caps, first-use handling on top of the shared Cuis home, cancellation plumbing (request signal combined with a process shutdown signal), wiring and docs. 9 phases, 31 TDD cycles. The real VM drove four design changes versus the spec: the guard catches UnhandledError, Warning and SyntaxErrorNotification (an outer Error handler aborts SUnit suites before errors are counted); evaluation uses the instance-side Compiler; the harness sets an author name; statements must end with periods and avoid non-existent selectors (found only by the real-VM test). Other deviations: invalid_packages code added; a failed Cuis state also starts a fresh attempt in the same call; the DONE line stays in output. Unverified: realistic broken packages and partial output after a hang kill. Opt-in real-VM tests (CUIS_INTEGRATION=1) cover the harness and the tool end to end.

## Implementation files

- mcp-bridge/server/src/runSmalltalk/realRun.integration.test.ts
- mcp-bridge/server/src/runSmalltalk/errors.ts
- mcp-bridge/server/src/runSmalltalk/errors.test.ts
- mcp-bridge/server/src/runSmalltalk/input.ts
- mcp-bridge/server/src/runSmalltalk/input.test.ts
- mcp-bridge/server/src/runSmalltalk/harness.ts
- mcp-bridge/server/src/runSmalltalk/harness.test.ts
- mcp-bridge/server/src/runSmalltalk/outcome.ts
- mcp-bridge/server/src/runSmalltalk/outcome.test.ts
- mcp-bridge/server/src/runSmalltalk/tool.ts
- mcp-bridge/server/src/runSmalltalk/tool.test.ts
- mcp-bridge/server/src/shutdownSignal.ts
- mcp-bridge/server/src/shutdownSignal.test.ts
- mcp-bridge/server/src/tools.ts
- mcp-bridge/server/src/tools.test.ts
- mcp-bridge/server/src/index.ts
- mcp-bridge/PROTOCOL.md
- mcp-bridge/README.md
- README.md
- .claude/skills/test-cuis-mcp-bridge/SKILL.md

## Retrospective

All nine phases were completed: scaffolding of the opt-in real-VM test, then TDD for `errors`, `input`, `harness`, `outcome`, `tool` and `shutdownSignal`, the wiring in `tools.ts` and `index.ts`, and the docs. Static verification found 32 of 33 invariants covered, and dynamic verification against the real headless Cuis passed 32 and skipped #33 (the repo's own setup scripts, which are only checked by `git diff` showing nothing changed under `tools/`).

Deviations from the spec:
- The harness guard had to be `on: UnhandledError, Halt, Warning, SyntaxErrorNotification`, not a statement-level `on: Error`, because the latter aborts SUnit suites before errors are counted.
- Dynamic verification found three real defects, fixed test-first: an unreadable package (#4), `Halt` and non-string error messages hanging until the timeout (#14), and no exit on SIGTERM, which was a regression from this branch.
- Invariant 22 was strengthened after manual testing. The tool description now tells the assistant to stop and ask for an explicit yes before running code with host side effects. It is wording only, with no enforcement in the tool.

Lessons:
- A real-VM test early in the work caught several Cuis API assumptions (missing periods, `includesKey:` forms, `Compiler` usage) that unit tests with a fake VM could not.
- The fake VM hid defects in both this initiative and its predecessor.
- Open gaps: realistic broken packages, partial output after a hang kill, a network-off offline run, and invariants #3, #17, #25, #30 and #31 each have a small static gap.
- Manual edge cases (whole-script syntax error, forged markers, escaping and Unicode, forked process) all behaved correctly.
