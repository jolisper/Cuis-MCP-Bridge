---
name: run-cuis-mcp-bridge
description: Build, run, and drive the Cuis MCP Bridge. Use when asked to start the bridge, launch the Cuis-side server, run/exercise its list_categories/list_classes/list_methods/get_method_source/list_senders_of/list_implementors_of/etc. operations, or verify a change against the live running server (not its test suite).
---

Drive a live, running `McpBridgeServer` directly over its NDJSON/TCP wire protocol via
`.claude/skills/run-cuis-mcp-bridge/driver.mjs` — a standalone Node script that speaks the
same handshake+request protocol `mcp-bridge/server/src/cuisClient.ts` does, with no
dependency on the Node bridge process itself. All paths below are relative to the repo root.

**Important — this is separate from the interactive dev image.** The real bridge
(`mcp-bridge/server/src/index.ts`) hardcodes port `6789`, which a developer's own
interactive Cuis session may already be using (started manually via
`McpBridgeServer startOn: 6789` per `mcp-bridge/README.md`). This skill launches its **own**
disposable, headless instance on port **`6790`** instead, so it never conflicts with or
disturbs a live dev session. Never kill whatever is listening on `6789` — check first.

## Prerequisites

- The Cuis distribution must be present: `test -d Cuis7-8-main/CuisVM.app || tools/fetch-cuis.sh`.
- `.headless-base/` must be populated (image/sources/changes + `JSON.pck.st`/
  `Network-Kernel.pck.st`) — it's created automatically the first time
  `tools/run-headless-tests.sh` runs; if it's missing, running that once populates it.
- Node.js >= 20 (for the driver script; no npm install needed, it uses only `node:net`).

## Run (agent path)

