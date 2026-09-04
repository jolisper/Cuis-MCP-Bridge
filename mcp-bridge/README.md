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
- A Cuis 7.8 image. This repo already has one at `Cuis7-8-main/`.

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

Add an MCP server entry pointing at the built `dist/index.js`, e.g. in a `.mcp.json` at your
project root (or via `claude mcp add`):

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

Use the absolute path to `dist/index.js` on your machine. Restart Claude Code (or reload MCP
servers) after adding the entry. Check Claude Code's own MCP documentation if this format has
changed since writing.

The bridge process does not eagerly connect to the Cuis image at startup — it can be
registered and running before `McpBridgeServer startOn: 6789` is evaluated. The first tool
call triggers the first connection attempt.

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

## Troubleshooting

Tool calls can fail with one of six structured error codes:

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
