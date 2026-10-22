# VM Source: Primitive Lookup — Part 4: Failure Handling — Technical Spec

Behavior is in `functional-spec.md` (invariants 1–15, cited as "inv N"). Part 3's invariants
are cited as "p3 inv N", part 2's as "p2 inv N".

This part finishes the work part 3 deferred
(`../_archive/vm-source-primitive-lookup-03-source-lookup/technical-spec.md`, "Scope split
with part 4"):
- a code for every plain-`Error` throw site, and the order the codes are checked in;
- the stamp-guided window walk, with a refresh fetch for open windows only;
- failure recording for clones.

It also covers two invariants added by amendment:
- version tokens with any author's initials (inv 14);
- `internal_error` for git runs that never complete (inv 15).

It follows the sketch in the parent plan (`../vm-source-primitive-lookup/technical-spec.md:80-139`)
except for its fetch retry loop, which part 3 replaced with a fail-fast `mirror_busy` (p3 inv 19).

## Context

All paths are under `mcp-bridge/server/src/vmSource/`.

- **Codes today** (`errors.ts:2-7`). The union holds only the part-3 codes: `invalid_request`,
  `mirror_missing`, `mirror_initializing`, `mirror_busy` and `symbol_not_found`.
  `tools.ts:15-23` formats a `VmSourceError` as `"<code>: <message>"` and anything else as a
  bare message. Part 3's uncoded failures reach the caller through that bare path.
- **Plain-`Error` throw sites** that this part converts:
  - `lookupPlan.ts:45` (unknown family), `:50` (missing subtype), `:61` (unmapped subtype),
    `:125` (no token), `:136` (unknown `platformName`), `:145`/`:148` (FFI parameter missing),
    `:153` (unmapped FFI platform), `:160` (module name fails `^[A-Za-z0-9_]+$`);
  - `cSource.ts:115` (empty slot);
  - `resolveCommit.ts:41` (no commit after a fetch) and `:52` (non-lock fetch failure,
    rethrown as is);
  - `git.ts:27-31`, which rejects every failure the same way (stderr, or `err.message` when
    stderr is empty). A git exit status, a spawn errno (`ENOENT`, `EMFILE`, …), a signal kill
    and `maxBuffer` overflow (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`) all look identical
    afterwards. Inv 11, 12 and 15 need them told apart.
- **The version token is digits only.**
  - `lookupPlan.ts:123-127` matches `/VMMaker\.oscog-eem\.(\d+)\]/` and keeps only `N` in
    `LookupPlan.token`.
  - `resolveCommit.ts:67` rebuilds the pattern as `'-SVMMaker.oscog-eem.' + token + ']'`, and
    `:41` uses the same prefix in its message.
  - The fixture builder hardcodes `eem` (`testSupport/fixtures.ts:80, 83, 106`).
  - Tests pin the digits-only form: `lookupPlan.test.ts` (`token: '3794'` at
    `:20, 59, 105, 127, 149, 180`) and `resolveCommit.test.ts` (`resolveCommit(opts, '3738')`,
    and the argv `'-SVMMaker.oscog-eem.3738]'` at `:50`).
  - The mirror's `Cog` history has 35 tokens with other initials (`nice`, `mt`, `dtl`, `cb`,
    `mad`, `rmacnak`, `rsf`, `lw`); the latest is `mad.3753`, from 2026-04-22.
  - One number collides: `VMMaker.oscog-mt.3568` (`b6c45de66`, `bba9db4c3`) and
    `VMMaker.oscog-eem.3568` (`b0d6a5878`).
- **Check order today** (`getVmSource.ts:111-116`): `checkArgTypes` → `requireReadyMirror` →
  `planLookup` → `resolveCommit` → `git show`. Type guards run *before* the mirror check, and
  `getVmSource.test.ts:409-413` pins that order. Inv 3.1 reverses it.
- **`planLookup`** (`lookupPlan.ts:114-163`) interleaves parsing, required-parameter checks and
  mapping:
  - `interpreterDir` (`:39-64`) checks the family before it checks that `platformSubtype` is
    present, the reverse of inv 3.2's order.
  - For `Cog[SqueakV3]` it never checks the subtype mapping, though inv 10 requires a bit
    width whenever `module` is omitted.
  - `checkArgTypes` (`:72-99`) lets `moduleStamps.builtin` and `.loaded` be absent, but
    inv 3.2 requires both.
- **`resolveCommit`** (`resolveCommit.ts:24-42`):
  - It returns only the first pickaxe line (`:72`) and drops the rest of the hit list, which
    the window walk needs.
  - Its first git call is `rev-parse Cog` (`:25`). Tests pin that exact argv
    (`resolveCommit.test.ts:43, 89, 91`, `getVmSource.test.ts:466`).
  - The shared in-process fetch (`:32-38`) is inline, so nothing else can reuse it.
- **Clone failures** (`mirror.ts:202-232`):
  - The child runs with `stdio: 'ignore'`, so its stderr is lost.
  - `abandonClone` removes the tmp dir and releases the lock, so the next `setupVmMirror`
    starts a new clone straight away. `mirror.test.ts:310-326` pins this; inv 2 replaces it.
  - `setupVmMirror` (`:177-194`) never checks for git before spawning, and an fs failure (an
    unwritable home) escapes as a raw errno error.
- **Harness** (`testSupport/harness.ts:65-93`). The wrapper `git` logs argv and can gate
  `clone`, but it cannot make a git command fail.
- **Stamp check** (`getVmSource.ts:61-87`). It compares stamps at the introducing commit only.
  The window walk changes which commit gets checked.

## Proposed changes

### `errors.ts`: full taxonomy and transfer-failure classification

- Extend `VmSourceErrorCode` with `version_unparseable`, `missing_platform_info`,
  `unsupported_platform`, `git_unavailable`, `fetch_failed`, `mirror_write_failed`,
  `commit_not_found`, `mirror_corrupt`, `module_not_found`, `path_not_found`,
  `primitive_slot_empty` and `internal_error`.
- `isNetworkFailure(stderr)` checks one pattern table (`LC_ALL=C`): `Could not resolve
  host`, `Failed to connect`, `Connection refused`, `timed out`, `Network is unreachable`,
  `unable to access '`, `Could not read from remote repository`, `does not appear to be a
  git repository`, `repository '.*' (does not exist|not found)`, `remote end hung up` and
  `early EOF`.
- `transferError(stderr): VmSourceError` returns `fetch_failed` when `isNetworkFailure`
  matches, and `mirror_write_failed` otherwise. Either message includes git's trimmed stderr
  (inv 2, 5, 13).
- `gitUnavailable(detail)` builds `git_unavailable` with the message "git is required for the
  VM source tools but could not be run (<detail>)" (inv 12).

These helpers live here rather than in `git.ts` because `mirror.ts` needs them too, and
`git.ts` already imports `mirrorPath` from `mirror.ts`, which would make a cycle.

**Tradeoff:** unrecognized stderr counts as `mirror_write_failed`, never as `fetch_failed`.
Inv 5 forbids labelling a local fault as a network one, so in doubt the code points at the
local side. The cost is that an unfamiliar network message gets the wrong code until its
pattern is added to the table.

### `git.ts`: who reported the failure (inv 11, 12, 15)

`runGit` sorts every failure by how `execFile` reports it. The first matching rule wins:

1. `err.code` is `ENOENT` or `EACCES` (git is missing or not executable): throw
   `gitUnavailable(err.message)`. The message still contains `ENOENT`, so `git.test.ts:62-77`
   keeps passing.
2. `err.code` is a number (git ran and exited non-zero): reject as today with
   `{stderr, exitCode}` added. This is **git-reported**.
3. Anything else, meaning a spawn errno such as `EMFILE`/`EAGAIN`/`ENOMEM`, a signal
   (`err.signal`), or `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`: throw `internal_error`, with the
   code or signal and `err.message` in the message (inv 15). Git never got to report
   anything.

`readGit(opts, args)` wraps `runGit` for every read (`rev-parse`, `log`, `ls-tree`,
`rev-list`, `show`, `grep`):

- It passes `VmSourceError`s through untouched.
- It turns a git-reported failure into `mirror_corrupt`, with the message "the VM source
  mirror at <mirrorPath> can't be read as a git repository (<git text>); delete it and call
  setup_vm_mirror again" (inv 11).
- Nothing deletes or repairs the mirror.

**Tradeoff:** the split goes by kind of failure (exit status or not), not by matching
corruption messages in stderr. Any git-reported read failure counts as `mirror_corrupt`. That
is what inv 11 and 15 define, and it can't miss a corruption message git happens to word
differently. The cost is that a git-reported failure that isn't corruption also says
"delete it" (see Risks).

### `lookupPlan.ts`: full version token and ordered input checks (inv 3.2, 9, 10, 14)

- **Token (inv 14).**
  - Match `/VMMaker\.oscog-([A-Za-z]+)\.(\d+)\]/`.
  - `LookupPlan.token` becomes the whole name without the bracket, e.g.
    `VMMaker.oscog-mt.3568`, so the initials and the number always travel together.
  - The trailing `]` still stops `.3738` from matching `.37380`.
  - `[A-Za-z]+` and `\d+` keep shell or pathspec metacharacters out of the git argument.

  **Tradeoff:** an `initials` field beside a digits-only `token` would work too. But every
  git call site would then have to rebuild the name, and a site that forgot the initials
  would silently resolve `3568` to the wrong author. A single string removes that failure
  mode. The cost is updating the digits-only expectations in `lookupPlan.test.ts` and
  `resolveCommit.test.ts`.
- **Checks.** `planLookup` becomes four passes, and each pass throws the first fault it finds:
  1. **`invalid_request`**: the existing `checkArgTypes`, plus two checks:
     - `module` is given while `typeof lookupKey === 'number'`; the message says a numbered
       primitive can't have a module;
     - `moduleStamps` is given without *both* `builtin` and `loaded` being string arrays.
  2. **`version_unparseable`**: the token regex above doesn't match.
  3. **`missing_platform_info`**: the case is decided by `module` (p3 inv 3).
     `SqueakFFIPrims` requires `platformName` and `platformSubtype`. With `module` omitted,
     `platformSubtype` is required. The message names every missing parameter.
  4. **`unsupported_platform`**, checked in this order, with the message naming the value:
     1. `platformName === 'Win32'`, whenever it's supplied, in every case.
     2. Then only for a value the case uses:
        - `platformName` other than `Mac OS`/`unix`;
        - `platformSubtype` with no width (module omitted, V3 as well as Spur) or no
          `FFI_PLUGIN_FILES` row (FFI);
        - with module omitted, a family tag other than `Cog[Spur]`/`Cog[SqueakV3]`. This
          covers every Stack VM, and names the whole `vmVersion` when there's no tag. With
          `module` given, the family isn't read (inv 9).
- **Module name.** The `^[A-Za-z0-9_]+$` throw (`:159-161`) is dropped. The path is still
  built here, but `getVmSource` uses it only after the module has been confirmed against
  `ls-tree` output (see below), so caller text never reaches git as a path. A malformed name
  ends in `module_not_found`.

### `cSource.ts` (inv 8)

`:115` throws `primitive_slot_empty`, with the message "primitiveTable slot N holds no
function; the method always runs its Smalltalk fallback code". A missing row stays
`symbol_not_found` (`:117`).

### `mirror.ts`: failure recording, git probe, write failures (inv 2, 11, 12)

- **The error file.** `vm-mirror.error`, under `home`, holds the JSON `{code, message}` of the
  last failed background clone. It's written to a unique temp name and renamed into place,
  following the lock pattern at `:96-109`. Add it to the layout comment at `:4-11`.
- **Recording a failed clone.**
  - `startClone` spawns with `stdio: ['ignore', 'ignore', 'pipe']` and keeps the last 64 KB
    of stderr.
  - On a non-zero exit, `abandonClone` writes the error file (`transferError(stderr)`)
    **before** it removes tmp and releases the lock. So while the lock is live the state is
    `initializing`, and once it's released readers see the error file.
  - A spawn `error` event records `mirror_write_failed` with `err.message`, because inv 2
    names only two codes. Inv 15 covers `get_vm_source` only.
  - A clone killed together with its process (p2 inv 5) writes nothing, so the stale-lock
    takeover is unchanged.
- **`setupVmMirror` order:**
  1. `ready` → `ready`. A corrupt mirror is still `ready` (inv 11).
  2. `initializing` → `in_progress`.
  3. **Consume the error file.** Rename it to `vm-mirror.error.<pid>.<uuid>`, read it, unlink
     it, and throw `VmSourceError(code, message)`.
     - If the rename fails with `ENOENT`, there's nothing to report, so continue.
     - Of two concurrent calls, one wins the rename and reports; the other goes on to start a
       clone (inv 2: "the call after that").
  4. `mkdir`, acquire the lock, re-check `ready`.
  5. **Probe git** with `execFile(opts.git, ['--version'])`. On `ENOENT`/`EACCES`, release the
     lock and throw `gitUnavailable` instead of returning `started` (inv 12).
  6. Remove tmp dirs, `startClone`, return `started`.
- **Fs failures in `setupVmMirror` itself.** An `EACCES`/`ENOSPC`/`EROFS` from `mkdir` or a
  lock write is rethrown as `mirror_write_failed` with the errno message. This is a gap-fill:
  nothing was started, so the same call reports it. The "next call reports" rule applies only
  to background clones.
- **`mirrorState`** is unchanged. An error file with no live lock reads as `missing`, so
  `get_vm_source` keeps answering `mirror_missing` until a clone succeeds (inv 2).

### `resolveCommit.ts`: codes, hit list, stamp window (inv 1, 4, 5, 11–15)

- **Reads.** Every read goes through `readGit`, so the first `rev-parse Cog` fails before any
  pickaxe runs. It fails with `git_unavailable`, `mirror_corrupt` (git-reported) or
  `internal_error`. Its argv is unchanged.
- **Pickaxe.** It uses the full token, `'-S' + token + ']'` (inv 14). `-S` matches
  literally, so no escaping is needed.
- **Return value.** `resolveCommit(opts, token): Promise<{ commit: string; hits: string[] }>`
  returns every pickaxe SHA, oldest first, with `commit = hits[0]`.

  **Tradeoff:** the return type changes, so `resolveCommit.test.ts` switches to `.commit`.
  The alternative, a second pickaxe inside the walk, would add 5–7 s to every stamp lookup.
- **No commit.** `:41` throws `commit_not_found`, naming the full token (inv 4).
- **Fetch.** It's extracted as `fetchShared(opts)`, built from the existing map at
  `:10-11, :32-38`. `fetchCog` passes a `VmSourceError` from `runGit` (`git_unavailable`,
  `internal_error`) through unchanged. It classifies a git-reported failure as `mirror_busy`
  on lock contention, and otherwise with `transferError(stderr)` (inv 5, 13).
- **New: `stampWindowCommit`** (inv 1), with the signature
  `stampWindowCommit(opts, token, hits, path, running): Promise<string | undefined>`.
  `running` is the live stamp with ` (i)`/` (e)` stripped.
  1. **Window end.** The window ends at the first `h` in `hits[1..]` where
     `grep -q -F '<token>]' h -- 'src/*/cointerp.c' 'src/*/interp.c'` finds nothing; that
     commit replaces the token.
     - Exit 1 with empty stderr means no match. Anything else follows the `readGit` rules.
     - Checking content, rather than just taking `hits[1]`, handles a hit that only adds the
       token to a second interpreter file.
     - If no commit replaces the token, the window is **open** and runs to `Cog`. Otherwise
       it's **closed**.
  2. **Candidates.** `hits[0]`, then `rev-list --reverse --first-parent hits[0]..<end> --
     <path>`, where `<end>` is `<replacing>^` (closed) or `Cog` (open). Only commits that
     touch the plugin file can change its stamp, so the oldest match is always among them.
  3. **Match.** For each candidate in order, read `show <sha>:<path>` and return the first
     whose `moduleStamp` equals `running`. A missing file counts as no match.
  4. **No match.**
     - Closed window: return `undefined` at once, with no fetch.
     - Open window:
       1. note the `Cog` tip, then call `fetchShared` **once**; a failure is `fetch_failed`
          (inv 13);
       2. look for the replacing commit among the new commits only, with
          `log <oldTip>..Cog --reverse --format=%H -S'<token>]' -- <interpreter paths>`
          and step 1's `grep` rule;
       3. walk the `<oldTip>..<end>` candidates that touch `<path>`, and return a match or
          `undefined`.

     **Tradeoff:** re-running the full pickaxe after the fetch would be simpler. But
     `hits[0]` can't change in append-only history, and the range-limited search avoids a
     second 5–7 s scan.

### `getVmSource.ts`: check order (inv 3) and wiring

1. `requireReadyMirror`, moved ahead of everything else (inv 3.1).
2. `planLookup`, running the input checks in order.
3. `resolveCommit`, which can fail with `git_unavailable`, `mirror_corrupt`,
   `internal_error`, `fetch_failed`, `mirror_write_failed`, `mirror_busy` or
   `commit_not_found`.
4. With `module`: `readGit(['ls-tree', '--name-only', commit, 'src/plugins/'])` must list
   `src/plugins/<module>`, or the call fails with `module_not_found`. This runs before any
   `show`.
5. `show commit:path`, through `runGit` directly:
   - stderr matching `does not exist in|exists on disk, but not in` gives `path_not_found`,
     naming the path (inv 6);
   - any other git-reported failure gives `mirror_corrupt`;
   - a `VmSourceError` passes through.
6. **Stamp-guided pick**, when `module` and `moduleStamps` are both given:
   - The plugin name is the first word of the introducing commit's stamp.
   - If there's no stamp, or no live entry has that name, the result is `not_verifiable` at
     the introducing commit, with no fetch.
   - If the introducing commit's stamp equals the live one, it's used without a walk.
   - Otherwise `stampWindowCommit` runs. A SHA it returns replaces `commit` and `text`;
     `undefined` keeps the introducing commit.
   - The existing `stampCheck` then runs on the final `text`, giving `match`, or `mismatch`
     with both stamps, as before. `metadata.commit` is the final commit.
7. Dispatch, function, helpers and calls, as before (`symbol_not_found`,
   `primitive_slot_empty`).

`module_not_found` is checked at the introducing commit, before the walk reads any file.
Every commit the walk can pick touches the plugin file, so the plugin also exists at the
final commit.

### `tools.ts` descriptions

These are additions; the existing text stays.

- **`setup_vm_mirror`:** a failed background clone is reported by the next call
  (`fetch_failed` or `mirror_write_failed`), and the call after that retries. It needs `git`
  (`git_unavailable`).
- **`get_vm_source`:**
  - `mirror_corrupt` means tell the user to delete the mirror and run `setup_vm_mirror`;
  - `fetch_failed` means upstream couldn't be reached;
  - `internal_error` means an unexpected host-side failure that may be transient. The mirror
    must not be deleted because of it.

## Implementation sequence

1. `mcp-bridge/server/src/vmSource/errors.ts` — full code union (incl. `internal_error`), `isNetworkFailure`, `transferError`, `gitUnavailable` (+ new `errors.test.ts`)
2. `mcp-bridge/server/src/vmSource/git.ts` — three-way failure split in `runGit` (`git_unavailable` / git-reported with `exitCode` / `internal_error`), `readGit` → `mirror_corrupt` (+ `git.test.ts`)
3. `mcp-bridge/server/src/vmSource/testSupport/fixtures.ts` — `author?` option (default `eem`) on the core-interpreter builder, used in the banner and `interpreterVersion` lines (+ `fixtures.test.ts`)
4. `mcp-bridge/server/src/vmSource/testSupport/harness.ts` — `failGit(subcommand, failure)` / `clearGitFailures()`, where `failure` is `{stderr}` (print it, exit 128), `{signal: 'KILL'}` (the wrapper kills itself) or `{flood: true}` (write 65 MB to stdout, exit 0); the subcommand is the first non-option argv entry; argv and `done.log` are still logged (+ `harness.test.ts`)
5. `mcp-bridge/server/src/vmSource/lookupPlan.ts` — full-name token, four ordered check passes, both stamp arrays required, module+number guard, V3 width check, regex throw dropped (+ `lookupPlan.test.ts`)
6. `mcp-bridge/server/src/vmSource/cSource.ts` — `primitive_slot_empty` (+ `cSource.test.ts`)
7. `mcp-bridge/server/src/vmSource/mirror.ts` — clone stderr capture, `vm-mirror.error` record/consume, git probe, fs failures → `mirror_write_failed` (+ `mirror.test.ts`, replacing the `:310` test)
8. `mcp-bridge/server/src/vmSource/resolveCommit.ts` — `readGit`, full-token pickaxe, `{commit, hits}`, `commit_not_found`, `fetchShared` + `transferError` with `VmSourceError` pass-through, `stampWindowCommit` with open-window-only refresh (+ `resolveCommit.test.ts`)
9. `mcp-bridge/server/src/vmSource/getVmSource.ts` — mirror check first, `module_not_found`, `path_not_found`, stamp-guided pick (+ `getVmSource.test.ts`, flipping the `:409-413` order assertion)
10. `mcp-bridge/server/src/vmSource/tools.ts` — description additions (+ `vmSource/tools.test.ts`; the `sparc` case in `src/tools.test.ts` now expects `unsupported_platform: `)
11. `mcp-bridge/README.md` — host-side codes in Troubleshooting (incl. `internal_error`), `vm-mirror.error` in the writes list; root `README.md` only if it lists codes

## Testing and validation

The tests stay hermetic, as in part 3: a local bare upstream and the wrapper `git`. Real git
failures are used wherever they can be produced locally:
- an unreachable upstream, by renaming `upstream.git` away, or `http://127.0.0.1:1/x.git` for
  clones;
