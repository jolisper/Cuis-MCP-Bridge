# cuis-shared-setup — functional spec

## Summary

The bridge server gains a shared, per-user Cuis installation (pinned distribution plus frozen
base image) that it fetches on demand, and a parameterized headless runner that executes a
Smalltalk script against a throwaway copy of that base. The consumer is server-side code (the
upcoming `run-smalltalk-headless` tool) and, indirectly, any bridge user whose session is started
in any directory. No new MCP tool is introduced here; "observable" below means observable through
the capability's interface, its on-disk results and its error kinds.

Terms: the **Cuis home** is the per-user directory for one pinned Cuis version; it holds the
**distribution** (Cuis image, changes, sources and the VM that ships with it) and the **frozen
base** (a pristine, ready-to-copy image built from the distribution). The **runner** is the
parameterized headless executor.

## Behavior

### Location and layout

1. The shared Cuis lives under the bridge's existing per-user data area (the one that holds the VM
   source mirror), in a directory keyed by Cuis release and short pinned commit (for example
   `7.8-d4f9cc1`). Where it lives never depends on the working directory of the session or on
   where the bridge is installed.
2. The distribution and the frozen base of one version sit together inside that version's Cuis
   home, so removing the directory removes everything about that version and nothing else.
3. A different pinned version resolves to a different Cuis home. Homes of other versions are never
   read, modified or deleted by the capability; after the bridge is upgraded to a new pin, the
   old home stays in place and the new one is reported as not installed.
4. The capability never reads or writes this repository's checkout-local `Cuis7-8-main/` or
   `.headless-base`, and the repository's setup scripts, headless test runners and test skill
   behave exactly as before. If both locations exist they are independent copies.

### Preparation states

5. A Cuis home is always observable in exactly one of four states: **missing** (nothing
   installed), **preparing** (fetch or base build in progress), **ready** (distribution verified
   and frozen base built), or **failed** (the last preparation attempt ended in an error).
6. Asking for the status of a Cuis home never starts work, never touches the network and never
   blocks; it reports the current state (and, for failed, the recorded error).
7. Asking to prepare a missing or failed home starts preparation and returns immediately with
   the **preparing** state; it does not wait for the download or the base build. Preparing a
   home that is already ready is a no-op that reports ready.
8. Ready is only ever observable when the distribution is complete and verified and the frozen
   base exists. No caller can observe a half-extracted distribution or a half-built base as
   ready, including after a crash.
9. Asking to prepare a home that is already being prepared (by the same server or by another
   bridge session on the same machine) does not start a second attempt: it reports preparing.
   Two sessions racing to prepare produce one fetch and one base build.
10. A failed attempt is reported with its error kind, and the failed state is surfaced once per
    attempt: the next request to prepare starts a fresh attempt rather than repeating the old
    error forever. Failure leaves no state that blocks a retry.
11. Using the runner against a home that is not ready is refused with an error that says the home
    is missing or preparing (and what to do), and never triggers a fetch implicitly.

### Fetch and verification

12. Preparation downloads exactly the pinned upstream revision of the Cuis release, identified by
    a specific commit — never "whatever is current" on a branch. Two users on the same bridge
    build get the same bits.
13. The downloaded archive is checked against the checksum that ships with the bridge before
    anything is extracted into the Cuis home. On mismatch the download is rejected, nothing from
    it is installed, and the error says the checksum did not match (expected and actual
    values included).
14. When the network or the upstream host is unreachable, or the download is interrupted,
    preparation fails with a network error kind distinct from checksum mismatch; no partial
    files remain in the Cuis home.
15. When the per-user area cannot be written (permissions, no space, read-only), preparation
    fails with a write-failure kind that names the cause; no partial state is left behind.
16. If the bridge process is killed or crashes during preparation, the next status request does
    not report preparing forever: the abandoned attempt is detected as dead, its leftovers are
    discarded, and the home is reported missing (or failed) so a new attempt can start.
17. Once a home is ready, running Smalltalk needs no network access: an offline machine with a
    ready home behaves exactly like an online one.

### Frozen base image

18. The frozen base is built once per Cuis home, headlessly, from the verified distribution, as
    the last step of preparation. It is the only thing the runner copies; it is never booted,
    modified or saved over by a run.
19. If building the base fails (the VM does not start, the build script errors, or it exceeds the
    time limit) the home is **failed** with a base-build error kind carrying the VM output, and
    the distribution is not left marked ready.
20. If a home reported ready later has a missing or damaged part (for example the frozen base or
    the VM is gone), the runner refuses with a corruption error that tells the user to delete
    that version's Cuis home and prepare again; it does not silently rebuild or run on a broken
    copy.

### Runner

21. The runner takes the Cuis directory, the frozen-base directory, the script to execute and a
    time limit. It does not require these to be a shared Cuis home: it works equally on any
    directory pair that has the same shape.
22. Each run executes on a fresh scratch copy of the frozen base, so concurrent runs, repeated
    runs and runs from different sessions never see each other's state. The frozen base is
    byte-identical before and after any run, whatever its outcome.
23. The scratch copy is removed on every outcome (success, failure, timeout, crash, caller
    cancellation, runner error). No scratch copies accumulate across runs.
24. A run has exactly one of these outcomes, mapping to the existing reference script's exit
    codes: **passed** (0), **failed** (1: the script ran to its completion marker and reported
    failure), **timed out or crashed** (124: the time limit expired, or the VM exited without
    reaching the completion marker), **setup error** (2: a required piece, such as the VM, the
    script or the frozen base, is absent; the VM is never started).
25. Output from the VM (standard output and error) is returned with the outcome, in the order
    produced, whatever the outcome. The runner returns it in full; any trimming for presentation
    is the caller's concern.
26. A run that exceeds its time limit is terminated, including any processes the VM started, and
    reported as timed out. A run that finishes before the limit is not delayed by it.
27. The runner never touches the user's live Cuis image or any running Cuis instance, and works
    identically with or without one running.
28. Two runs may proceed at the same time, including while another run or a preparation of the
    same home is in progress; none of them blocks, corrupts or is corrupted by another.
29. The result does not depend on the caller's working directory: the same script gives the same
    outcome when the bridge is started from any directory.

### Platform

30. On a platform other than macOS (the platform of the VM shipped with the distribution),
    preparation and running fail immediately with an unsupported-platform error kind before any
    download or process is started.

### Must not regress

31. Existing bridge tools and their results are unchanged; nothing in this capability runs at
    server startup or delays it, and a machine that never uses it never gets a Cuis home.
32. No state of this capability (status, failure, lock) outlives a deleted Cuis home: deleting a
    home by hand returns that version to missing with no leftovers elsewhere.