**1. Check port 6789 isn't what you're about to use** (sanity check, not strictly required
since this skill always uses 6790, but confirms you're not about to collide with anything):
```bash
lsof -iTCP:6790 -sTCP:LISTEN -P 2>/dev/null || echo "6790 free"
```

**2. Launch a fresh, disposable server instance on port 6790**, from a scratch copy of the
frozen base image (never the shared, mutable working image under `Cuis7-8-main/CuisImage/`):
```bash
mkdir -p /tmp/cuis-mcp-bridge-runtime
cp .headless-base/Cuis7.8.image /tmp/cuis-mcp-bridge-runtime/Cuis7.8.image
cp .headless-base/Cuis7.8.sources /tmp/cuis-mcp-bridge-runtime/Cuis7.8.sources
cp .headless-base/Cuis7.8.changes /tmp/cuis-mcp-bridge-runtime/Cuis7.8.changes
nohup ./Cuis7-8-main/CuisVM.app/Contents/MacOS/Squeak -headless \
  /tmp/cuis-mcp-bridge-runtime/Cuis7.8.image \
  -s .claude/skills/run-cuis-mcp-bridge/start-server.st \
  < /dev/null > /tmp/cuis-mcp-bridge-runtime/server.log 2>&1 &
echo $! > /tmp/cuis-mcp-bridge-runtime/server.pid
sleep 3
cat /tmp/cuis-mcp-bridge-runtime/server.log
```
Expect the log to end with `SERVER READY on 6790` and `lsof -iTCP:6790 -sTCP:LISTEN -P` to
show the `Squeak` process listening. `start-server.st` (in this skill directory) fileIns
`JSON`, `Network-Kernel`, and `MCP-Bridge` (not the test package) from the current working
tree, then starts the server and deliberately does **not** call `Smalltalk quitPrimitive:` —
the VM stays alive as a background process.

**3. Drive it** with the included driver:
```bash
node .claude/skills/run-cuis-mcp-bridge/driver.mjs <op> '<jsonParams>'
```
Examples, all verified against a real running instance:
```bash
node .claude/skills/run-cuis-mcp-bridge/driver.mjs list_implementors_of '{"selector":"setSocket:"}'
# {"ok":true,"result":[{"class":"McpBridgeConnection","selector":"setSocket:","side":"instance"}]}

node .claude/skills/run-cuis-mcp-bridge/driver.mjs list_senders_of '{"selector":"setSocket:"}'
# {"ok":true,"result":[{"class":"McpBridgeConnection","selector":"on:","side":"class"}]}

node .claude/skills/run-cuis-mcp-bridge/driver.mjs list_implementors_of '{"selector":"noSuchSelector12345"}'
# {"ok":true,"result":[]}

node .claude/skills/run-cuis-mcp-bridge/driver.mjs list_implementors_of '{}'
# exit 1, {"ok":false,"error":{"code":"invalid_request","message":"missing or invalid selector param"}}

node .claude/skills/run-cuis-mcp-bridge/driver.mjs get_method_source '{"class":"McpBridgeConnection","selector":"setSocket:","side":"instance"}'
# {"ok":true,"result":"setSocket: aSocket\n\tsocket := aSocket"}
```
The driver connects to `127.0.0.1:6790` by default; pass a 3rd/4th CLI arg to target a
different host/port. It exits `0` on `{"ok": true}`, `1` otherwise (including connection
errors and a 5s response timeout).

**4. Stop it when done:**
```bash
kill -9 $(cat /tmp/cuis-mcp-bridge-runtime/server.pid)
```

## Run (human path)

Same as the agent path — there is no separate interactive way to drive this beyond opening
the running image in a GUI and clicking around the System Browser, which isn't scriptable
and wasn't exercised here.

## Test

The SUnit suite (a *different* thing from this skill — this skill drives the live app, the
suite is `/spec-verify-static`'s job): `tools/run-headless-tests.sh mcp-bridge/image/run-tests.st 90`.

## Gotchas

- **A bare `McpBridgeServer startOn: 6790.` in a fileIn script silently no-ops.** The class
  doesn't exist as a compiled-in global until the `MCP-Bridge.pck.st` fileIn actually runs,
  so the Cuis compiler flags it "Undeclared" and the statement never really executes (no
  error, no crash — it just does nothing, and the port never opens). Same reason
  `mcp-bridge/image/run-tests.st` uses `(Smalltalk at: #McpBridgeTests) buildSuiteFromSelectors run`
  instead of a bare `McpBridgeTests ...` — `start-server.st` follows the same pattern:
  `(Smalltalk at: #McpBridgeServer) startOn: 6790.` Always use the late/dynamic lookup form
  for any class defined by a package the same script just fileIn'd.
- **Port 6789 may already be in use by a developer's interactive session** — that's normal,
  not a bug. This skill deliberately never touches it; it always uses 6790.
- **The launched VM process has no supervisor** — if you forget to `kill` it (step 4), it
  keeps running indefinitely in the background, holding port 6790. Check
  `lsof -iTCP:6790 -sTCP:LISTEN -P` if a later launch attempt behaves oddly.

## Troubleshooting

- **`lsof` shows nothing on 6790 after launch, and the log has no `SERVER READY` line, but
  no error either**: almost always the "Undeclared" gotcha above — check `server.log` for a
  `... is Undeclared` line near the top; if present, `start-server.st` (or whatever script
  you're using) referenced a package-defined class by its bare name instead of
  `Smalltalk at: #ClassName`.
- **`Handshake failed: {"code":"protocol_mismatch", ...}`**: the driver's hardcoded
  `PROTOCOL_VERSION` (currently `2`, at the top of `driver.mjs`) has drifted from
  `McpBridgeConnection class>>protocolVersion` in `mcp-bridge/image/MCP-Bridge.pck.st`. This
  is a real bug if it happens, not a driver quirk — it means the two sides' documented
  protocol version and the actual server constant are out of sync (this exact drift was
  found and fixed once already during this project's `senders-implementors-tools`
  initiative). Fix the constant, don't paper over it in the driver.
