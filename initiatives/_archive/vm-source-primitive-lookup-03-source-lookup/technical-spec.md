# VM Source: Primitive Lookup — Part 3: Source Lookup — Technical Spec

Behavior is in `functional-spec.md` (invariants 1–20, cited as "inv N"). The design research
(pickaxe resolution, the `Cog`-only refspec, file derivation, measured latency) is in
`../vm-source-primitive-lookup/initiative.md` under "Decisions", and this plan doesn't repeat
it. It implements the `get_vm_source` slice of the parent plan
(`../vm-source-primitive-lookup/technical-spec.md`, "Slice B") on top of what part 2 built,
and it leaves part 4's work to part 4.

## Context

- **What part 2 left in place.** `mcp-bridge/server/src/vmSource/`:
  - `mirror.ts`: `MirrorOptions {home, upstreamUrl, git}` (`:25-29`), the private
    `mirrorPath(home)` (`:31`), and `mirrorState(opts)` (`:50-57`), which returns
    `ready | initializing | missing`, only reads, and is exported for this part.
    `vm-mirror/` exists only after a clone has been renamed into place (`finishClone`,
    `:234`), so `ready` already means "fully cloned" (inv 18).
  - `tools.ts`: `createVmSourceTools(opts)` (`:12-39`) fills the defaults and returns
    `[setup_vm_mirror]`. Its handler formats a thrown error as plain text with `isError`.
  - `testSupport/harness.ts`: a temp root, a local bare upstream on branch `Cog` with one
    README commit (`:45-51`), and a wrapper `git` that logs argv and can gate `clone`
    (`:53-77`). `argvLog()` and `waitFor()` are exported.
- **Wiring.** `src/tools.ts:152-175`: `createTools(client, vmSource?)` appends
  `createVmSourceTools(vmSource)` after the 13 forwarded tools. Forwarded failures are
  formatted as `"<code>: <message>"` when the error has a `code` (`:141-143`, `:163-167`).
  `index.ts` passes arguments to handlers without validating them.
- **Upstream shapes**, checked in the project's `opensmalltalk-vm/src` checkout. That
  checkout is used only for writing fixtures and is never read at runtime (part 2 inv 10).
  - `const char *interpreterVersion = "Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794]";`
    is at `spur64.cog/cointerp.c:2737`.
  - `primitiveTable` starts at `:2062`. Its rows look like `\t/* 117 */ primitiveExternalCall,`
    or `\t/* 256 */ (void (*)(void))256,`, and an empty slot is `(void (*)(void))0`.
  - Functions are laid out as `\t/* Class>>#sel */`, a return-type line, a column-0
    `name(args)` line, then a `{` line, ending at a column-0 `}`.
  - Export rows look like `{(void*)_m, "name\000…", (void*)fn}` and sit in
    `<Module>_exports` or `vm_exports` (`:84252`).
  - Plugins carry `static const char *moduleName = "SocketPlugin VMMaker.oscog-eem.3743 " INT_EXT;`.
    The FFI file's stamp starts with its own name: `"ARM64AppleFFIPlugin VMMaker…"`.
  - Plugins call the VM either through `(*name)(…)` pointers declared in the file or through
    `interpreterProxy->name(`.
  - `externalQuickPrimitiveResponse` has a `>= 264` (instance variable `N-264`) branch, the
    branches 256 self, 257 true, 258 false and 259 nil, and a fall-through for SmallInteger
    `N-261`.
  - `src/` holds `spur{32,64}.{cog,cog.lowcode,sista,stack,stack.lowcode}`, `v3.cog` and
    `v3.stack`. Each Cog directory has `cointerp.c` and `gcc3x-cointerp.c`.
    `plugins/SqueakFFIPrims/` contains `ARM64AppleFFIPlugin.c`, `ARM64FFIPlugin.c` and
    `X64SysVFFIPlugin.c`, among others.

### Scope split with part 4

