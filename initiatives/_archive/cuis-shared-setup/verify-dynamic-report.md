# Dynamic verify report — cuis-shared-setup
Date: 2026-10-24

Recipe: .claude/skills/run-cuis-shared-setup (driver.mjs against throwaway homes under the session scratchpad; failure paths via CUIS_ARCHIVE_URL, CUIS_ARCHIVE_SHA256, CUIS_PLATFORM and `runhl`, served by a local python http.server on 127.0.0.1:8765; invariant 27 beside a disposable run-cuis-mcp-bridge instance on port 6790). No test suite was run. The real pinned archive was downloaded from GitHub and the real VM booted. ~/.cuis-mcp-bridge, Cuis7-8-main/ and .headless-base were untouched.

Invariant 1 — Shared Cuis lives under the per-user data area, keyed by release and short commit
  Dynamic: pass — layout directory `cuis/7.8-d4f9cc1` under the home; the real ~/.cuis-mcp-bridge was never written (a throwaway home was used on purpose, so the default location itself was not exercised dynamically)

Invariant 2 — Distribution and frozen base sit together in one Cuis home
  Dynamic: pass — `dist/` and `base/` side by side in `7.8-d4f9cc1`; deleting that directory removed everything about the version

Invariant 3 — A different pinned version resolves to a different, untouched home
  Dynamic: pass — a planted sibling `9.9-aaaaaaa` stayed byte-identical across prepare and status

Invariant 4 — Never reads or writes the checkout-local Cuis7-8-main/ or .headless-base
  Dynamic: pass — their mtimes were unchanged after the whole run and `git status tools` shows no change

Invariant 5 — Exactly four observable states
  Dynamic: pass — missing, preparing, ready and failed (checksum, network, broken VM) all observed

Invariant 6 — Status never starts work, touches the network or blocks
  Dynamic: pass — status on an empty home returned `missing` at once and created nothing

Invariant 7 — Prepare returns immediately with preparing; no-op when ready
  Dynamic: pass — prepare printed `started` while status read `preparing`; prepare on a ready home printed `ready`

Invariant 8 — Ready only when complete and verified, including after a crash
  Dynamic: pass — status never read `ready` while the lock and tmp directory existed, including after kill -9 mid-prepare

Invariant 9 — Concurrent prepare produces one attempt
  Dynamic: pass — two concurrent prepares gave `started` and `in_progress`, one tmp directory, one ready layout, no leftovers

Invariant 10 — Failure reported once per attempt; retry starts fresh
  Dynamic: pass — after a checksum failure, repeated status calls kept reporting it; a new prepare with the right checksum started a fresh attempt and the home became ready with no error file left

Invariant 11 — Runner refuses a non-ready home, never fetches
  Dynamic: pass — `run` on a missing home gave cuis_missing; during preparation, cuis_initializing; nothing was fetched or created

Invariant 12 — Downloads exactly the pinned commit
  Dynamic: pass — prepare with the default URL downloaded the pinned archive from GitHub and it matched the shipped SHA-256

Invariant 13 — Checksum checked before extraction; mismatch reports expected and actual
  Dynamic: pass — a wrong CUIS_ARCHIVE_SHA256 gave `cuis_checksum_mismatch` with both values; only the .error file was left

Invariant 14 — Network failure gives a distinct kind; no partial files
  Dynamic: pass — connection refused and a 404 each gave `cuis_fetch_failed` naming the URL and cause; only the .error file was left (mid-stream interruption not exercised dynamically)

Invariant 15 — Unwritable per-user area gives a write-failure kind naming the cause
  Dynamic: pass — a read-only home gave `cuis_write_failed` (EACCES, mkdir), status stayed `missing`, nothing left behind

Invariant 16 — Killed preparation is detected as dead and cleaned up
  Dynamic: pass — after kill -9, status reported `missing` and a fresh prepare succeeded; the dead attempt's lock and tmp directory stayed on disk until that prepare swept them (status is read-only by invariant 6)

Invariant 17 — Ready home needs no network
  Dynamic: skip — no runtime surface to exercise (the network cannot be cut without a network sandbox; runs were never observed fetching)

Invariant 18 — Frozen base built once, headlessly, as the last preparation step; never modified by a run
  Dynamic: pass — base checksum identical before and after every run, including with a live instance up

Invariant 19 — Base-build failure makes the home failed with the VM output
  Dynamic: pass — an archive whose VM exits silently gave `cuis_base_build_failed`; the home was not ready and only the .error file was left. The message is empty because the VM printed nothing.

Invariant 20 — Damaged ready home is refused with a corruption error
  Dynamic: pass — with the VM moved away, status said `ready` and `run` returned cuis_corrupt naming the missing path and telling the user to delete and prepare again

Invariant 21 — Runner takes any directory pair of the right shape
  Dynamic: pass — `runhl` ran a script on a copied dist/base pair that is not a shared home (passed); a missing VM directory and a missing base each gave setup_error

Invariant 22 — Each run uses a fresh scratch copy; base byte-identical afterwards
  Dynamic: pass — base and dist trees both byte-identical after passed, failed, crash, timeout and concurrent runs; no UserChanges left in dist; no cuis-run-* scratch directories

Invariant 23 — Scratch copy removed on every outcome
  Dynamic: pass — no cuis-run-* directories after passed, failed, crash, timeout and setup-error runs

Invariant 24 — Outcomes map to exit codes 0 / 1 / 124 / 2
  Dynamic: pass — passed (0), failed (1), a VM exit without the marker (124), a missing script (2)

Invariant 25 — Full VM output returned in order
  Dynamic: pass — output returned in order with timestamp-prefixed lines and the DONE marker last (the more-than-1 MB case was not exercised)

Invariant 26 — Timeout terminates the VM and descendants; fast runs not delayed
  Dynamic: pass — a hanging script with a 5 s limit returned timeout_or_crash after 5 s and no VM processes remained

Invariant 27 — Never touches the live Cuis image or a running instance
  Dynamic: pass — with a disposable live bridge instance up (port 6790, same pid and start time throughout), two scripts ran through the shared home; the live image and sources checksums and the changes-file size were identical before and after and it still answered the same query. Port 6789 was never touched.

Invariant 28 — Concurrent runs and runs during a preparation do not interfere
  Dynamic: pass — three simultaneous runs all passed with unchanged trees; a run against a home being prepared was refused with cuis_initializing. Cleanup of dist/UserChanges is differential: a run that finishes first could in theory delete the change log of a still-running overlapping run (not observed).

Invariant 29 — Result independent of the caller's working directory
  Dynamic: pass — relative script paths (`sc/rel.st` and `../sc/rel.st`) passed from different directories, and started from /tmp the VM's current directory was the distribution `dist/`

Invariant 30 — Non-macOS fails immediately with unsupported_platform
  Dynamic: pass — with CUIS_PLATFORM=linux, `prepare` and `run` both failed immediately with unsupported_platform and created nothing

Invariant 31 — Nothing runs at startup; no home created unless used
  Dynamic: pass — the real ~/.cuis-mcp-bridge contained only vm-mirror before and after the whole round. Server startup itself was not exercised.

Invariant 32 — Deleting a home returns that version to missing with no leftovers
  Dynamic: pass — after removing the layout directory status read `missing`; only the empty parent `cuis/` directory remained

32 invariants — 31 passed, 0 failed, 1 skipped (17)