- an unwritable mirror, with `chmod`, skipped when `process.getuid?.() === 0`;
- a missing git, with `opts.git` pointing at a nonexistent path.

`failGit` injects the rest: stderr that can't be produced locally (DNS failure, timeout, disk
full), a killed git, and oversized output.

| Inv | Verified by |
|---|---|
| 1 | `resolveCommit.test.ts` / `getVmSource.test.ts`.<br>**Closed window**, with history c1 (`eem.3794`, stamp S1), c2 (stamp S2), c3 (unrelated) and c4 (`eem.3795`, stamp S3):<br>• no stamps → c1;<br>• S1 → c1, `match`;<br>• S2 → c2, `match`, no `fetch` in argv;<br>• S3 → c1, `mismatch {running: S3, source: S1}`, with **no** `fetch` in argv;<br>• plugin absent from the stamps → c1, `not_verifiable`, no `fetch`.<br>**Open window**, the same history without c4:<br>• S3 → exactly one `fetch`, then c1, `mismatch`;<br>• S4 pushed upstream after `cloneMirror()` → one fetch, then the new commit, `match`;<br>• the argv after the fetch shows a pickaxe limited to `<oldTip>..Cog`.<br>A hit that only adds the token to `spur32.cog/cointerp.c` doesn't close the window. No case is an error. |
| 2 | `mirror.test.ts`:<br>• a clone of a nonexistent upstream gives `fetch_failed`, with git's text, on the next `setupVmMirror`, and no new clone in argv; the call after that gives `started`;<br>• `failGit('clone', {stderr: 'fatal: … No space left on device'})` gives `mirror_write_failed` carrying that text;<br>• between the failure and the retry, `mirrorState` is `missing` and `getVmSource` gives `mirror_missing`;<br>• two concurrent calls after a failure give one error and one `started`;<br>• an unwritable home gives `mirror_write_failed` straight away. |
| 3 | `getVmSource.test.ts`, table-driven. Each row has two faults and asserts the earlier code:<br>• missing mirror + `lookupKey: true` → `mirror_missing`;<br>• module + number + bad version → `invalid_request`;<br>• bad version + missing subtype → `version_unparseable`;<br>• missing subtype + `Win32` → `missing_platform_info`;<br>• partial `moduleStamps` → `invalid_request`.<br>Input faults with a nonexistent `opts.git` give the input code and an empty argv. A bad module name gives `module_not_found` with no `show` in argv. `lookupPlan.test.ts` covers each pass in isolation. |
| 4 | A token pushed nowhere gives `commit_not_found`, naming the full token, after exactly one successful `fetch`. |
| 5, 13 | `errors.test.ts`: each pattern-table entry (DNS, refused, timeout, unreachable, 404, hung up) gives `fetch_failed`; `insufficient permission`, `No space left`, `Read-only file system` and unknown text give `mirror_write_failed`.<br>Through `getVmSource`:<br>• a renamed upstream gives `fetch_failed` with git's text, never `commit_not_found`;<br>• `failGit('fetch', {stderr: 'Could not resolve host: github.com'})` gives `fetch_failed`;<br>• `chmod -w` on `vm-mirror/objects` gives `mirror_write_failed`.<br>Refresh: the open-window S3 case with upstream renamed gives `fetch_failed`, even though c1 is readable. The closed-window S3 case with upstream renamed succeeds with `mismatch` and makes no network call. |
| 6 | A commit with only `spur64.cog/cointerp.c`, looked up with `platformName: 'Mac OS'` (which needs `gcc3x-cointerp.c`), gives `path_not_found` naming that path. A plugin dir without `<M>.c` also gives `path_not_found`. |
| 7 | An unknown exports name and slot 9999 give `symbol_not_found`, never `module_not_found` or `path_not_found`. A string `"1"` still gives `symbol_not_found`. |
| 8 | `cSource.test.ts`: a `(void (*)(void))0` row gives `primitive_slot_empty` with the slot number in the message, never `symbol_not_found`. |
| 9 | A `Stack[Spur]` `vmVersion` with `module: 'SocketPlugin'` succeeds. Without a module it gives `unsupported_platform` naming the family. |
| 10 | `Win32` gives `unsupported_platform: … Win32` with an ordinary plugin, with FFI and with no module. These each name their value: an unknown `platformName` with module omitted, an unmapped subtype (Spur and V3), FFI `unix/intel` and a `Cog[Foo]` family. Junk `platformName`/`platformSubtype` on an ordinary plugin still succeed. |
| 11 | An empty `vm-mirror/`, and a `refs/heads/Cog` pointing at a missing object, both give `mirror_corrupt` with a message naming the mirror path and `setup_vm_mirror`. Afterwards `setupVmMirror` still says `ready`, and `vm-mirror/` still exists, untouched. |
| 12 | With `opts.git` nonexistent, `getVmSource` (ready mirror) and `setupVmMirror` (empty home) both give `git_unavailable`, with a message saying git is required. `setupVmMirror` leaves no lock and no tmp dir. The code is never `fetch_failed`, `mirror_corrupt` or `internal_error`. |
| 14 | `lookupPlan.test.ts`: `… VMMaker.oscog-mt.3568] …` gives `token: 'VMMaker.oscog-mt.3568'`; `oscog-.3568]` and `oscog-eem.]` give `version_unparseable`.<br>`resolveCommit.test.ts`, with history m1 (core interpreter `VMMaker.oscog-mt.3568`, via the fixture's `author` option) and then m2 (`eem.3568`):<br>• `mt.3568` → m1 and `eem.3568` → m2, each argv carrying `-SVMMaker.oscog-<initials>.3568]`;<br>• `nice.3568` gives `commit_not_found` after one fetch;<br>• the window-end `grep` for `mt.3568` isn't fooled by m2. |
| 15 | `git.test.ts`: `failGit('rev-parse', {signal: 'KILL'})` and `failGit('show', {flood: true})` each make `runGit` reject with `internal_error`, whose message names the signal or `maxBuffer`. A non-zero exit doesn't (it's git-reported, with `exitCode`).<br>Through `getVmSource` on a ready mirror:<br>• a killed `rev-parse`, a killed `log`, a flooded `show` and a killed `fetch` each give `internal_error`, never `mirror_corrupt`, `fetch_failed` or `mirror_write_failed`;<br>• the mirror is untouched afterwards, and the same call succeeds once `clearGitFailures()` runs. |