Part 4 owns the error taxonomy (part 4 inv 3–13), the stamp-guided window walk with its
refresh fetch (part 4 inv 1), and failure recording for clones (part 4 inv 2). This part
raises coded errors only for the codes its own invariants name: `mirror_missing`,
`mirror_initializing` (inv 17), `mirror_busy` (inv 19) and `symbol_not_found` (inv 2). It
also uses `invalid_request` for argument type guards, since `index.ts` doesn't validate
arguments. Every other failure (no commit, missing file, empty slot, unmapped platform,
missing platform parameter, unparseable version, a failed fetch) throws a plain `Error`
whose message names the problem. It still reaches the caller as an `isError` result, and
part 4 swaps each of these throw sites for a code and checks them in its order.
**Tradeoff:** adding the codes now would save part 4 a few small edits, but this part's
tests would then fix behavior that part 4 has to specify and test, including its ordering.

## Proposed changes

### New modules in `mcp-bridge/server/src/vmSource/`

| File | Responsibility |
|---|---|
| `errors.ts` | `class VmSourceError extends Error { code }`, plus `type VmSourceErrorCode = 'invalid_request' \| 'mirror_missing' \| 'mirror_initializing' \| 'mirror_busy' \| 'symbol_not_found'`. Part 4 extends the union. |
| `git.ts` | `runGit(opts, args): Promise<string>` runs `execFile(opts.git, ['--git-dir=' + mirrorDir(opts), ...args])` with no shell, `env` + `LC_ALL=C` + `GIT_TERMINAL_PROMPT=0`, and `maxBuffer` 64 MB (`cointerp.c` is about 75k lines). On failure it rejects with an `Error` carrying `stderr`. `isLockContention(stderr)` tests `/Unable to create '.*\.lock'\|cannot lock ref/`. `mirror.ts` exports `mirrorPath` for this module. |
| `lookupPlan.ts` | Pure functions that turn arguments into a `LookupPlan` (below). |
| `cSource.ts` | Pure functions over a file's text: the function index, dispatch lookup, helpers, external calls and the stamp. |
| `resolveCommit.ts` | `resolveCommit(opts, token): Promise<string>`: the pickaxe search, plus a fetch shared within the process; lock contention gives `mirror_busy`. |
| `getVmSource.ts` | `getVmSource(opts, args): Promise<VmSourceResult>`: orchestration, the response and its caveats. |

`VmSourceOptions = MirrorOptions`. `createVmSourceTools` and `createTools` take
`Partial<VmSourceOptions>`. The calls in `index.ts` and the existing tests stay unchanged.

### `lookupPlan.ts` (inv 1–3, 8–10)

```ts
interface LookupPlan {
  token: string;                         // N in VMMaker.oscog-eem.N
  key: { kind: 'named'; name: string } | { kind: 'numbered'; index: number };
  path: string;                          // repo-relative, e.g. src/spur64.cog/cointerp.c
  module?: string;                       // the pragma's module, when given
  defaults: ('cog_variant' | 'plain_rendering')[];
  rendering?: 'plain' | 'gcc3x';         // module omitted only
}
```

- **Key** (inv 2): `typeof lookupKey === 'number'` means numbered, and any string means
  named, so `"1"` is the name `1`. Other types are rejected with `invalid_request`, and so
  are a non-string `vmVersion`, a non-string `module`, `platformName` or `platformSubtype`,
  and a non-object `moduleStamps`.
- **Token** is the match of `/VMMaker\.oscog-eem\.(\d+)\]/`. The trailing `]` keeps `.3738`
  from matching `.37380`, and `N` is digits only. **Family tag** is the match of
  `/^Open Smalltalk (.+?) VM \[/`. Both read the build suffix as the caller passed it (inv 2).
