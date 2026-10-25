# Dynamic verify report — run-smalltalk-headless
Date: 2026-10-24

Recipe: `.claude/skills/run-smalltalk-tool` (driver.mjs against the built server, real headless Cuis, throwaway home). No test suite was run.

Invariant 1 — The caller provides the Smalltalk code to run (required...) and may provide packages and timeout
  Dynamic: pass

Invariant 2 — The code is evaluated as a script; the last expression's value is the result
  Dynamic: pass — `3+4` gave result "7"

Invariant 3 — Package paths: existing regular `.pck.st`, relative to session cwd, loaded in order, no implicit dependencies
  Dynamic: pass — Network-Kernel then JSON loaded in order; relative paths resolved against DRIVER_CWD; with no packages `Json` is absent

Invariant 4 — Invalid package rejected before any Cuis starts, `setup_error` naming the path
  Dynamic: pass — package_not_found, package_not_pck (directory and README.md) and package_unreadable (chmod 000) all name the path, on an empty home nothing was downloaded (state stayed missing)

Invariant 5 — Empty or missing code rejected with `setup_error`
  Dynamic: pass — `{}`, whitespace and a number gave invalid_code

Invariant 6 — Timeout optional, default and maximum, out-of-range rejected
  Dynamic: pass — 0, 999, 1.5 and "5" gave invalid_timeout (1..300), not clamped; 3 s accepted

Invariant 7 — Exactly one outcome with status passed/failed/timeout/setup_error
  Dynamic: pass — all four statuses observed, one JSON outcome per call

Invariant 8 — Outcome carries status, exit code, output, result, code-tagged error
  Dynamic: pass — fields present; errors read `<code>: <message>`

Invariant 9 — `passed` when the code ran to completion without error or test failures
  Dynamic: pass — passing SUnit suite gave passed with tests 1/1

Invariant 10 — `failed` on unhandled error or failing/erroring tests, with output and error
  Dynamic: pass — failing suite gave failed/tests_failed, `self error:` gave evaluation_error, 1/0 gave ZeroDivide

Invariant 11 — `tests` summary only when the result is a test result
  Dynamic: pass — tests {run 2, passed 1, failures 1, failing ["DrvTest>>#testBad"]}; absent for `3+4`

Invariant 12 — `timeout` for no completion in time; never blocks beyond timeout plus grace
  Dynamic: pass — infinite loop ended at 3.0 s as timeout; `Smalltalk quit` reported timeout with the output so far

Invariant 13 — `setup_error` means no caller code was executed
  Dynamic: pass — invalid input, cuis_missing, unsupported_platform and cuis_corrupt returned in milliseconds with no VM run

Invariant 14 — Errors in code or packages never hang until the timeout
  Dynamic: pass — 1/0, an unknown-variable script, ensure: with error and a garbage .pck.st (package_load_error) all failed in about 0.2-0.3 s

Invariant 15 — Output capped at 64 KB (16 KB head + 48 KB tail), result 4 KB, truncation reported, status from full output
  Dynamic: pass — 9.9 MB flood gave outputBytes 9889954, output about 64 KB with the cut at 16 KB, result capped at 4096 with resultTruncated; flood plus failing test still failed with tests

Invariant 16 — Transcript output always shown without the caller enabling it
  Dynamic: pass — `a` then `b` appeared in order

Invariant 17 — Each run in a fresh transient instance; nothing visible to later runs, live image or project image
  Dynamic: pass — a global and a class from one run were absent in the next; an image save left base hashes unchanged

Invariant 18 — Concurrent calls independent
  Dynamic: pass — 3 parallel runs gave 3 distinct values in 2.4 s total

Invariant 19 — No scratch files remain and the shared Cuis is unchanged after a run
  Dynamic: pass — base hashes identical and no cuis-run-*/cuis-mcp-run-* dirs after passed, failed, timeout, cancelled and parallel runs

Invariant 20 — Never connects to or modifies the live image; works with or without one
  Dynamic: pass — runs worked with no live image and no connection to 6789/6790 was seen; the with-live-image half was not run (no live image was up)

Invariant 21 — Packages are loaded from where they are, never modified or copied back
  Dynamic: pass — package hash and directory listing identical after a run

Invariant 22 — Code not sandboxed; description warns to review for host side effects; relative writes land in dist/
  Dynamic: pass — a relative file write landed in the shared Cuis dist/ directory, not in the cwd (description text read from tool.ts, not from the live tools list)

Invariant 23 — Not installed: starts preparation in the background, `setup_error`, executes nothing
  Dynamic: pass — cuis_missing returned in about 5 ms and state became preparing/ready

Invariant 24 — Preparing: `setup_error` initializing, no second preparation
  Dynamic: pass — two calls during a slow preparation gave cuis_initializing; one preparation only

Invariant 25 — Ready: runs normally, needs no network
  Dynamic: pass — runs on a ready home worked with no network connections seen; network was not switched off

Invariant 26 — Failed preparation reported with its specific kind; fresh attempt follows
  Dynamic: pass — cuis_checksum_mismatch reported with "a new preparation attempt has started"; the next call ran

Invariant 27 — Damaged shared Cuis reported as `cuis_corrupt` naming the directory
  Dynamic: pass — deleted base/ gave cuis_corrupt naming the directory and the missing image

Invariant 28 — Non-macOS platform returns an unsupported-platform `setup_error`, starts nothing
  Dynamic: pass — CUIS_PLATFORM=linux gave unsupported_platform, home stayed empty

Invariant 29 — Starting the server does no network access or Cuis work
  Dynamic: pass — stdio server started on an empty home: no network connections, home unchanged, run_smalltalk listed

Invariant 30 — Cancellation or shutdown kills the instance and removes scratch files
  Dynamic: pass — abort at 5 s returned at 5.0 s, no run dirs or Squeak left; SIGTERM of the stdio server mid-run exited 0 with no leftover run dirs or Squeak process

Invariant 31 — Behaves identically from any session working directory
  Dynamic: pass — in-process and stdio calls from an empty temp directory gave the same result

Invariant 32 — Existing tools, read-only guarantee and protocol version unchanged; docs scope the guarantee to the wire channel
  Dynamic: pass — 15 previous tools plus run_smalltalk listed; PROTOCOL.md and READMEs scope the guarantee to the wire channel; no diff against main under mcp-bridge/image or tools

Invariant 33 — The repository's own setup scripts, runner and test skill behave as before
  Dynamic: skip — no runtime surface to exercise (the only check is running the headless test runner, which is a test suite; `git diff main -- tools` is empty)

33 invariants — 32 passed, 0 failed, 1 skipped