**Must not regress.**
- The existing part 2/3 suites stay green, except the assertions this spec deliberately
  changes:
  - `mirror.test.ts:310`;
  - `getVmSource.test.ts:409-413`;
  - the `sparc` case in `src/tools.test.ts`;
  - the digits-only token expectations in `lookupPlan.test.ts` and `resolveCommit.test.ts`.
- The argv allow-list in those suites gains `ls-tree`, `grep`, `rev-list` and `--version`.
  `checkout`, `worktree`, `reset`, `update-ref` and `symbolic-ref` must still never appear, and
  every repo call keeps `--git-dir=<home>/vm-mirror` (p2 inv 6, 8–11).
- `mirror.test.ts:369` ("writes nothing outside") gets a failure-path variant, in which only
  `home/vm-mirror.error` may appear.
- The determinism (p3 inv 14) and concurrency (p3 inv 20) tests also run with `moduleStamps`.
- The forwarded Cuis-side tools are untouched (part 1 inv 8).

**Live check** (`run-cuis-mcp-bridge` driver, against the real mirror):
- `primitiveSocketReceiveDataAvailable` with live `moduleStamps` still gives `match`;
- `<primitive: 1>` with `platformName: 'Win32'` gives `unsupported_platform`;
- a `vmVersion` with `VMMaker.oscog-eem.99999` gives `commit_not_found` after one fetch;
- `VMMaker.oscog-mt.3568` resolves to one of `b6c45de66`/`bba9db4c3`, and
  `VMMaker.oscog-eem.3568` to `b0d6a5878`.

