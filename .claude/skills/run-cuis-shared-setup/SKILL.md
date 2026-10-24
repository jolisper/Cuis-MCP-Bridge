---
name: run-cuis-shared-setup
description: Drive the shared Cuis home (status, prepare, run a Smalltalk script headlessly on a scratch copy) against a live process, not its test suite. Use when asked to check, prepare, or exercise the cuis-shared-setup capability for real.
---

Drive the shared Cuis home (`mcp-bridge/server/src/cuisHome/`) through
`.claude/skills/run-cuis-shared-setup/driver.mjs` — a standalone Node script that imports the
built `cuisHome.js` and `run.js` and prints JSON. All paths below are relative to the repo root.

## Prerequisites

- macOS (other platforms fail with `unsupported_platform`).
- Node.js >= 20.
- Network access for the first `prepare` (it downloads the pinned Cuis archive).
- The server built, so `dist/cuisHome/*.js` exists: `cd mcp-bridge/server && npm run build`.

## Run (agent path)

Use a throwaway home so verification never touches `~/.cuis-mcp-bridge`. The driver passes
`CUIS_HOME_DIR` as the `home` option:
```bash
export CUIS_HOME_DIR="$(mktemp -d)/cuis-home"
D=.claude/skills/run-cuis-shared-setup/driver.mjs
```

```bash
node $D status                # {"state":"missing"} | preparing | ready | failed (with error)
node $D prepare               # {"ok":true,"result":"started"|"in_progress"|"ready"}
node $D wait                  # polls status every 2s; exit 0 on ready, 1 on failed or after ~15 min
node $D run script.st [60]    # {"outcome":"passed","exitCode":0,"output":"..."}; timeoutSec defaults to 60
node $D runhl <cuisDir> <baseDir> <script> [60]   # same JSON as run, but calls runHeadless directly on any directory pair (no shared home)
```
Optional variables, each passed in the options of `status`, `prepare`, `wait` and `run` only when
set: `CUIS_ARCHIVE_URL` (`archiveUrl`), `CUIS_ARCHIVE_SHA256` (`archiveSha256`), `CUIS_PLATFORM`
(`platform`). They let failure paths be exercised from outside: checksum mismatch with a wrong
`CUIS_ARCHIVE_SHA256`, network failure with an unreachable `CUIS_ARCHIVE_URL`, unsupported platform
with `CUIS_PLATFORM=linux`, any directory pair with `runhl`. `runhl` prints a `HeadlessError` as
`{"ok":false,"error":{...}}`; it exits 0 only when the outcome is `passed`.
Typical sequence: `status` -> `prepare` -> `wait` -> `run`. Exit code is `0` on success/passed,
`1` otherwise. Failures print `{"ok":false,"error":{"code":"...","message":"..."}}` (for example
`cuis_missing` when running before the home is ready); the driver never prints a stack trace.

`run` executes the script headlessly on a scratch copy of the base image; the pristine base is
never modified. Leave `CUIS_HOME_DIR` unset only when you deliberately want the real home.

## Stop / cleanup

Nothing is left running. Delete the throwaway directory:
```bash
rm -rf "$(dirname "$CUIS_HOME_DIR")"
```
`rm -rf` of any home resets its version to missing (`status` reports `missing` again).

## Test

The unit tests are a *different* thing from this skill — this skill drives the live capability;
the static verification is `/spec-verify-static`'s job.

## Gotchas

- **Nothing runs at server startup**, so there is no server to start; the driver calls the
  library directly.
- The first `prepare` downloads ~30 MB and builds a base image (unzip, copy, smoke boot); it runs
  in the background, so use `wait`.
- A headless Cuis keeps Transcript output in memory unless the script runs
  `Transcript logToStdout: true.` first, so a script without it is silent and the run is classed
  `timeout_or_crash` (and, in the smoke boot, `cuis_base_build_failed` with an empty message). The
  real VM works from agent environments; the library's own smoke script already includes this line.
- Start every script with `Transcript logToStdout: true.`, end it with
  `Transcript show: 'DONE exitCode=N'; newLine.` followed by `Smalltalk quitPrimitive: N`, e.g. the
  full script (one statement per line):
  `Transcript logToStdout: true.` / `Transcript show: 'hello'; newLine.` /
  `Transcript show: 'DONE exitCode=0'; newLine.` / `Smalltalk quitPrimitive: 0`. The VM prefixes
  each Transcript line with a timestamp, which is fine; without the DONE marker the run reports
  `timeout_or_crash`. Inside a script `DirectoryEntry currentDirectory` is the distribution
  directory (`dist/`); `/ 'Packages'` addresses a directory and `// 'README.md'` a file.