- **Path by case** (inv 3). Each case reads only the parameters it uses, so a parameter it
  doesn't use is ignored:
  - An ordinary plugin gives `src/plugins/<M>/<M>.c`. It's built only when
    `<M>` matches `^[A-Za-z0-9_]+$`, so caller text never reaches git as a path.
  - `SqueakFFIPrims` (inv 10) uses one constant table:
    `('Mac OS','aarch64') → ARM64AppleFFIPlugin.c`, `('Mac OS','x64') → X64SysVFFIPlugin.c`,
    `('unix','aarch64') → ARM64FFIPlugin.c` and `('unix','x64') → X64SysVFFIPlugin.c`, all
    under `src/plugins/SqueakFFIPrims/`. The `unix` rows rest on file names only, and a
    comment says so.
  - With `module` omitted (inv 8, 9), `Cog[Spur]` gives `spur64.cog` when `platformSubtype`
    is `x64`/`aarch64` and `spur32.cog` when it's `intel`/`powerpc`, and that adds
    `cog_variant` to `defaults`. `Cog[SqueakV3]` gives `v3.cog` with no default, because V3
    has no `lowcode` or `sista` sibling. The file is `cointerp.c` with `plain_rendering` and
    `rendering: 'plain'` when `platformName` is absent. It's `gcc3x-cointerp.c` with
    `rendering: 'gcc3x'` when `platformName` is `Mac OS` or `unix`.
  - Anything unmapped, or a missing required parameter, throws a plain `Error` that names
    the value (part 4 assigns the codes).

### `resolveCommit.ts` (inv 13–16, 19, 20)

1. Pickaxe:
   `log Cog --reverse --format=%H -S'VMMaker.oscog-eem.<N>]' -- 'src/*/cointerp.c' 'src/*/interp.c'`,
   taking the first line. The search goes by content, not by commit title (inv 13), and
   `Cog` only. The introducing commit is a fixed point of append-only history (inv 14). If it
   returns a SHA, no fetch runs (inv 15).
2. If the result is empty, fetch with `fetch --quiet origin +refs/heads/Cog:refs/heads/Cog`
   (inv 16). A bare clone records no fetch refspec, so the refspec must be named. Then
   search again. If it's still empty, throw a plain `Error` ("no commit on Cog carries
   VMMaker.oscog-eem.N").
3. **Shared in-process fetch** (inv 19). A module-level map from mirror directory to the
   in-flight fetch promise. A call that needs a fetch awaits the entry if there is one, and
   otherwise starts the fetch and stores it, removing the entry once it settles. Every waiter
   then runs its own pickaxe. A failed fetch rejects all of its waiters alike. Sharing only
   covers an overlapping fetch, so each call also records `rev-parse Cog` before its first
   pickaxe. On a miss it reads Cog again; if it has moved since (a fetch by this or another instance landed
   during the search), it re-runs the pickaxe instead of fetching, and returns if that
   finds the commit. Only a call that still misses goes on to fetch.
4. **No retry** (inv 19). A fetch whose stderr matches `isLockContention` means another
   process holds git's ref lock: throw `mirror_busy` at once, with no sleep and no second
   fetch. Any other fetch failure throws a plain `Error` carrying git's stderr. Reads take no
   lock (inv 20): they are content-addressed and immutable.

### `cSource.ts` (inv 6, 11, 12)

- **`indexFunctions(text)`** makes one line scan. A function is a column-0 line matching
  `^([A-Za-z_]\w*)\(` whose next line starts with `{`. It starts at the line above the
  return-type line when that line matches `^\t/\* (\S+>>#\S+) \*/$` (this capture gives
  `generatedFrom`), and at the return-type line otherwise. It ends at the next line that is
  exactly `}`. The result is `Map<name, {start, end, source, generatedFrom?}>`, with
  1-based lines.
- **`findExport(text, name)`** scans every row matching
  `^\s*\{\(void\*\)_m, "([^"\\]+)(?:\\\d{3})*", \(void\*\)(\w+)\}` anywhere in the file.
  That covers `<Module>_exports`, `ARM64AppleFFIPlugin_exports` and `vm_exports` without
  guessing array names. It returns `{fn, row}`, and no row means `symbol_not_found`.
