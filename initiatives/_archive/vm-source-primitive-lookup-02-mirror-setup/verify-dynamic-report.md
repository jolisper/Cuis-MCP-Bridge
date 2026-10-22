# Dynamic verify report — vm-source-primitive-lookup-02-mirror-setup
Date: 2026-10-19

Surface: built bridge `node mcp-bridge/server/dist/index.js` (rebuilt after the signal-handler
change) over MCP stdio, driven by a scratch JSON-RPC client. The `run-cuis-mcp-bridge` recipe
drives only the Cuis image on 6790 and can't reach `setup_vm_mirror`. Upstream: real GitHub.
Clone, concurrency and interruption runs used a scratch `HOME`; the cross-project check used the
real `~/.cuis-mcp-bridge`.

Invariant 1 — `setup_vm_mirror()` takes no parameters and makes sure the shared VM mirror exists
  Dynamic: pass — `tools/list` has `setup_vm_mirror` as its 14th tool; `{}` args → `started`, and the mirror was produced

Invariant 2 — The shared mirror is in one of three states: missing, initializing or ready
  Dynamic: pass — observed missing (no dir), initializing (lock + `tmp-<pid>`, `in_progress`) and ready (`vm-mirror/`)

Invariant 3 — `setup_vm_mirror` returns immediately; `ready` / `in_progress` / `started`
  Dynamic: pass — `started` in 15–21 ms, `in_progress` in 3–9 ms, `ready` in 1–3 ms with no file or mtime change under home

Invariant 4 — Concurrent calls start at most one clone; every other caller gets `in_progress`
  Dynamic: pass — two bridges started together on one home: one `started`, one `in_progress`, a single `git clone`

Invariant 5 — An interrupted clone is discarded and restarted, even under PID reuse
  Dynamic: pass — SIGTERM: the bridge and its git both exited (no orphan), and the next bridge took over with `started`. SIGKILL: git is orphaned (uncatchable, expected), and the next bridge still took over and finished (~85 s). PID reuse can't be forced live (covered statically)

Invariant 6 — `get_vm_source` and `setup_vm_mirror` are the only tools that make network calls
  Dynamic: pass — during a clone the only outbound socket was git `remote-https` → GitHub :443; the setup bridge had none, and an image-tool bridge only had 127.0.0.1:6789

Invariant 7 — `get_vm_source` and `setup_vm_mirror` never use the Cuis-side connection
  Dynamic: pass — with the Cuis session held by another bridge, `get_vm_version` → `session_busy` and `setup_vm_mirror` → `ready`; the "image unreachable" case wasn't run (6789 is the dev image)

Invariant 8 — The only writes are the mirror setup/fetch, confined to `~/.cuis-mcp-bridge/`
  Dynamic: pass — the scratch `HOME` gained only `.cuis-mcp-bridge/` (just `vm-mirror/` once done); no writes under the repo cwd's `opensmalltalk-vm/`

Invariant 9 — The mirror is a bare repository; no working tree, checkout or `HEAD` move
  Dynamic: pass — `--is-bare-repository` = `true`, `HEAD` → `refs/heads/Cog`, no `.git` and no working files

Invariant 10 — No tool reads from or writes to a project-local `opensmalltalk-vm/` checkout
  Dynamic: pass — the takeover bridge ran from the repo root, which has a real `opensmalltalk-vm/`: nothing in it is newer than the pre-run marker, its `HEAD` is unchanged, and no git argv mentions it

Invariant 11 — The mirror isn't tied to one project; other projects share it
  Dynamic: pass — bridges started from two different project dirs both got `ready` off the real shared mirror, with no change to it and nothing written to their cwds

11 invariants — 11 passed, 0 failed, 0 skipped

## Notes

- Signal-handler fix confirmed live: SIGTERM no longer orphans the clone. SIGKILL still does
  (it can't be caught); the stale-lock takeover handles correctness, and the orphan only wastes
  bandwidth until it ends.
- No test-harness wrapper processes were found this run (none was run). The harness leak from the
  previous report is still unfixed.
