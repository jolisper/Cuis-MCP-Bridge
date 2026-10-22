# VM Source: Primitive Lookup — Part 2: Mirror Setup — Technical Spec

Behavior lives in `functional-spec.md` (invariants 1–11, cited as "inv N"). Design research
(mirror location, tmp-dir rename, lock with start time) is in
`../vm-source-primitive-lookup/initiative.md` under "Mirror creation"; this plan doesn't
repeat it. It's the first slice of the parent `../vm-source-primitive-lookup/technical-spec.md`
"Slice B", and uses that plan's file layout, so parts 3 and 4 extend these files rather than
replace them.

## Context

- **Server today** — `mcp-bridge/server/src/`. `tools.ts` holds the 13 forwarded tools:
  `TOOL_METADATA` (`:23-136`) plus one generic handler in `createTools(client)` (`:148-167`)
  that sends `args` to `client.sendRequest`. `index.ts:15-16` builds the tool list from
  `createTools(client)`; the list and call handlers (`:23-40`) are generic over
  `ToolDefinition`. Nothing host-side exists yet: there is no fs, `child_process` or git code
  in `src/`.
- **Toolchain** — ESM (`"type": "module"`, `NodeNext`), Node ≥ 20 (local 26.3), vitest
  (`npm test`), no runtime deps beyond `@modelcontextprotocol/sdk`. Tests live next to the
  source as `*.test.ts`.
- **Out of this part.** `get_vm_source` is part 3. Recording and reporting a failed clone
  (`vm-mirror.error`, `fetch_failed` / `mirror_write_failed`) and `git_unavailable` are
  part 4 (part 4 inv 2, 12). Inv 6–8 name `get_vm_source` as constraints only; here they are
  enforced for `setup_vm_mirror`, and part 3 inherits them.

## Proposed changes

### New folder `mcp-bridge/server/src/vmSource/`

Host-side tools live apart from `tools.ts` because they never take a `CuisClient` (inv 7).

| File | Responsibility |
|---|---|
| `mirror.ts` | Paths, `mirrorState()`, lock, background clone, `setupVmMirror()`. |
| `tools.ts` | `createVmSourceTools(opts?)` → `[setup_vm_mirror]` as a `ToolDefinition`. |

`MirrorOptions { home: string; upstreamUrl: string; git: string }`, defaulting to
`path.join(os.homedir(), '.cuis-mcp-bridge')`,
`https://github.com/OpenSmalltalk/opensmalltalk-vm.git` and `'git'`. The options exist for
tests (a temp home, a local upstream, a wrapper `git`), not as user configuration. Nothing
reads the working directory, so a project's own `opensmalltalk-vm/` is never seen (inv 10),
and every bridge on the machine shares one home (inv 11).

### `mirror.ts`

Paths under `home`, all fixed names (the tool takes no input, so no caller data reaches a
path, inv 8): `vm-mirror`, `vm-mirror.lock`, `vm-mirror.tmp-<pid>`.

- **`mirrorState(opts): 'missing' | 'initializing' | 'ready'`** (inv 2). `vm-mirror` exists
  → `ready`; else a live lock → `initializing`; else `missing`. It's exported for part 3's
  `mirror_missing` / `mirror_initializing` check and only reads.
- **Lock** = JSON `{pid, startTime}` for the bridge process (`process.pid`). That's the
  process whose `close` handler finishes the clone, so if it dies the clone can never finish,
  which is what inv 5 calls "interrupted". The git child's pid would stay "live" in that case,
  as an orphaned download nobody will rename. `startTime` is
  `ps -o lstart= -p <pid>` (`execFile`, `LC_ALL=C`, trimmed). A lock is **live** iff `ps`
  succeeds for its pid and prints the same `startTime`. A dead pid or a different start time
  (PID reuse, inv 5) means **stale**, and so does an unparseable lock.
- **Acquire** by writing `vm-mirror.lock.<pid>.<random>` and then `fs.link`ing it to
  `vm-mirror.lock`, then unlinking the temp name. `link` is atomic and fails with `EEXIST` if
  the lock exists, so exactly one concurrent caller wins (inv 4), and no reader ever sees a
  half-written lock. A plain `writeFile(…, {flag: 'wx'})` would leave an empty file visible
  for a moment, which another caller would read as stale and take over.