- **`findTableSlot(text, n)`** parses the `/* n */ value,` rows inside the
  `primitiveTable[` initializer.
  - A plain identifier names the function, and slot 117 (`primitiveExternalCall`) is
    marked `shared: {reason: 'external_call', applies}`.
  - `(void (*)(void))K` with `256 ≤ K ≤ 519` resolves to `externalQuickPrimitiveResponse`
    with `shared: {reason: 'quick_primitive', applies}`. `applies` names the branch: 256
    self, 257 true, 258 false, 259 nil, 260–263 SmallInteger `N−261`, and ≥ 264 instance
    variable `N−264`.
  - No row at all means `symbol_not_found`. `(void (*)(void))0` throws a plain `Error`
    (part 4 adds `primitive_slot_empty`).
- **`helpers(fn, index)`** strips comments, string and char literals, and `#` lines from the
  body. It then collects identifiers followed by `(`, excluding the function itself, keeps
  those in the index, and returns them in first-appearance order, one level deep with no cap
  (inv 6).
- **`externalCalls(fn, index, text)`** returns the remaining called names, minus C keywords,
  ALL_CAPS names and names with a `#define name(` in the file. A name is `vm_interface` when
  it's called as `interpreterProxy->name(` or the file declares `(*name)(`. All the others
  are `platform_code_unavailable`.
- **`moduleStamp(text)`** reads `static const char \*moduleName = "([^"]*)"` and trims the
  result.

### `getVmSource.ts` (inv 4–12, 17, 18)

The steps run in order:

1. Type guards (`invalid_request`).
2. `mirrorState`. `missing` gives `mirror_missing`, whose message says to call
   `setup_vm_mirror` and retry. `initializing` gives `mirror_initializing`. A half-finished
   `vm-mirror.tmp-*` is never `ready` (inv 17, 18), and nothing here spawns a clone.
3. `planLookup`.
4. `resolveCommit`.
5. `runGit(['show', sha + ':' + plan.path])`, which reads the blob at the resolved commit
   only (inv 7).
6. The dispatch lookup, function, helpers and external calls.
7. The stamp check, run when `module` and `moduleStamps` are both given (inv 11). The plugin
   name is the first word of the file's stamp. The check looks for an entry in
   `builtin ∪ loaded` whose first word equals that name. With none, the result is
   `not_verifiable`. Otherwise the entry has its ` (i)`/` (e)` suffix stripped and is
   compared with the file's stamp, giving `match`, or `mismatch` carrying `{running, source}`.
   It checks the resolved commit only. Part 4 replaces that commit with the window walk.
8. Assemble the result.

```ts
interface VmSourceResult {
  function: string; generatedFrom: string | null;
  helpers: { name: string; source: string }[];
  externalCalls: { name: string; kind: 'vm_interface' | 'platform_code_unavailable' }[];
  metadata: {
    commit: string; path: string; lines: { start: number; end: number };
    dispatch: { kind: 'exports' | 'primitiveTable'; entry: string };
    shared?: { reason: 'quick_primitive' | 'external_call'; applies: string };
    defaults: ('cog_variant' | 'plain_rendering')[];
    rendering?: 'plain' | 'gcc3x';
    moduleStampCheck?: { result: 'match' | 'mismatch' | 'not_verifiable'; running?: string; source?: string };
  };
  caveats: string[];
}
```

`caveats` (inv 6) holds one sentence for each of `cog_variant`, `plain_rendering`, `shared`,
`mismatch` and `not_verifiable`, in that order, and is `[]` otherwise. When `platformName`
is given there is no rendering caveat, because nothing was defaulted. `metadata.rendering`
records which rendering was read.

### `vmSource/tools.ts`

This file adds the `get_vm_source` definition after `setup_vm_mirror`. Its `inputSchema`
declares the six properties, with `vmVersion` and `lookupKey` required and `lookupKey` typed
`["string","number"]`. The description:

