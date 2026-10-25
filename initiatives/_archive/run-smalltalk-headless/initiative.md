# run-smalltalk-headless

## Problem

The MCP bridge can only inspect a running Cuis image, and only read-only. An assistant using it
cannot execute Smalltalk: not a test, not a script, not a quick check of how something behaves.
Today, running any code means a person hand-writes a `.st` script and invokes the headless test
runner themselves, so the assistant's browse-and-understand loop ends exactly where
verification would begin.

The obvious alternative, evaluating code in the user's live image, is unsafe. Arbitrary code
could mutate or corrupt the image the developer is working in, and the bridge's read-only
guarantee is a deliberate part of its design.

## Goals

- An assistant can run arbitrary Smalltalk code, mostly SUnit tests, and get back a clear
  outcome without a person writing or launching anything by hand.
- Every run happens in a transient, headless Cuis instance built from a known-good image and
  discarded afterwards, so the user's live image is never touched and one run never affects the
  next.
- The code under test can be brought into that instance, so tests can exercise the project's own
  packages and not only stock Cuis.
- The outcome is machine-readable: it distinguishes success, test or code failure, timeout and
  setup problems, and carries the output and the value the code produced, so an assistant can
  act on it without parsing prose.
- The capability works from a session started in any Cuis project directory, not only the
  bridge's own checkout, so it cannot assume the session directory holds the bridge's scripts,
  VM or Cuis distribution.
- The tool runs on the shared, versioned, on-demand Cuis setup delivered by the
  `cuis-shared-setup` initiative, which is done (archived).
- Failures are reported in the same structured, code-tagged style as the bridge's existing
  host-side tools.

## Non-goals

- Running code in the live image. The bridge stays read-only against it.
- Using the locally-built VM and its plugins; that is a later initiative.
- Keeping images or state between runs.
- Interactive or long-lived sessions.

## Scope

A new host-side tool in the Node/TypeScript bridge process, in the same family as the VM source
tools: it needs no running Cuis image. It builds on `src/cuisHome/` from `cuis-shared-setup`:
`runWithSharedCuis` (runs a script on the pinned shared home, never fetches, refuses with
`cuis_missing` / `cuis_initializing` / `cuis_corrupt` / `unsupported_platform`), plus
`cuisHomeStatus` and `prepareCuisHome` (non-blocking background preparation). The work here is
generating each run's script (it must prepend `Transcript logToStdout: true.`, or a headless Cuis
prints nothing), calling `prepareCuisHome` on first use and reporting its progress, and turning
the runner's outcome (`passed`/`failed`/`timeout_or_crash`/`setup_error`) into the structured
result, with the output limits and package loading decided in the logbook. Documentation touched: the root
README, the bridge README and the test skill. The wire protocol document may need a
clarification about what its read-only and no-evaluation guarantees cover.
