---
name: run-smalltalk-tool
description: Drive the real run_smalltalk MCP tool (in-process and through the built stdio server) against a live headless Cuis process, not its test suite. Use when asked to run, exercise or verify the run-smalltalk-headless capability for real, for example from /spec-verify-dynamic.
---

Drive `run_smalltalk` (`mcp-bridge/server/src/runSmalltalk/`) through
`.claude/skills/run-smalltalk-tool/driver.mjs` — a standalone Node script that imports the built
`dist/` code (no dependencies) and prints JSON. All paths below are relative to the repo root.

## Prerequisites

- macOS (other platforms get `unsupported_platform`), Node.js >= 20.
- Server built: `cd mcp-bridge/server && npm install && npm run build` (rebuild after any source change).
- Network only for the first `prepare` (downloads the pinned Cuis archive, ~30 MB). Every later call is offline.

## Setup (throwaway home)

```bash
export CUIS_HOME_DIR="$(mktemp -d)/cuis-home"     # never touches ~/.cuis-mcp-bridge
D=.claude/skills/run-smalltalk-tool/driver.mjs
```

Optional env: `CUIS_PLATFORM` (platform override, in-process commands only), `CUIS_ARCHIVE_URL`,
`CUIS_ARCHIVE_SHA256` (status/prepare/wait only), `DRIVER_CWD` (cwd the tool resolves relative
package paths against; default: current dir).

## Driver subcommands

Exit 0 only on success; errors print `{"ok":false,"error":{"code","message"}}`, never a stack trace.

| Command | What it does |
|---|---|
| `status` / `prepare` / `wait` | shared Cuis state / start preparation / poll every 2 s (exit 0 ready, 1 failed or after ~15 min) |
| `call '<json>'` / `callfile f.json` | build `createRunSmalltalkTool` and invoke its handler; prints `{isError, elapsedMs, result}` where `result` is the tool's text JSON verbatim; exit 0 only if `status` is `passed` |
| `... --abort-after <ms>` | pass an AbortSignal that aborts after the delay (cancellation) |
| `... --parallel <n>` | n identical concurrent calls, all results with elapsed ms |
| `tools-list` | spawn `dist/index.js` over stdio, MCP initialize + tools/list, assert `run_smalltalk` listed, report network connections (lsof) and temp-home contents before/after startup, kill it |
| `tools-call '<json>'` | one `tools/call` through the real stdio server, then close stdin |
| `tools-abort '<json>' [delayMs=5000]` | start a call through the stdio server, SIGTERM the server after the delay, report leftover `cuis-run-*`/`cuis-mcp-run-*` dirs and `Squeak` processes (exit 0 if no dirs remain) |
| `snapshot` | sha256 of every file in `<home>/cuis/*/base` plus the `cuis-run-*`/`cuis-mcp-run-*` dirs in `os.tmpdir()` |

The stdio commands run the real server with `HOME` pointed at a fake dir whose `.cuis-mcp-bridge`
symlinks to `CUIS_HOME_DIR` (the server has no home option); they ignore `CUIS_PLATFORM`.

## Getting ready

```bash
node $D status                  # {"state":"missing"} on a fresh home
node $D call '{"code":"3+4"}'   # setup_error cuis_missing: starts the download, returns at once (inv 23)
node $D wait                    # exit 0 when ready
node $D snapshot > /tmp/before.json   # keep for the isolation comparisons (use any path outside the repo)
```

## Scenarios (what to run, what to observe)

Statuses are in the `result` JSON. "Ready" means `wait` succeeded. Compare `snapshot` before and
after wherever noted. A TestCase fixture used below (save as `$T/tc.json` via a heredoc, or inline):
```
TestCase subclass: #DrvTest instanceVariableNames: '' classVariableNames: '' poolDictionaries: '' category: 'Drv'.
DrvTest compile: 'testOk self assert: true' classified: 'tests'.
DrvTest compile: 'testBad self assert: false' classified: 'tests'.
(Smalltalk at: #DrvTest) suite run
```
(`compile:classified:` was not run offline; fall back to `compile:` if it is missing.)