- says to pass every input exactly as the Cuis-side tools returned it;
- gives the order of calls (inv 5) and the platform-parameter table (inv 3);
- explains that `mirror_missing` means calling `setup_vm_mirror`;
- tells the assistant to state every caveat and never to present a defaulted source as the
  exact compiled one (inv 6).

The handler returns `JSON.stringify(result)` as text. A `VmSourceError` is formatted as
`"<code>: <message>"` with `isError`, matching `src/tools.ts:163-167`. Any other error keeps
the existing plain-message path. The tool takes no client (inv 4, part 2 inv 7).

## Implementation sequence

1. `mcp-bridge/server/src/vmSource/errors.ts` — `VmSourceError`, part-3 code union
2. `mcp-bridge/server/src/vmSource/git.ts` — `runGit`, `isLockContention`; export `mirrorPath` from `mirror.ts` (+ `git.test.ts`)
3. `mcp-bridge/server/src/vmSource/testSupport/fixtures.ts` — synthetic `coreInterp(…)` / `plugin(…)` builders, every emitted line copied from upstream's generated shape; `testSupport/excerpts/` — verbatim upstream excerpts (below)
4. `mcp-bridge/server/src/vmSource/testSupport/harness.ts` — `pushUpstream(files, message)`, `cloneMirror(home?)` (real bare clone into `<home>/vm-mirror`, setup only), `freshHome()`
5. `mcp-bridge/server/src/vmSource/lookupPlan.ts` — key, token, family, path tables, defaults (+ `lookupPlan.test.ts`)
6. `mcp-bridge/server/src/vmSource/cSource.ts` — function index, exports / `primitiveTable` lookup, shared dispatchers, helpers, external calls, stamp (+ `cSource.test.ts`)
7. `mcp-bridge/server/src/vmSource/resolveCommit.ts` — pickaxe, refspec fetch shared in-process, `mirror_busy` on lock contention (+ `resolveCommit.test.ts`)
8. `mcp-bridge/server/src/vmSource/getVmSource.ts` — orchestration, stamp check, response, caveats (+ `getVmSource.test.ts`)
9. `mcp-bridge/server/src/vmSource/tools.ts` — `get_vm_source` definition, `VmSourceOptions` defaults; `src/tools.ts` parameter type (+ `tools.test.ts` in both places)
10. `mcp-bridge/README.md` and root `README.md` — 15 tools, `get_vm_source` bullet and call order

## Testing and validation

All tests are hermetic: nothing reads the project's `opensmalltalk-vm/` or the network.

- **Fixture files** come from the synthetic builders in `fixtures.ts`. Each test asks for
  exactly the shape it needs, such as a 25-helper function, slot 264, or a decoy FFI file.
  Every line the builders emit is copied from upstream's generated output, not paraphrased.
- **Drift check.** `testSupport/excerpts/` holds a few dozen lines pasted unchanged from
  upstream `spur64.cog/cointerp.c` (the `interpreterVersion` line, `primitiveTable` rows
  117 and 255–257, `primitiveAdd` with its comment, and `vm_exports` rows) and from
  `SocketPlugin.c` (`moduleName` and `SocketPlugin_exports` rows). Each excerpt file names
  its source path and commit. `cSource.test.ts` runs the parser on them, so a builder that
  drifts from real output shows up as a disagreement in `npm test`.
- **Git history is built once per test file.** In `beforeAll`, each test file creates one
  harness and pushes its scripted upstream history with `pushUpstream`. This covers a token
  introduced, kept and replaced, a title naming a different revision from its content, and
  `.37380` beside `.3738`. Then `cloneMirror()` makes the shared ready mirror. Read-only
  tests share that harness, and the per-call argv log is sliced from a mark taken at the
  start of each test.
