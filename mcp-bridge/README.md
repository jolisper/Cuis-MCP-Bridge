# Cuis MCP Bridge

A bridge that exposes read-only reflection into a running Cuis Smalltalk image — categories,
classes, protocols, methods, source, and comments — as MCP tools, so Claude Code can explore a
live image the way a developer would through the System Browser.

The bridge has two halves: a small package loaded into the Cuis image (`mcp-bridge/image/`)
that runs a TCP server, and a Node.js process (`mcp-bridge/server/`) that speaks MCP over
stdio to Claude Code on one side and NDJSON over TCP to the image on the other. See
`../PROTOCOL.md` for the full wire protocol.

## Prerequisites

- Node.js >= 20 (see `server/package.json`'s `engines` field).
- A Cuis 7.8 image. Not versioned in this repo — run `tools/fetch-cuis.sh` from the repo root
  to download one to `Cuis7-8-main/`.

## 1. Build the bridge process

```
cd mcp-bridge/server
npm install
npm run build
```

This compiles TypeScript to `dist/`, with `dist/index.js` as the entrypoint. Other useful
scripts from `package.json`: `npm start` (run the built bridge directly, useful for a quick
manual check) and `npm test` (run the Vitest suite).

## 2. Load the Cuis-side package

The package lives at `mcp-bridge/image/MCP-Bridge.pck.st` and requires two packages to already
be loaded first (per its `!requires:` header): **JSON** and **Network-Kernel**. Both ship with
the standard Cuis 7.8 image under `Cuis7-8-main/Packages/`, so in a stock image they're
typically loaded already — if not, load them first via File List, in that order, before
loading `MCP-Bridge.pck.st`.

To load:

1. Open **File List** (World menu → Open... → File List).
2. Browse to `mcp-bridge/image/MCP-Bridge.pck.st` and fileIn it.
3. Confirm it registers under **Installed Packages** (World menu → Open... → Installed
   Packages) as `MCP-Bridge`, alongside a new `MCP-Bridge` class category containing
   `McpBridgeServer`, `McpBridgeConnection`, and `McpBridgeConnectionQueue`.

(This describes the normal interactive File List workflow. It's a different, GUI-driven load
path from the headless `CodePackageFile installPackage:` mechanism used by this initiative's
automated tests, which has its own ordering quirks — not relevant here.)

## 3. Start the Cuis-side server

The server never starts automatically — it must be triggered manually, once per image
session, from a Workspace doIt:

```smalltalk
McpBridgeServer startOn: 6789.
```

This binds a loopback-only (`127.0.0.1`) listener on port 6789, matching the port the bridge
process connects to by default (see `../PROTOCOL.md`). To shut it down:

```smalltalk
McpBridgeServer stop.
```

## 4. Register the bridge with Claude Code

The bridge is a normal stdio MCP server — register it once, pointing at the absolute path to
the built `dist/index.js`. Two ways to do this:

**Option A — `claude mcp add` (recommended):**

```
claude mcp add cuis-mcp-bridge -- node /absolute/path/to/mcp-bridge/server/dist/index.js
```

Stdio is the implicit default transport for a local command server, so no `--transport` flag
is needed. Use the real absolute path on your machine, e.g. if this repo is checked out at
`/Users/you/Cuis`, the path is `/Users/you/Cuis/mcp-bridge/server/dist/index.js`.

By default this registers the server with `--scope local` (tied to the project directory
you're running the command from). Add `--scope project` instead if you want the entry written
to a team-shared `.mcp.json` (equivalent to Option B below), or `--scope user` to make it
available across all your projects.

**Option B — edit `.mcp.json` by hand:**

Create or edit `.mcp.json` at the root of the project you want the bridge available in (not
necessarily this repo's root — wherever you'll be running Claude Code from):

```json
{
  "mcpServers": {
    "cuis-mcp-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-bridge/server/dist/index.js"]
    }
  }
}
```

Use a fully expanded absolute path here, not `~`. Option A can get away with `~/path/...`
because your shell expands it before `claude` ever sees it; a `.mcp.json` file is read
directly with no shell involved, so a literal `~` won't resolve and `node` will fail to find
the file.

**After registering either way:**

1. Restart Claude Code (or start a new session) so it picks up the new server — MCP servers
   are only loaded at startup.
2. Verify it's connected: run `claude mcp list` from a terminal, or type `/mcp` inside a
   Claude Code session. `cuis-mcp-bridge` should show as connected. If it shows as failed,
   double-check the path in the config is absolute and that `npm run build` actually produced
   `dist/index.js` (step 1).
3. The 16 tools listed below (`list_categories`, `list_classes`, etc.) should now be available
   to Claude Code for use in conversation.

Check Claude Code's own MCP documentation if this registration format has changed since
writing.

> **If `claude mcp add` opens an interactive chat session instead of registering the
> server** (e.g. it greets you with "Welcome back" and shows part of your command as a
> prompt), your `claude` command is likely wrapped by a shell function/alias that injects
> its own flags before yours — e.g. `claude() { command claude --add-dir <dir> "$@"; }`. A
> variadic flag like `--add-dir` injected ahead of `mcp add <name>` can swallow those
> tokens as its own arguments, leaving only what's after `--` to be parsed, which then gets
> treated as a plain prompt. Check with `type claude`; if it's a function, bypass it with
> `command claude mcp add ...` instead.

The bridge process does not eagerly connect to the Cuis image at startup — it can be
registered and running before `McpBridgeServer startOn: 6789` is evaluated (step 3). The
first tool call triggers the first connection attempt; if the Cuis-side server isn't running
yet, that first call will fail with `unreachable` (see Troubleshooting below) rather than the
whole bridge failing to start.

## 5. Available tools

- `list_categories` — List all class category names in the image, sorted alphabetically.
- `list_classes` — List all class names belonging to a given category, sorted alphabetically.
- `list_protocols` — List the instance-side and class-side protocol names of a class, sorted
  alphabetically.
- `list_methods` — List method selectors within a given class, protocol, and side, sorted
  alphabetically.
- `get_method_source` — Get a method's full source text for a given class, selector, and side.
- `get_class_definition` — Get a class's definition: superclass, instance/class variable names,
  and category.
- `get_class_comment` — Get a class's comment text, or null if it has none.
- `list_senders_of` — List methods that reference a given selector (senders), sorted by class
  then side then selector.
- `list_implementors_of` — List methods that implement a given selector, sorted by class then
  side then selector.
- `get_vm_version` — Get the Cuis VM version string (e.g. a `VMMaker.oscog-eem.NNNN` build
  stamp).
- `get_platform_name` — Get the platform name (e.g. `'Mac OS'`).
- `get_platform_subtype` — Get the platform subtype (e.g. `'arm64'`).
- `get_loaded_modules` — List the VM modules as `{ builtin, loaded }` arrays of names, each
  with its `(i)`/`(e)` suffix, as the VM reports them.
- `setup_vm_mirror` — Host-side, no Cuis image needed. Start (or check on) a local bare mirror
  of the OpenSmalltalk VM source. Takes no parameters and returns immediately with
  `{ "status": "ready" | "in_progress" | "started" }`; `started` means a background
  `git clone --bare` (~750 MB, ~1.5 min) has just begun.
- `get_vm_source` — Host-side, no Cuis connection. Return the C source of one VM primitive as
  JSON `{ function, generatedFrom, helpers, externalCalls, metadata, caveats }`, read only from
  the mirror at the exact upstream commit the running VM was built from (resolved from the
  `VMMaker.oscog-eem.NNNN` token in `vmVersion`). Takes `vmVersion` and `lookupKey`
  (required), plus `module`, `platformName`, `platformSubtype`, `moduleStamps`; pass each one
  verbatim as the Cuis-side tools returned it (`lookupKey` straight off the pragma: a number
  for numbered primitives, the name string for named ones). `caveats` lists every default the
  tool applied. Requires the mirror: `mirror_missing` means run `setup_vm_mirror` and retry. A
  call whose commit isn't in the mirror yet fetches it first and can take noticeably longer.
  When the plugin's stamp in `moduleStamps` differs from the one at that commit, the tool looks
  for the commit carrying the running stamp.
- `run_smalltalk` — Host-side, no Cuis image needed. Run Smalltalk code (mostly SUnit tests) in a
  transient headless Cuis and get a structured outcome. See "`run_smalltalk`" below.

`setup_vm_mirror` requires `git` on PATH (`git_unavailable` otherwise). Its only writes are
under `~/.cuis-mcp-bridge/` (`vm-mirror/`, `vm-mirror.lock`, `vm-mirror.error`, and a transient
`vm-mirror.tmp-<pid>/`); the mirror is shared by every bridge instance on the machine and never
touches a project-local `opensmalltalk-vm/`. `vm-mirror.error` records the failure of the last
background clone: the next `setup_vm_mirror` call reports it (as `fetch_failed` or
`mirror_write_failed`, with git's text) and consumes it, and the call after that retries.

Typical `get_vm_source` call order: `get_method_source` (read the pragma) → `get_vm_version` →
`get_platform_name` / `get_platform_subtype` as required → optionally `get_loaded_modules` →
`get_vm_source`. Which platform parameters it requires depends on `module`:

| `module` | `platformSubtype` | `platformName` |
|---|---|---|
| ordinary plugin | not required | not required |
| `SqueakFFIPrims` | required | required |
| omitted | required | optional (without it, the plain `cointerp.c` rendering is returned) |

## `run_smalltalk`

Runs Smalltalk code, mostly SUnit tests, in a throwaway headless Cuis built from the pinned
shared Cuis (see "Shared Cuis home") and returns a structured outcome. Host-side: it never
touches the live image through the wire channel and works without one. Every call gets a fresh
instance, so nothing the code does is visible to later runs. macOS only.

The code is evaluated as a script and the value of its last expression is the result, e.g.
`MyTest suite run`.

**Parameters**

- `code` (required) — the Smalltalk code to run.
- `packages` — `.pck.st` paths to load first, in order (relative paths resolve against the
  session's working directory). Dependencies are not loaded implicitly: list them before the
  packages that need them, e.g. `JSON` and `Network-Kernel` under the shared Cuis
  `dist/Packages`.
- `timeoutSeconds` — integer, default 60, maximum 300; out-of-range values are rejected, not
  clamped.

**Outcome** (JSON text)

```json
{ "status": "passed", "exitCode": 0, "output": "...", "outputBytes": 1234, "truncated": false,
  "result": "a TestResult", "resultTruncated": false,
  "tests": { "run": 3, "passed": 3, "failures": 0, "errors": 0, "failing": [], "erroring": [] } }
```

- `status` — `passed`, `failed`, `timeout` or `setup_error` (nothing was executed).
- `exitCode`, `output` — the Transcript output of the run. `output` is capped at 64 KB (the first
  16 KB and the last 48 KB are kept, with a cut marker); `outputBytes` is the full size and
  `truncated` says whether it was cut. Status and `tests` come from the full output.
- `result` — text form of the last value, capped at 4 KB (`resultTruncated`). Absent on
  `timeout` and `setup_error`.
- `tests` — only when the result is a `TestResult`: counts and the ids of failing and erroring
  tests.
- `error` — on every non-`passed` outcome, as `<code>: <message>`. A `setup_error` is also
  flagged as an MCP error.

**Error codes**

- Input (`setup_error`): `invalid_code`, `invalid_packages`, `package_not_found`,
  `package_not_pck`, `invalid_timeout`. All are rejected before any Cuis is started.
- Shared Cuis (`setup_error`): `unsupported_platform`, `cuis_missing`, `cuis_initializing`,
  `cuis_corrupt`, `cuis_fetch_failed`, `cuis_checksum_mismatch`, `cuis_write_failed`,
  `cuis_base_build_failed` (see "Shared Cuis home").
- Run (`failed`): `evaluation_error` (the code raised an unhandled error or did not compile),
  `package_load_error` (a package failed to load), `harness_error` (the harness could not
  report the result or tests), `tests_failed` (the result is a `TestResult` with failures or
  errors).
- `timeout` — the run did not finish in time or ended without reporting.

**First use.** The first call with no shared Cuis installed starts the download in the
background and returns `cuis_missing` without running anything (a call during the download gets
`cuis_initializing`); retry shortly. Once ready, runs need no network. A failed preparation is
reported with its own code and the next call starts a fresh attempt.

**Not sandboxed.** The code can write files, use the network, start processes or quit the VM, so
review it for host side effects before running, ask the user and wait for explicit confirmation. Relative file writes land in
the shared Cuis distribution directory (`dist/`), not in the project directory.

**Gotchas on the real VM**

- A class defined and used within the same evaluated code fails with `UndeclaredVariableWarning`;
  define it in one call, or reach it with `Smalltalk at: #Name`.
- `Object subclass: #Foo` needs the full
  `subclass:instanceVariableNames:classVariableNames:poolDictionaries:category:` form.
- A script that fails to parse as a whole ends promptly as `failed` (`evaluation_error: SyntaxErrorNotification`) and none of its code runs, so earlier Transcript output does not appear.
- Code that calls `Smalltalk quit` skips the harness markers and is reported as `timeout`.

## Shared Cuis home

The server also contains a shared, per-user Cuis installation capability, used by the
`run_smalltalk` tool (see above). It lives under `~/.cuis-mcp-bridge/cuis/<key>/`, where `<key>` is the
Cuis release plus the short pinned commit of Cuis-Smalltalk/Cuis7-8 (currently `7.8-d4f9cc1`):

- `dist/` — the verified distribution, including the macOS VM.
- `base/` — the frozen base image, sources and changes.
- Siblings: `<key>.lock`, `<key>.error` (last failure, reported until the next prepare) and
  `<key>.tmp-<pid>/` (in progress).

Different Cuis versions get different directories; old ones are never touched. Deleting
`~/.cuis-mcp-bridge/cuis/<key>` returns that version to not-installed.

It is fetched on demand (never at server start), pinned to a specific commit rather than a moving
branch, verified by the SHA-256 of the downloaded archive before extraction, then smoke-booted
headlessly. It needs `/usr/bin/unzip` and is macOS only. Once ready, running needs no network.

Runs execute on a throwaway scratch copy of `base/`, so the frozen base is never modified, under
a time limit that kills the VM's whole process group. Output is stdout and stderr merged.
Outcomes are passed, failed, timeout-or-crash and setup-error (exit codes `0`/`1`/`124`/`2`; the
completion marker line is `DONE exitCode=N`).

A headless Cuis keeps Transcript output in memory unless the script runs `Transcript logToStdout: true.`
first, so a script that doesn't is silent and the run is classed timeout-or-crash. Callers must start
their scripts with it and end with `Transcript show: 'DONE exitCode=N'; newLine.` then
`Smalltalk quitPrimitive: N` (the marker may appear after the VM's timestamp prefix). Inside a script,
`DirectoryEntry currentDirectory` is the distribution directory (`dist/`), where `/ 'Packages'`
addresses a directory and `// 'README.md'` a file.

Runs execute with the VM's cwd set to the distribution's `dist/`, where the VM writes `UserChanges/`
files; the shared home removes them after each run (and after the smoke boot) so `dist/` stays
pristine. Overlapping runs could in theory remove each other's change log.

It is independent of the repo's own `tools/setup.sh`, `tools/fetch-cuis.sh`, `.headless-base`
and test scripts. Its error kinds, reported by `run_smalltalk` as `setup_error` codes:

- `unsupported_platform` — not macOS.
- `cuis_missing` — not installed yet; prepare it first.
- `cuis_initializing` — a prepare is still in progress; retry once it finishes.
- `cuis_fetch_failed` — the archive couldn't be downloaded; retry when online.
- `cuis_checksum_mismatch` — the downloaded archive doesn't match the pinned SHA-256.
- `cuis_write_failed` — a write under `~/.cuis-mcp-bridge` failed, e.g. a full disk.
- `cuis_base_build_failed` — the smoke boot or base image build failed.
- `cuis_corrupt` — the installation is unreadable or incomplete. Delete
  `~/.cuis-mcp-bridge/cuis/<key>` and prepare again.
- `internal_error` — an unexpected failure.

## Troubleshooting

Cuis-side tool calls can fail with one of six structured error codes:

- `not_found` — the category, class, protocol, selector, or side you named doesn't exist in
  the image. Check spelling/casing.
- `invalid_request` — a required parameter was missing or malformed. The Cuis side never even
  looked at the image for this one.
- `internal_error` — an unexpected failure on the Cuis side while performing the reflection
  operation. Likely a bug — worth reporting with the exact tool call that triggered it.
- `protocol_mismatch` — the bridge process and the loaded `MCP-Bridge.pck.st` package disagree
  on protocol version. Rebuild the bridge (`npm run build`) and/or reload the Cuis-side
  package so both sides are in sync.
- `session_busy` — another connection is already active against the Cuis-side server (only one
  is allowed at a time). Wait for it to finish or go idle past the inactivity timeout, or
  restart the Cuis-side server.
- `unreachable` — the bridge couldn't reach the Cuis-side server at all. Start the Cuis-side
  server first (`McpBridgeServer startOn: 6789.`), and confirm nothing else is using port 6789.

The host-side VM source tools (`setup_vm_mirror`, `get_vm_source`) don't talk to Cuis and use
their own codes instead, reported as `"<code>: <message>"`:

- `invalid_request` — a `get_vm_source` parameter has the wrong type. Also `module` given
  with a numeric `lookupKey`, or `moduleStamps` not an object with `builtin` and `loaded`
  string arrays.
- `mirror_missing` — there is no VM source mirror yet. Call `setup_vm_mirror`, then retry.
- `mirror_initializing` — the mirror is still being cloned. Retry once it's `ready`.
- `mirror_busy` — another bridge instance (another session) is fetching into the mirror. Try
  again once it has finished. Calls within one bridge instance share a fetch instead of
  failing. If it persists with no other session running, a killed git may have left
  `~/.cuis-mcp-bridge/vm-mirror/refs/heads/Cog.lock` behind; delete it.
- `symbol_not_found` — the primitive isn't in the source at the resolved commit (no exports
  row, `primitiveTable` slot, or definition). Note that a string `lookupKey` such as `"1"` is
  always looked up as a name.
- `version_unparseable` — `vmVersion` has no `VMMaker.oscog-<initials>.<N>` token. Pass the
  string `get_vm_version` returned, verbatim.
- `missing_platform_info` — a platform parameter the case needs is missing; the error names it
  (see the table above).
- `unsupported_platform` — Win32 (whenever supplied), a `platformName`/`platformSubtype` the
  case uses that has no mapping, or, with no `module`, a Stack or other unmapped VM family.
- `git_unavailable` — no usable `git`. Install it and retry.
- `fetch_failed` — the upstream repository couldn't be reached; the message carries git's text.
  Retry when online.
- `mirror_write_failed` — any other clone or fetch failure, e.g. a full disk or an unwritable
  `~/.cuis-mcp-bridge`. Fix the cause and retry.
- `commit_not_found` — no commit carries the `VMMaker.oscog` token, even after a fetch.
- `mirror_corrupt` — the mirror can't be read as a git repository. Delete
  `~/.cuis-mcp-bridge/vm-mirror` and call `setup_vm_mirror` again; the tools never repair or
  delete it themselves.
- `internal_error` — git couldn't be run to completion (resource exhaustion, killed, output too
  large). May be transient; retry. Do not delete the mirror.
- `module_not_found` — `module` isn't a plugin at that commit.
- `path_not_found` — the commit lacks the expected file, e.g. an older repository layout.
- `primitive_slot_empty` — the numbered slot holds no function; the method always runs its
  Smalltalk fallback.

`run_smalltalk` is also host-side. It reports its failures as `<code>: <message>` in a
`setup_error` outcome; the codes, including the shared-Cuis ones (`cuis_missing`,
`cuis_initializing`, `cuis_corrupt`, ...), are listed under "`run_smalltalk`" and "Shared Cuis
home". For `cuis_corrupt`, delete the directory named in the message and call again.
