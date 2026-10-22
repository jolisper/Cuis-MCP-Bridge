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
3. The 15 tools listed below (`list_categories`, `list_classes`, etc.) should now be available
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