- **Tests that change state get their own setup.** A test that pushes after cloning, plants
  a lock file, or needs the mirror missing or initializing uses `freshHome()` (a new home,
  with `cloneMirror(home)` when it needs a mirror). If it pushes upstream, it creates its own
  harness instead. Shared state therefore never changes during a test file.
- The wrapper `git`'s argv log shows which git commands ran. Pure modules are tested on fixture text with no git at all.

| Inv | Verified by |
|---|---|
| 1 | `vmSource/tools.test.ts`: `get_vm_source` is listed with the six properties and no `path`-like input. A fixture lookup returns parseable JSON whose `metadata.path` was chosen by the tool. |
| 2 | `lookupPlan.test.ts`: `1` gives numbered, while `"1"` gives named, and on a fixture `"1"` ends in `symbol_not_found`. A `vmVersion` with the build suffix (`… 7.20260327.1636`) parses. Stamps are compared with their `(i)`/`(e)` suffix stripped. Wrong types give `invalid_request`. |
| 3 | Table-driven `lookupPlan.test.ts`: an ordinary plugin succeeds with junk `platformName`/`platformSubtype`, and with none at all. `SqueakFFIPrims` and module-omitted cases fail (plain error) without their required parameters. Module omitted without `platformName` succeeds. |
| 4, 5 | `src/tools.test.ts`: through `createTools(fake, harnessOpts)`, `get_vm_source` succeeds as the first and only call. The fake `sendRequest` rejects with `unreachable`, is never invoked, and `session_busy` never appears. A review check confirms that no vmSource module imports `CuisClient` or calls another tool. |
| 6 | `getVmSource.test.ts`: a fixture lookup asserts every field. `function` includes the `/* Class>>#sel */` line, `generatedFrom` matches it, and `helpers` lists all in-file callees in order, including a fixture with more than 20 helpers (no cap). `externalCalls` marks `interpreterProxy->x(` / `(*x)(` as `vm_interface` and the others as `platform_code_unavailable`. `lines`, `dispatch`, `commit` and `defaults` are set, and `caveats` has one sentence per default or warning and is `[]` for an exact plugin lookup. The tool description is asserted to contain the instruction about stating caveats. |
| 7 | The returned text is far shorter than the fixture file. A later upstream commit that changes the file leaves the answer for the earlier token unchanged. When run from a `cwd` holding an `opensmalltalk-vm/` sentinel with different content, the sentinel's content never appears. The argv log shows only `show <sha>:<path>` reads. |
| 8 | `Cog[Spur]` sets `cog_variant` and a caveat, and the path is `spur64.cog/…`. `Cog[SqueakV3]` gives `v3.cog/…` with no default. |
| 9 | Without `platformName`: `cointerp.c`, `plain_rendering`, `rendering: 'plain'` and a caveat. With `Mac OS`/`unix`: `gcc3x-cointerp.c`, `rendering: 'gcc3x'` and no rendering caveat. The fixture's two files differ, which proves which one was read. |
| 10 | `Mac OS` + `aarch64` returns the function from `ARM64AppleFFIPlugin.c`, even with a decoy `SqueakFFIPrims.c` and `ARM64FFIPlugin.c` beside it, and `metadata.path` names that file. The other three table rows are each checked. |
| 11 | Stamps equal to the file's give `match`. A different stamp gives `mismatch` with `running` and `source`, still in a successful response with a caveat. A plugin absent from both arrays gives `not_verifiable`. Without `moduleStamps`, or with `module` omitted, the field is absent. |
| 12 | Slots 256, 257, 258, 259, 261 and 264 each return `externalQuickPrimitiveResponse` with `shared.reason: 'quick_primitive'` and the right `applies`. Slot 117 returns `primitiveExternalCall` with `external_call`. Both add a caveat. |
| 13 | The upstream commit titled "… VMMaker.oscog-eem.3739" carries interpreter content `.3738`, and token `.3738` resolves to it. A `.37380` commit doesn't match `.3738`. With the token introduced, kept and then replaced, resolution picks the introducing commit. |
| 14 | The same inputs twice give byte-identical JSON, and so do the same inputs before and after an unrelated upstream push and fetch. |
| 15 | Token already in the mirror: the argv log has no `fetch`. A second harness service sharing the home resolves the same token with no `fetch` either. |
| 16 | Token pushed upstream after `cloneMirror()`: exactly one `fetch … +refs/heads/Cog:refs/heads/Cog`, then success. A token that is nowhere throws a plain error after one fetch. |
| 17, 18 | Empty home gives `mirror_missing`, with the message naming `setup_vm_mirror`, and no `clone` in argv. A gated `setupVmMirror` (with `vm-mirror.tmp-<pid>` present and the lock live) gives `mirror_initializing`. After release and completion, the same call succeeds. |
| 19 | Creating `vm-mirror/refs/heads/Cog.lock` makes the real fetch fail with git's lock error, and the call rejects with `mirror_busy` after exactly one `log` and one `fetch`. Concurrent calls in one process that all need a fetch resolve the same SHA, with exactly one `fetch` in the argv log. A call whose pickaxe misses while another fetch moves Cog resolves without fetching (argv `rev-parse`, `log`, `rev-parse`, `log`). |
| 20 | `Promise.all` of eight mixed calls (same and different keys, two services on one home) equals their sequential results. Four concurrent calls whose token is only upstream all succeed. `git fsck` on the mirror is clean afterwards. |

