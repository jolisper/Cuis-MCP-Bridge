# Static verify report — run-smalltalk-headless
Date: 2026-10-24

Paths are under `mcp-bridge/server/src/`. `runSmalltalk/realRun.integration.test.ts` runs only with `CUIS_INTEGRATION=1`.

Invariant 1 — The caller provides the Smalltalk code to run (required...) and may provide packages and timeout
  Static: covered — runSmalltalk/tool.test.ts:11 (schema), runSmalltalk/input.test.ts:9

Invariant 2 — The code is evaluated as a script; the last expression's value is the result
  Static: covered — runSmalltalk/harness.test.ts:48, :80; runSmalltalk/realRun.integration.test.ts:179 (real VM)

Invariant 3 — Package paths: existing regular `.pck.st`, relative to session cwd, loaded in order, no implicit dependencies
  Static: covered — runSmalltalk/input.test.ts:58, :114 (no test that dependencies are never loaded implicitly)

Invariant 4 — Invalid package rejected before any Cuis starts, `setup_error` naming the path
  Static: covered — runSmalltalk/input.test.ts:80 (missing), :114 (directory / wrong extension), :137 (unreadable); runSmalltalk/tool.test.ts:11 (host never touched on invalid input)

Invariant 5 — Empty or missing code rejected with `setup_error`
  Static: covered — runSmalltalk/input.test.ts:9; runSmalltalk/tool.test.ts:11

Invariant 6 — Timeout optional, default and maximum, out-of-range rejected
  Static: covered — runSmalltalk/input.test.ts:29

Invariant 7 — Exactly one outcome with status passed/failed/timeout/setup_error
  Static: covered — runSmalltalk/outcome.test.ts:56, :113

Invariant 8 — Outcome carries status, exit code, output, result, code-tagged error
  Static: covered — runSmalltalk/outcome.test.ts:56, :113, :138

Invariant 9 — `passed` when the code ran to completion without error or test failures
  Static: covered — runSmalltalk/outcome.test.ts:56; runSmalltalk/realRun.integration.test.ts:283

Invariant 10 — `failed` on unhandled error or failing/erroring tests, with output and error
  Static: covered — runSmalltalk/outcome.test.ts:56; runSmalltalk/realRun.integration.test.ts:179, :283

Invariant 11 — `tests` summary only when the result is a test result
  Static: covered — runSmalltalk/outcome.test.ts:27, :56

Invariant 12 — `timeout` for no completion in time; never blocks beyond timeout plus grace
  Static: covered — runSmalltalk/outcome.test.ts:113; cuisHome/runner.test.ts:173; runSmalltalk/realRun.integration.test.ts:283

Invariant 13 — `setup_error` means no caller code was executed
  Static: covered — runSmalltalk/tool.test.ts:147, :193; runSmalltalk/outcome.test.ts:113

Invariant 14 — Errors in code or packages never hang until the timeout
  Static: covered — runSmalltalk/harness.test.ts:19 (guard set), :48, :162 (period-terminated statements), :187 (Halt and non-string description); runSmalltalk/realRun.integration.test.ts:179, :247 (real VM, Halt and non-string description fail promptly)

Invariant 15 — Output capped at 64 KB (16 KB head + 48 KB tail), result 4 KB, truncation reported, status from full output
  Static: covered — runSmalltalk/outcome.test.ts:138

Invariant 16 — Transcript output always shown without the caller enabling it
  Static: covered — runSmalltalk/harness.test.ts:7; runSmalltalk/realRun.integration.test.ts:179

Invariant 17 — Each run in a fresh transient instance; nothing visible to later runs, live image or project image
  Static: covered — cuisHome/runner.test.ts:319 (scratch copy leaves base identical); no run-level test that a class defined by one run is absent in the next

Invariant 18 — Concurrent calls independent
  Static: covered — runSmalltalk/realRun.integration.test.ts:283 (concurrency scenario); cuisHome/runner.test.ts:397 (concurrent isolation)

Invariant 19 — No scratch files remain and the shared Cuis is unchanged after a run
  Static: covered — runSmalltalk/tool.test.ts:54, :110; cuisHome/runner.test.ts:357; runSmalltalk/realRun.integration.test.ts:283

Invariant 20 — Never connects to or modifies the live image; works with or without one
  Static: covered — tools.test.ts:336 (run_smalltalk passes with a Cuis client whose connect and sendRequest throw; neither client is ever called)

Invariant 21 — Packages are loaded from where they are, never modified or copied back
  Static: covered — runSmalltalk/tool.test.ts:222 (package hash, mtime and parent listing unchanged, harness references the original path); runSmalltalk/realRun.integration.test.ts:283 (real VM package scenario)

Invariant 22 — Code not sandboxed; description warns to review for host side effects; relative writes land in dist/
  Static: covered — runSmalltalk/tool.test.ts:11 (description warning); write location only documented, not tested

Invariant 23 — Not installed: starts preparation in the background, `setup_error`, executes nothing
  Static: covered — runSmalltalk/tool.test.ts:147

Invariant 24 — Preparing: `setup_error` initializing, no second preparation
  Static: covered — runSmalltalk/tool.test.ts:147

Invariant 25 — Ready: runs normally, needs no network
  Static: covered — runSmalltalk/tool.test.ts:54 (offline not asserted at tool level)

Invariant 26 — Failed preparation reported with its specific kind; fresh attempt follows
  Static: covered — runSmalltalk/tool.test.ts:147 (one error kind exercised)

Invariant 27 — Damaged shared Cuis reported as `cuis_corrupt` naming the directory
  Static: covered — runSmalltalk/tool.test.ts:110

Invariant 28 — Non-macOS platform returns an unsupported-platform `setup_error`, starts nothing
  Static: covered — runSmalltalk/tool.test.ts:193

Invariant 29 — Starting the server does no network access or Cuis work
  Static: covered — tools.test.ts:370 (creating the tools and importing the modules triggers no fetch, status, prepare, run or client call, and creates nothing under the home)

Invariant 30 — Cancellation or shutdown kills the instance and removes scratch files
  Static: covered — shutdownSignal.test.ts:6 (abort on SIGTERM/SIGINT/SIGHUP/stdin end), :35 (graceful exit after SIGTERM, none on stdin end), :79 (combineSignals); runSmalltalk/tool.test.ts:54 (signal passed to run); cuisHome/runner.test.ts:231 (abort kills group, cleans scratch); no tool-level abort test

Invariant 31 — Behaves identically from any session working directory
  Static: covered — runSmalltalk/input.test.ts:58 (paths resolved against the supplied cwd); no real-VM run from a foreign cwd

Invariant 32 — Existing tools, read-only guarantee and protocol version unchanged; docs scope the guarantee to the wire channel
  Static: covered — tools.test.ts:228 (existing tool list intact, run_smalltalk appended); docs wording not tested

Invariant 33 — The repository's own setup scripts, runner and test skill behave as before
  Static: no coverage found — nothing under `tools/` changed (checked by `git status`, not by a test)

33 invariants — 32 covered, 1 uncovered
