# run-smalltalk-headless — functional spec

## Summary

The bridge gains a tool that runs Smalltalk code, mostly SUnit tests, in a throwaway headless Cuis
instance and returns a structured outcome. The consumer is an AI assistant (MCP client) in a
session started in any Cuis project directory. The tool never evaluates in, or reads from, the
user's live image, and needs no running Cuis image.

Terms: the **shared Cuis** is the pinned per-user Cuis home delivered by `cuis-shared-setup`. A
**run** is one execution of the caller's code. The **outcome** is the tool's structured response.

## Behavior

### Inputs

1. The caller provides the Smalltalk **code** to run (required, non-empty text) and may provide:
   a list of **package paths** to load first, and a **timeout**.
2. The code is evaluated as a script; the value of its last expression is the run's **result**.
   Running a test suite (for example `MyTest suite run`) is the canonical use.
3. Each package path must name an existing regular file ending in `.pck.st`. Relative paths
   resolve against the session's working directory, not the bridge's checkout. Packages are
   loaded in the order given. Dependencies (for example JSON, Network-Kernel) are not loaded
   implicitly: the caller lists them, before the packages that need them.
4. A missing path, a directory, a non-`.pck.st` file or an unreadable file is rejected before any
   Cuis is started or fetched, with a `setup_error` outcome whose code names the problem and the
   offending path.
5. An empty or missing code input is rejected with a `setup_error` before anything starts.
6. The timeout is optional, in seconds, with a documented default and a documented maximum;
   values outside the allowed range are rejected with a `setup_error` rather than clamped
   silently. **Open question:** default and maximum values.

### Outcome

7. Every call returns exactly one outcome with a status: `passed`, `failed`, `timeout`,
   `setup_error`. The status is machine-readable and distinct for each cause; the caller never
   needs to parse prose to tell them apart.
8. Every outcome carries: the status, the run's exit code, the captured **output**, and, when the
   code ran to completion, the **result** (text form of the last value). Failure outcomes carry a
   code-tagged error in the same `<code>: <message>` style as the bridge's existing host-side
   tools.
9. `passed`: the code ran to completion without an unhandled error, and, if the result is a test
   result, with no failures or errors.
10. `failed`: the code ran but raised an unhandled error, or the result is a test result with at
    least one failure or error. Output and the error description are included.
11. When the result is a test result, the outcome also carries a `tests` summary: counts of run,
    passed, failures and errors, with the ids of the failing and erroring tests. For any other
    result value no `tests` summary is present.
12. `timeout`: the run did not finish within the timeout, or ended without completing (the
    instance died or exited before reporting). Output produced so far is included. No run, however
    it hangs, blocks the caller beyond the timeout plus a short grace period.
13. `setup_error`: the run could not start or the environment was not usable (invalid input,
    shared Cuis problem, unsupported platform). No caller code was executed.
14. An error raised inside the code or inside a loaded package, including during package loading,
    never hangs the run until the timeout; it ends promptly as `failed` with the error in the
    output.
15. Output is capped at 64 KB: when longer, the first 16 KB and last 48 KB are kept, and the
    outcome says it was truncated and reports the full size in bytes. The result text is capped
    at 4 KB with the same truncation indication. Status and test summary are derived from the
    full output, never from the truncated one. Flooding output cannot exhaust server memory.
16. Output is what the code wrote to the Transcript during the run, in order. The caller does not
    have to enable Transcript output; the run always shows it.

### Isolation

17. Every run executes in a fresh, transient instance built from the pristine shared Cuis plus the
    caller's listed packages. Nothing the code does inside the instance (defining classes,
    changing globals, snapshotting) is visible to any later run, to the user's live image, or to
    the project's own image.
18. Concurrent calls (same session or several sessions) each get an independent instance and do
    not see each other's state or output.
19. After a run ends, whatever the status, no scratch files of the run remain and the shared
    Cuis is byte-for-byte unchanged.
20. The tool never connects to, queries or modifies the live image through the bridge's wire
    channel. It works identically whether or not a live image is connected.
21. Running a `.pck.st` file loads it from where it is: the file is read, never modified or copied
    back.
22. The code is not sandboxed. Code can write files, use the network, start processes or quit the
    VM; the tool's description tells the assistant to review code for such host side effects and
    ask the user and wait for explicit confirmation before running. Relative file writes land in the shared Cuis distribution
    directory, not in the project directory, and are documented as such.

### First use and shared Cuis states

23. When the shared Cuis is not installed, a call starts its preparation in the background, returns
    a `setup_error` with a "not installed, preparing" code, and executes nothing. The call does not
    wait for the download.
24. While preparation is in progress (started by this or another session), calls return a
    `setup_error` with an "initializing" code and do not start a second preparation.
25. Once the shared Cuis is ready, the next call runs normally and needs no network access.
26. A failed preparation is reported with its specific kind (fetch failed, checksum mismatch,
    write failed, base build failed); the next call after a failure starts a fresh attempt.
27. A damaged shared Cuis (missing parts) is reported with a "corrupt" code that names the
    directory the user can delete to start over.
28. On a platform other than macOS, the tool returns a `setup_error` with an unsupported-platform
    code and starts nothing.
29. Starting the bridge server does no network access and no Cuis work; nothing happens until the
    first call.

### Cancellation and robustness

30. If the caller cancels the call or the server shuts down, the instance and everything it
    spawned are killed and its scratch files removed.
31. Calls from a session whose working directory is not the bridge checkout and holds no bridge
    scripts, VM or Cuis behave identically to calls from the checkout.

### Must not regress

32. The bridge's existing tools, their read-only guarantee against the live image and the wire
    protocol version are unchanged. Documentation states that the read-only and no-evaluation
    guarantees apply to the live-image wire channel, and that this host-side tool evaluates
    code only in transient instances.
33. The repository's own setup scripts, headless test runner and test skill behave as before.