**Must not regress.** The existing `mirror.test.ts` and `tools.test.ts` suites stay green.
The argv log across the new suites contains only `clone`, `fetch`, `log`, `show` and
`rev-parse`, never `checkout`, `worktree`, `reset`, `update-ref` or `symbolic-ref` (part 2
inv 6, 9). Every call carries `--git-dir=<home>/vm-mirror` (part 2 inv 8, 10, 11). The
forwarded Cuis-side tools are unchanged (part 1 inv 8).

**Live check** (after `npm test` and `npm run build`), against the real mirror, through the
`run-cuis-mcp-bridge` driver:
- `SmallInteger>>+` (`<primitive: 1>`, `Mac OS`/`aarch64`) gives `primitiveAdd` from
  `spur64.cog/gcc3x-cointerp.c` at `759d8f204`, with `cog_variant` in `caveats`.
- `primitiveSocketReceiveDataAvailable` (`SocketPlugin`, with live `moduleStamps`) gives
  `moduleStampCheck: match`.
- `primitiveCalloutWithArgs` (`SqueakFFIPrims`) comes from `ARM64AppleFFIPlugin.c`.

## Risks and mitigations

- **Latency.** The pickaxe takes about 5–7 s per call, about 14 s with a miss and a fetch,
  and a call waiting on a shared fetch takes as long as that fetch. The MCP client timeout is
  unknown. A token → SHA cache is safe to add, since a token resolved on `Cog` always maps
  to the same commit; it's listed under follow-ups.
- **Parser assumptions** (the column-0 `}`, the comment above the return type, the shape of
  export rows) were checked on current upstream only. A change in VMMaker's output would show
  up as `symbol_not_found` or a truncated function. The verbatim excerpts catch
  builder drift in `npm test`. Only the live check catches upstream changing its output
  after the excerpts were taken, so refresh the excerpts when it fails.
- **External-call classification is heuristic.** A libc call (`memcpy`, `strlen`) would show
  as `platform_code_unavailable`. If fixtures or the live check show this, add an explicit
  ignore list rather than loosening the rule.
- **Lock-error detection by stderr text.** `LC_ALL=C` pins git's language, and anything
  unrecognized is a plain failure rather than `mirror_busy`. A stale `Cog.lock` left by a
  killed git also reads as `mirror_busy`; telling it apart is a follow-up.

## Follow-ups

- Token → SHA cache.
- Part 4: codes for every plain-`Error` throw site above, the check order, the window walk
  and its refresh, and failure recording for clones.
