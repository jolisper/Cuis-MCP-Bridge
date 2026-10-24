# Static verify report — cuis-shared-setup
Date: 2026-10-24

Test files (all under mcp-bridge/server/src/cuisHome/): cuisHome.test.ts (CH), run.test.ts (RUN), runner.test.ts (RNR), processLock.test.ts (PL), realCuis.integration.test.ts (INT, opt-in via CUIS_INTEGRATION=1; passes against the real VM).

Invariant 1 — Shared Cuis lives under the per-user data area, keyed by release + short commit
  Static: covered — CH:115 (default is <homedir>/.cuis-mcp-bridge/cuis/<key>, follows HOME, independent of cwd, creates nothing), INT:61 (real layout dir is named CUIS_LAYOUT_KEY)

Invariant 2 — Distribution and frozen base sit together in one Cuis home
  Static: covered — CH:181 (dist/ + base/ in one layout dir), CH:827 (deleting one home removes only that version)

Invariant 3 — A different pinned version resolves to a different, untouched home
  Static: covered — CH:827

Invariant 4 — Never reads or writes the checkout-local Cuis7-8-main/ or .headless-base; repo scripts unchanged
  Static: partial — CH:987 (no hard-coded distribution paths). No test asserts the repo scripts are unchanged (they were not modified; verifiable from git).

Invariant 5 — Exactly four observable states
  Static: covered — CH:29 (missing), CH:41 (ready), CH:54 (preparing/stale), CH:82 (failed)

Invariant 6 — Status never starts work, touches the network or blocks
  Static: covered — CH:29 (creates nothing), CH:900 (no network in any state)

Invariant 7 — Prepare returns immediately with preparing; no-op when ready
  Static: covered — CH:181 ('started'), CH:939 (ready: no fetch, resolves 'ready')

Invariant 8 — Ready only when complete and verified; never half-built, including after a crash
  Static: covered — CH:718 (settled when status leaves preparing), CH:779 (crash recovery), CH:181 (no sibling artifacts), CH:591 (published dist is pristine)

Invariant 9 — Concurrent prepare produces one attempt
  Static: covered — CH:625

Invariant 10 — Failure reported once per attempt; retry starts fresh
  Static: covered — CH:670 (retry, old error cleared), CH:82 (failed status does not consume error)

Invariant 11 — Runner refuses a non-ready home, never fetches
  Static: covered — RUN:53 (cuis_missing / cuis_initializing, archive server unused)

Invariant 12 — Downloads exactly the pinned commit, never a moving branch
  Static: covered — INT:43 (opt-in: downloads the real pinned archive and verifies its SHA-256 through pin.ts). The default suite injects its own URL and checksum, so the pin values are asserted only when CUIS_INTEGRATION=1 is set.

Invariant 13 — Archive checked against the shipped checksum before extraction; mismatch reports expected and actual
  Static: covered — CH:228

Invariant 14 — Network failure gives a distinct kind; no partial files
  Static: covered — CH:275 (not-found, connection-refused, reset-midstream), CH:324 (30 mid-stream resets), CH:379

Invariant 15 — Unwritable per-user area gives a write-failure kind naming the cause
  Static: covered — CH:445 (unwritable-home, unzip-cannot-run; the unwritable case passes silently when run as root)

Invariant 16 — Killed preparation is detected as dead and cleaned up
  Static: covered — CH:779, CH:54 (stale lock reports missing), PL:65 (dead pid / pid reuse / corrupt content), PL:94

Invariant 17 — Ready home needs no network
  Static: covered — CH:939, CH:900, RUN:111 (run with the archive server closed)

Invariant 18 — Frozen base built once, headlessly, as the last preparation step; never modified by a run
  Static: covered — CH:181, CH:510 (smoke boot gate), CH:558 (smoke script as the real VM requires), RUN:111, INT:68 (real base unchanged after runs)

Invariant 19 — Base-build failure makes the home failed with the VM output
  Static: covered — CH:510

Invariant 20 — Damaged ready home is refused with a corruption error
  Static: covered — RUN:253 (VM, image, sources, changes each missing → cuis_corrupt, no rebuild)

Invariant 21 — Runner takes any directory pair of the right shape
  Static: covered — RNR:83 and the other RNR tests (temporary dirs, no shared home)

Invariant 22 — Each run uses a fresh scratch copy; base byte-identical afterwards
  Static: covered — RNR:319, RNR:397 (concurrent isolation), RUN:111, INT:108; RUN:159 and RUN:203 (the run leaves dist/ pristine: UserChanges entries created by a run are removed)

Invariant 23 — Scratch copy removed on every outcome
  Static: covered — RNR:357 (passed, failed, crash, timeout, setup_error), RNR:231 (abort)

Invariant 24 — Outcomes map to exit codes 0 / 1 / 124 / 2
  Static: covered — RNR:83 (0), RNR:104 (1), RNR:125 (0/1 with a Transcript timestamp prefix on the marker), RNR:153 (124), RNR:20, RNR:42, RNR:60 (2)

Invariant 25 — Full VM stdout and stderr returned in order
  Static: covered — RNR:436 (more than 1 MB, interleaved, DONE marker last)

Invariant 26 — Timeout terminates the VM and descendants; fast runs are not delayed
  Static: covered — RNR:173 (grandchild killed), RNR:231 (abort kills the process group). "Not delayed" is only implied by RNR:83.

Invariant 27 — Never touches the live Cuis image or a running instance
  Static: no coverage found — no test runs with a live Cuis instance or asserts the live image is untouched. Structural only: runs use a scratch copy. Verified dynamically (see verify-dynamic-report.md).

Invariant 28 — Concurrent runs, and runs during a preparation, do not interfere
  Static: partial — RNR:397 (two concurrent runs). No test runs while a preparation of the same home is in progress. RUN:53 only covers the refusal while preparing.

Invariant 29 — Result independent of the caller's working directory
  Static: covered — RNR:500 (a relative scriptPath is resolved against the caller's cwd, whatever cwd the VM runs in), RNR:469 (VM cwd defaults to cuisDir, overridable), CH:115 (location unchanged after process.chdir), INT:95 (real VM sees dist/ as its current directory)

Invariant 30 — Non-macOS fails immediately with unsupported_platform before any download or process
  Static: covered — CH:157 (prepare), RUN:35 (run)

Invariant 31 — Nothing runs at startup; no home created unless used
  Static: covered — CH:987 (not wired into server startup), CH:29 (status creates nothing)

Invariant 32 — Deleting a home returns that version to missing with no leftovers
  Static: covered — CH:827

32 invariants — 29 covered, 2 partial (4, 28), 1 uncovered (27)

Note: invariant 12 is covered only by the opt-in integration test (CUIS_INTEGRATION=1), which passes against the real VM; the default `npm test` does not exercise the pin values.
