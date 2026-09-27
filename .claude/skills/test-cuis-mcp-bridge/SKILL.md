---
name: test-cuis-mcp-bridge
description: Run the Cuis MCP Bridge's test suites. Use when asked to run, execute, or check tests for this project — it has no single root-level marker file (no package.json/Cargo.toml/etc. at repo root), so generic single-stack test runners can't auto-detect it.
---

This repo has **three separate test suites**, in three separate subdirectories — run all
three when asked to "run the tests" for this project, unless the request is scoped to one.

## Cuis-side (Smalltalk, SUnit)

```bash
tools/run-headless-tests.sh mcp-bridge/image/run-tests.st 90
```

Boots the Cuis VM headlessly against an isolated scratch copy of a frozen base image (never
the shared, mutable working image), fileIns `JSON`, `Network-Kernel`, `MCP-Bridge`, and
`Tests-MCP-Bridge`, runs the full `McpBridgeTests` suite, and exits.

Exit codes: `0` pass, `1` real test failure, `124` timeout/crash, `2` setup error (missing
VM/script/zip — run `tools/fetch-cuis.sh` if `Cuis7-8-main/` is missing).

Expect a line like `41 run, 41 passes, 0 expected failures/errors, 0 failures, 0 errors, 0
unexpected passes` followed by `DONE exitCode=0`.

**No single-test filtering** — this harness always runs the entire suite; there's no
CLASSNAME/selector argument to narrow it (see `.claude/agents/tdd-red.md` etc. for the same
caveat documented for the TDD agents).

## Node/TypeScript side (Vitest)

```bash
npm test --prefix mcp-bridge/server
```

Runs `vitest run` over `mcp-bridge/server/src/*.test.ts`. No VM boot, no isolation dance —
plain, fast, in-process.

Expect `Test Files  N passed (N)` / `Tests  M passed (M)`.

## VM plugin side (Cuis, headless, against the locally-built VM)

```bash
tools/run-vm-primitive-test.sh vm-exploration/image/run-check.st 300
```

Exercises `vm-exploration/plugins/` — `DummyPlugin` (C) and `DummyPluginZig` (Zig) — asserting
`hello:` and `helloZig:` both return their real primitive output, not a Smalltalk fallback.
Same frozen-base/scratch-copy/watchdog isolation as the Cuis-side suite above, but against a
**locally-built** VM (`opensmalltalk-vm/`) instead of the shipped one, so it can load these
plugins.

Fully self-bootstrapping: it builds the local VM (`tools/build-local-vm.sh`) if missing, and
always (re)builds and installs both plugin bundles (`tools/install-local-plugins.sh`,
via `vm-exploration/build.zig`) before running — no manual setup beyond `tools/setup.sh`
having fetched `Cuis7-8-main/` and `opensmalltalk-vm/` once.

Exit codes: `0` pass, `1` real test failure, `124` timeout/crash, `2` setup error.

Expect two `DummyPrimitiveDemo ... => 'Hello world...'` lines followed by `DONE exitCode=0`.

**macOS/arm64 only, and slow on a cold run** — building the local VM from scratch takes a
few minutes the first time (or after `opensmalltalk-vm/` is re-cloned); pass a generous
timeout (300s+) rather than the default 60s used by the other suites. Once built, subsequent
runs are fast (VM build is skipped, plugin rebuild is near-instant via `zig build`'s cache).

## Why this skill exists

`test-run-all` (and similar generic test runners) detect project type from a fixed table of
root-level marker files (`package.json`, `Cargo.toml`, ...). This repo has neither at its
root — the Node project lives one level down at `mcp-bridge/server/`, and the Cuis/Smalltalk
side has no marker file convention at all. Without this skill, a generic runner reports "no
marker file found" and stops rather than guessing.