## Risks and mitigations

- **The closed-window shortcut assumes `Cog` is append-only.** The assumption is inherited,
  not new: p3 inv 14 scopes determinism to "as long as upstream doesn't rewrite its history",
  and inv 1 states the same premise.
  - A force-push that changes a window the mirror holds as closed goes unseen, because the
    shortcut doesn't fetch.
  - The walk then runs over the stale local window. It gives a stamp-verified `match`, which
    is still correct because the stamp identifies the generated plugin source whichever SHA
    carries it. Otherwise it gives the introducing commit with an honest `mismatch`. It never
    gives a wrong answer.
  - The next fetch for any other reason force-updates the local `Cog`, because the refspec is
    `+refs/heads/Cog:refs/heads/Cog`.
  - Detecting a rewrite (`merge-base --is-ancestor` on old and new tips) is only possible on a
    fetch, which this path deliberately skips, so none is attempted.
- **A git-reported read failure that isn't corruption still says "delete it".** For example,
  object files the user can't read give `Permission denied`. Inv 11 and 15 put every
  git-reported failure under `mirror_corrupt`. A fresh clone does fix the permission case, and
  the failures that deleting can't fix (resource exhaustion, kills, oversized output) are
  exactly the ones split off as `internal_error`.
- **An unrecognized network failure is reported as `mirror_write_failed`** (low). A failure
  worded in a way the `isNetworkFailure` table doesn't cover falls to the local-fault code.
  Examples are a proxy error, an uncovered TLS error, or a newer git's wording. The message
  still carries git's own text (inv 5), so the real cause stays visible. Each table entry has
  its own test in `errors.test.ts`, and a missed wording is fixed by adding one pattern.
- **The error file can't be written on a full disk.** The next `setup_vm_mirror` then starts
  a new clone instead of reporting the failure. The file is tiny, and the failure recurs on
  that clone.
- **`module_not_found` is checked at the introducing commit.** A plugin added partway through
  a token's window reads as missing. This is accepted: VMMaker adds plugins in regeneration
  commits, and those are pickaxe hits.
- **Behavior changes from part 3:**
  - `Cog[SqueakV3]` with an unknown `platformSubtype` now gives `unsupported_platform` instead
    of `v3.cog` (inv 10);
  - tokens with initials other than `eem`, which part 3 rejected, now resolve (inv 14).

## Follow-ups

- A token → SHA cache, carried over from part 3, keyed by the full token.