- **`setupVmMirror(opts): Promise<'ready' | 'in_progress' | 'started'>`**, in order:
  1. `vm-mirror` exists → `ready`. No spawn, no lock, no write (inv 3).
  2. `mkdir -p home`.
  3. Try to acquire. On `EEXIST`, read the lock: if it's live → `in_progress`. If it's stale →
     take over: rename it to `vm-mirror.lock.stale-<pid>.<random>` and re-read the renamed
     file. If its content is the stale content seen before, delete it, and continue.
     Otherwise someone acquired it in between: `link` it back and answer `in_progress`. Then
     retry the acquire once; `EEXIST` again → `in_progress`.
  4. Holding the lock, re-check `vm-mirror` (another bridge may have finished between steps 1
     and 3). If it now exists, release the lock and return `ready`.
  5. Remove every `vm-mirror.tmp-*` (left by dead holders; only the lock holder ever clones).
  6. Spawn `<git> clone --bare --quiet <upstreamUrl> <home>/vm-mirror.tmp-<pid>`
     (`spawn`, no shell, `env` + `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, stdio
     `['ignore', 'ignore', 'pipe']`, keeping the stderr tail for part 4). Return `started`
     without awaiting it (inv 3).
- **Child completion** (`close`, plus `error` so a missing binary can't crash the bridge with
  an unhandled event). On exit 0: `rename(tmp, vm-mirror)`, then release the lock. The order
  matters, because releasing first would open a moment of "no mirror, no lock" in which
  another caller starts a second clone. On anything else: `rm -rf tmp`, then release. With no
  error file yet, the next call simply starts again. Part 4 adds the error file here, between
  the `rm` and the release.
- **Release** = unlink `vm-mirror.lock` only if its content is still this process's
  `{pid, startTime}`.
- **Bridge exit** — `process.once('exit', () => child.kill())` while a clone runs, so a clean
  exit leaves no orphaned download. After a hard kill the lock goes stale and the next call
  takes over (inv 5).

Bare by construction: `clone --bare` creates no working tree, and nothing here runs
`checkout`, `worktree`, `update-ref` or `symbolic-ref` (inv 9). The only network call is that
clone (inv 6).

### `vmSource/tools.ts` and wiring

`setup_vm_mirror`: `inputSchema: { type: 'object', properties: {} }`. Its description says it
returns immediately, the clone runs in the background (about 750 MB), and the mirror is shared
across projects. The handler returns `JSON.stringify({ status })` as text, like the forwarded
tools. A thrown fs error (e.g. an unwritable home in step 2) becomes
`{ content: [{ text: message }], isError: true }`; part 4 gives those codes.

`tools.ts` `createTools` gains an optional second parameter and appends the host-side tools:

```ts
export function createTools(
  client: CuisClient,
  vmSource: Partial<MirrorOptions> = {},
): ToolDefinition[] {
  return [...TOOL_METADATA.map(/* existing forwarding handler */), ...createVmSourceTools(vmSource)];
}
```

`createVmSourceTools` fills missing fields with the defaults above. `index.ts` is unchanged
(`createTools(client)` gets the real home). The doc comment at `tools.ts:143-147` changes from
"the 13 read-only reflection operations" to the 13 forwarded tools plus the host-side ones.
Inv 7 holds because `createVmSourceTools` takes no client.

**Tradeoff — where to compose.** Composing in `index.ts` would keep `tools.ts` purely "forward
to Cuis", but `index.ts` connects stdio at import time (`:43`), so its wiring can't be
unit-tested. Composing in `createTools` makes the wiring testable. The optional `vmSource`
parameter lets that test go through `createTools` against a temp home, so no test can reach
the real `~/.cuis-mcp-bridge`. A required parameter would also stop the existing
`createTools(fake)` calls in `tools.test.ts` from silently getting the real-home default. That
default is never used there, since those tests only call forwarded tools, and making the
parameter required would mean editing all of them, so the parameter stays optional.

**Tradeoff — `ps` for start time** vs. reading `/proc` or a native addon: `ps -o lstart=`
works on macOS and Linux (procps), needs no dependency and doesn't touch the network.
Second-level resolution is enough, because a reused pid would also have to start in the same
second.

## Implementation sequence

1. `mcp-bridge/server/src/vmSource/mirror.test.ts` — test harness: temp home, local bare upstream with one commit, gated wrapper `git` script logging argv
2. `mcp-bridge/server/src/vmSource/mirror.ts` — paths, `mirrorState`, `ready` short-circuit
3. `mcp-bridge/server/src/vmSource/mirror.ts` — lock (start time, link-acquire, release), background clone, `started` / `in_progress`
4. `mcp-bridge/server/src/vmSource/mirror.ts` — stale-lock takeover (dead pid, reused pid), tmp cleanup, clone-failure cleanup
5. `mcp-bridge/server/src/vmSource/tools.ts` — `createVmSourceTools`, `setup_vm_mirror` definition (+ `tools.test.ts`)
6. `mcp-bridge/server/src/tools.ts` — optional `vmSource` param, append `createVmSourceTools(vmSource)`, doc comment (+ wiring test in `tools.test.ts`)
7. `mcp-bridge/README.md` — 14 tools, `setup_vm_mirror` bullet, `~/.cuis-mcp-bridge/` note; root `README.md` if it states a count

## Testing and validation

All tests are hermetic: a fresh temp `home` per test, and an upstream made with
`git init --bare` plus one commit pushed from a scratch clone (test setup only). The wrapper
`git` is a `sh` script in the test dir. It appends its argv to a log and, for `clone`, waits
until a release file appears before `exec`-ing real git. That makes "clone still running"
deterministic.

| Inv | Verified by (`vmSource/mirror.test.ts` unless noted) |
|---|---|
| 1 | `vmSource/tools.test.ts`: `createVmSourceTools()` returns one tool named `setup_vm_mirror` with an empty-object schema. Its handler with `{}` returns `{"status": …}` text. `tools.test.ts`: `createTools(fake, { home: tmp, upstreamUrl, git })` lists the 13 forwarded tools plus `setup_vm_mirror`, and calling that handler returns `started` with the clone landing under `tmp`. |
| 2 | `mirrorState` goes `missing` → (setup, gate held) `initializing` → (release, await completion) `ready`. |
| 3 | With the gate held, `setupVmMirror` resolves `started` while the clone is blocked. Then `in_progress`. After completion `ready`, with no new argv line and the home listing unchanged (no network, no write). |
| 4 | `Promise.all` of 5 calls across two `MirrorOptions` objects sharing a home: exactly one `started`, four `in_progress`, one `clone` line in the log. A cross-process holder is simulated by a lock holding a live `sleep 30` child's pid and its real `ps` start time: `in_progress`, and no clone. |
| 5 | Lock with the pid of an already-exited child, plus a leftover `vm-mirror.tmp-<thatpid>/`: `started`, and the leftover is gone. Lock with `process.pid` but a different `startTime`: `started` (PID reuse). An empty lock file is treated as stale. Clone failure (an upstream path that doesn't exist): lock and tmp removed, and the next call is `started`. |
| 6 | Argv log over the whole suite: only `clone --bare` runs, never on a `ready` call. Review check: `vmSource/mirror.ts` is the only new module importing `child_process`, and it spawns only `git` and `ps`. |
| 7 | `tools.test.ts`: `createTools` with a fake client whose `sendRequest` records calls and rejects with `unreachable`. `setup_vm_mirror` still succeeds, and `sendRequest` is never called. |
| 8 | After a full setup, the files created in the test are exactly `home/vm-mirror/**` (snapshot of the temp root's listing before and after, excluding the upstream fixture). No path in `mirror.ts` is derived from input or `cwd`. |
| 9 | `git --git-dir=<home>/vm-mirror rev-parse --is-bare-repository` prints `true`, there's no `vm-mirror/.git`, and the argv log has no `checkout` / `worktree` / `update-ref` / `symbolic-ref`. |
| 10 | Run from a `cwd` holding an `opensmalltalk-vm/` sentinel dir: its listing and mtimes are unchanged, and no argv mentions it. |
| 11 | Two option sets with different (simulated project) `cwd`s but the default-style shared home: the second gets `ready` and reuses the first's mirror. |

**Live check** (after `npm test` and `npm run build`):
- Pipe `initialize` + `tools/list` JSON-RPC into `node dist/index.js`. This confirms the
  built server lists `setup_vm_mirror` with no Cuis image running.
- One real `setup_vm_mirror` call: `started` at once, then `in_progress`, and after about
  1.5 min `ready`, with `~/.cuis-mcp-bridge/vm-mirror` a bare repo whose `HEAD` is `Cog`.

## Risks and mitigations

- **Stale-lock takeover race.** Two takeovers interleaving with a third caller's fresh acquire
  can still start a second clone, as in the parent plan. Each clone uses its own
  `vm-mirror.tmp-<pid>`, and only one `rename` onto a missing `vm-mirror` succeeds. A loser
  whose rename fails `rm`s its tmp, so the mirror is never corrupted. The worst case is a
  wasted download.
- **Orphaned download after a hard kill.** The child isn't killed when the bridge dies from a
  signal. It keeps writing into the dead holder's tmp dir until the next setup deletes that
  dir, which makes git fail. It never becomes `vm-mirror`, because only the dead bridge would
  have renamed it.
- **No failure feedback in this part.** Until part 4 lands, a failed clone is silent: the
  next call just says `started` again. That's acceptable for an intermediate part, but part 4
  must ship before the feature is announced.
- **Readiness = directory exists.** A hand-damaged mirror reads `ready` here; part 4's
  `mirror_corrupt` covers it (part 4 inv 11).