| Inv | Commands | Observe |
|---|---|---|
| 1-2 result of last expression | `call '{"code":"3+4"}'` | `status passed`, `result "7"` |
| 3 order, relative paths, no implicit deps | `mkdir $T && cd` there; `DRIVER_CWD=$T node $D call '{"code":"1","packages":["a.pck.st","b.pck.st"]}'`; and with `.headless-base/JSON.pck.st` listed alone vs after `Network-Kernel.pck.st` | relative path resolved against `DRIVER_CWD`, not the checkout; a package needing an unlisted dependency fails to load (`package_load_error`) |
| 4 package rejected before start | `call '{"code":"1","packages":["/nonexistent.pck.st"]}'`; a directory path; a `foo.txt` file; a chmod 000 `x.pck.st`. Do it on an EMPTY home too | `setup_error` `package_not_found` / `package_not_pck` with the path; no download started (`status` still missing) |
| 5 empty code | `call '{}'`, `call '{"code":"  "}'`, `call '{"code":5}'` | `setup_error invalid_code`, nothing started |
| 6 timeout range | `call '{"code":"1","timeoutSeconds":0}'`, `999`, `1.5`, `"5"` | `setup_error invalid_timeout`, not clamped; `1` and `300` accepted (default 60) |
| 7-8 status + fields | passed/failed/timeout/setup_error calls below | exactly one JSON outcome with `status`, `exitCode`, `output`, `outputBytes`, `truncated`; `result` only after completion; failures carry `error` as `<code>: <message>` |
| 9 passed | `call '{"code":"(Smalltalk at: #DrvTest) suite run"}'` is not enough alone; use the fixture with only `testOk`, and `call '{"code":"1+1"}'` | `passed`, exit 0 |
| 10-11 failed + tests summary | fixture; then `call '{"code":"self error: \u0027boom\u0027"}'`; then `call '{"code":"3+4"}'` | fixture: `failed`, `tests` {run 2, passed 1, failures 1, errors 0, failing ["DrvTest>>#testBad"]}, `error tests_failed`; error call: `failed`, `error evaluation_error`; `3+4`: no `tests` key |
| 12 timeout, no hang | `call '{"code":"[true] whileTrue","timeoutSeconds":3}'` (elapsed < ~3 s + grace); `call '{"code":"Transcript show: \u0027hi\u0027; newLine. Smalltalk quit"}'` | `timeout`, output so far kept; code calling `Smalltalk quit` also reports `timeout` |
| 13 setup_error means nothing ran | `CUIS_PLATFORM=linux call ...`, invalid inputs, `cuis_missing`; code with a visible side effect (`'x' asFileEntry` write) never created | `setup_error`, `isError true`, no side effect |
| 14 errors never hang | `call '{"code":"1/0"}'`, `call '{"code":"foo bar baz"}'`, a `.pck.st` file containing garbage (`echo 'this is ! not smalltalk' > $T/bad.pck.st`) listed in `packages`, code that raises inside a `[ ] ensure:` | `failed` (`evaluation_error` / `package_load_error`) in well under the timeout, error in output. A whole-script syntax error ends `failed` with `evaluation_error: SyntaxErrorNotification` and runs nothing |
| 15 caps | `call '{"code":"1 to: 200000 do: [:i | Transcript show: \u0027line \u0027, i printString; newLine]. 1"}'`; a result of `(String new: 10000 withAll: $a)` | `truncated true`, `outputBytes` is the full size, output about 64 KB with head 16 KB + `[... truncated ...]` + tail 48 KB; `resultTruncated true`, result <= 4 KB; status still derived from the full output (end the flood with a failing fixture: still `failed` with `tests`) |
| 16 Transcript captured | `call '{"code":"Transcript show: \u0027a\u0027; newLine. Transcript show: \u0027b\u0027; newLine. 0"}'` | output has `a` then `b` in order, no `Transcript logToStdout` in the code |
| 17 fresh instance | run `Smalltalk at: #Leak put: 42. Object subclass: ...` then `call '{"code":"Smalltalk includesKey: #Leak"}'` | second result `false`; also run a snapshotting code (`Smalltalk snapshot: true andQuit: false`) then repeat and `snapshot` |
| 18 concurrency | `call '{"code":"Smalltalk at: #K put: Random new next. Transcript show: K printString; newLine. (Delay forSeconds: 2) wait. Smalltalk at: #K"}' --parallel 3` | three `passed`, distinct output/result per run, total elapsed close to one run (not 3x) |
| 19 cleanup, base unchanged | `snapshot` before and after a passed, a failed, a timeout, a cancelled run | identical `baseHashes`, `runDirs` empty after each (also check `ls $TMPDIR`) |
| 20 no wire channel | with and without a live image on 6789/6790 (see run-cuis-mcp-bridge): same outcomes; `lsof -iTCP:6789` shows no connection from the driver | identical results |
| 21 package read-only | `shasum` the `.pck.st` and its directory listing before/after `call` with it in `packages` | unchanged, no copy written |
| 22 not sandboxed, documented | `tools-list`, read the `run_smalltalk` description; run code writing a relative file | description warns about side effects and relative writes; file lands in the shared Cuis distribution dir (`<home>/cuis/*/dist`-like), not in `DRIVER_CWD`. Delete that file afterwards (it is inside the throwaway home) |
| 23 first use | on a fresh home `call '{"code":"1"}'` | `setup_error cuis_missing`, returns immediately, `status` becomes `preparing` |
| 24 initializing | `call` again right away (also from a second shell) | `cuis_initializing`; no second preparation (one download) |
| 25 ready, offline | after `wait`, run with the network off | normal run |
| 26 failed prep | fresh home with `CUIS_ARCHIVE_SHA256=00..` (checksum), `CUIS_ARCHIVE_URL=http://127.0.0.1:1/x` (fetch); `status` after `wait` | `failed` with specific code; the next `call` returns that code plus a new attempt (`status` -> `preparing`). Needs network or a local server |
| 27 corrupt | `rm -rf <home>/cuis/*/base`, then `call '{"code":"1"}'` | `setup_error cuis_corrupt` naming the directory to delete |
| 28 platform | `CUIS_PLATFORM=linux node $D call '{"code":"1"}'` (any home, even empty) | `setup_error unsupported_platform`, nothing started (home stays empty) |
| 29 startup is inert | `node $D tools-list` with an empty home | `networkConnections []`, `homeBefore` = `homeAfter` = `[]` |
| 30 cancellation | `call '{"code":"[true] whileTrue"}' --abort-after 5000` then `snapshot`; `tools-abort '{"code":"[true] whileTrue"}' 8000` | in-process: returns after ~5 s, no `runDirs`, no Squeak left; stdio: `leftoverRunDirs []`, `leftoverSqueakProcesses []` (compare with `squeakDuringRun`) |
| 31 any cwd | `cd $(mktemp -d)` (no bridge files) and run `node <repo>/$D call ...` and `tools-call` | same outcomes as from the checkout |
| 32 existing tools unchanged | `tools-list` | the 15 previous tools still listed plus `run_smalltalk`; docs: read `README.md` and `mcp-bridge/README.md` for the live-wire-only guarantee statement; wire protocol version untouched (`git diff main -- mcp-bridge/image`) |
| 33 repo scripts | `tools/run-headless-tests.sh mcp-bridge/image/run-tests.st 90`, `git diff main -- tools` | passes as before, no change in `tools/` |

## Cleanup

Nothing is left running (each call ends its Squeak). Delete the throwaway home and any fixtures:
```bash
rm -rf "$(dirname "$CUIS_HOME_DIR")"
```
Afterwards `ls "$TMPDIR"` should show no `cuis-run-*` / `cuis-mcp-run-*` entries.

## Gotchas (learned on the real VM)

- A class defined and used in the same evaluated code fails with `UndeclaredVariableWarning`; reach it with
  `Smalltalk at: #Name` (as in the fixture above).
- `Object subclass: #Foo` alone does not work; use the full
  `subclass:instanceVariableNames:classVariableNames:poolDictionaries:category:` form.
- A script that fails to parse as a whole ends promptly as `failed` (`evaluation_error: SyntaxErrorNotification`)
  and none of its code runs, so earlier Transcript output does not appear.
- Code that calls `Smalltalk quit` is reported as `timeout` (the instance ends without reporting).
- The first call on an empty home starts the download and returns `cuis_missing`; retry after `wait`.
- Quoting: a Smalltalk quote inside shell single quotes is written `\u0027` in the JSON (the table does this);
  for longer code prefer `callfile` with a heredoc.
- The real stdio server ignores `CUIS_PLATFORM`; use in-process `call` for the platform scenario.
