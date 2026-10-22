# VM Source: Primitive Lookup — Part 4: Failure Handling — Functional Spec

## Non-goals

- Windows (`platformName` `'Win32'`) is not supported, and neither are core-interpreter
  lookups on a Stack VM.

## Assumes

- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 4
- `vm-source-primitive-lookup-02-mirror-setup` invariant 1
- `vm-source-primitive-lookup-02-mirror-setup` invariant 3
- `vm-source-primitive-lookup-02-mirror-setup` invariant 5
- `vm-source-primitive-lookup-03-source-lookup` invariant 1
- `vm-source-primitive-lookup-03-source-lookup` invariant 2
- `vm-source-primitive-lookup-03-source-lookup` invariant 3
- `vm-source-primitive-lookup-03-source-lookup` invariant 6
- `vm-source-primitive-lookup-03-source-lookup` invariant 10
- `vm-source-primitive-lookup-03-source-lookup` invariant 11
- `vm-source-primitive-lookup-03-source-lookup` invariant 12
- `vm-source-primitive-lookup-03-source-lookup` invariant 13
- `vm-source-primitive-lookup-03-source-lookup` invariant 16
- `vm-source-primitive-lookup-03-source-lookup` invariant 17
- `vm-source-primitive-lookup-03-source-lookup` invariant 19

## Behavior

### Version and commit resolution

1. Several consecutive commits can carry the same token. Resolution then picks:
    - the oldest of them (the introducing commit), by default;
    - for a lookup with `module` and `moduleStamps`, the oldest of them whose plugin stamp
      matches the running VM's. If the VM reports a stamp for that plugin and none matches:
        - when the mirror already holds the commit that replaces the token, every commit
          carrying the token is already local and a fetch can't add one, so the tool uses
          the introducing commit without fetching;
        - otherwise the token is still current at the mirror's newest commit, and the mirror
          may simply predate the VM's build, so the tool fetches from upstream once and
          tries again (and fails with `fetch_failed` if that fetch fails, invariant 13). If
          none matches after that, it uses the introducing commit.

      If the VM reports no stamp for that plugin (`not_verifiable`), there is nothing to
      match against, so the tool uses the introducing commit without fetching.

    Several candidates are never surfaced as an ambiguity or an error.

### Mirror setup

2. If a background clone fails, the next `setup_vm_mirror` call reports the failure and
    starts nothing; the call after that starts a new clone. The failure is `fetch_failed`
    when upstream couldn't be reached, and `mirror_write_failed` for any other cause (e.g.
    a full disk, or a `~/.cuis-mcp-bridge` that can't be written), with git's own error text
    in the message. Until a clone succeeds, `get_vm_source` keeps failing with
    `mirror_missing`.

### Errors

3. Every `get_vm_source` failure is a structured error with a code. The codes are checked in
    this order:
    1. `mirror_missing` or `mirror_initializing` (see `vm-source-primitive-lookup-03-source-lookup` invariant 17), before any other check;
    2. then, before any git operation, these input checks, in this order (the first that
       applies is reported):
       - `invalid_request` — `module` is given with a numeric `lookupKey` (no pragma has
         that shape: the Cuis compiler rejects `<primitive: N module: '...'>`, and the
         message says a numbered primitive can't have a module), or `moduleStamps` isn't an
         object with `builtin` and `loaded` arrays of strings (`vm-source-primitive-lookup-01-cuis-vm-facts` invariant 4);
       - `version_unparseable` — `vmVersion` has no recognizable
         `VMMaker.oscog-<initials>.<N>` token (invariant 14);
       - `missing_platform_info` — a parameter required by the case (`vm-source-primitive-lookup-03-source-lookup` invariant 3) is
         missing; the error names which one;
       - `unsupported_platform` — see invariant 10;
    3. when git is first needed: `git_unavailable` (invariant 12); then, during resolution,
       `fetch_failed`, `mirror_write_failed`, `commit_not_found`, `mirror_busy` and
       `mirror_corrupt`;
    4. against the resolved commit, before reading any file: `module_not_found` — `module`
       doesn't name a plugin that exists at that commit;
    5. while reading: `path_not_found`, `symbol_not_found` and `primitive_slot_empty`.

    From step 3 on, any git command can also fail with `internal_error` (invariant 15).
4. `commit_not_found` means no commit carries the token, even after fetching from upstream.
5. `fetch_failed` means upstream couldn't be reached, and its message includes git's own
    error text. It is never reported as `commit_not_found`, which means a fetch succeeded
    but nothing matched, and never used for a failure that isn't about reaching upstream.
    A clone or fetch that fails for another reason, e.g. a full disk or an unwritable
    mirror, is `mirror_write_failed`, in `get_vm_source` as well as in `setup_vm_mirror`
    (invariant 2), with git's own error text in the message.
6. `path_not_found` means the resolved commit lacks the file the tool expects for the case
    (e.g. an old commit with a different repository layout).
7. `symbol_not_found` means the file exists but `lookupKey` matches nothing in it: no
    exports row for a name, or no `primitiveTable` slot for a number. It is never reported
    as `module_not_found` or `path_not_found`.
8. `primitive_slot_empty` means a numbered `lookupKey` names a `primitiveTable` slot that
    holds no function, so the method always runs its Smalltalk fallback code. The error
    names the slot. It is never reported as `symbol_not_found`, because the slot exists.
9. A Stack VM's `vmVersion` doesn't stop lookups that have a `module`; they resolve as on a
    Cog VM.
10. `unsupported_platform` is returned, naming the value, when:
    - `platformName` is `'Win32'`, whenever it is supplied, in every case;
    - or a value the case actually uses is one the tool has no mapping for:
      - `platformName` is anything other than `'Mac OS'` or `'unix'`;
      - `platformSubtype` doesn't map to a bit width (`module` omitted) or to an FFI source
        file (`SqueakFFIPrims`);
      - `module` is omitted and `vmVersion`'s family tag is a Stack VM, or anything other
        than `Cog[Spur]` or `Cog[SqueakV3]`.

    Apart from `'Win32'`, a value the case doesn't use is still ignored (`vm-source-primitive-lookup-03-source-lookup` invariant 3), so an
    ordinary plugin lookup never fails because of an unknown `platformName` or
    `platformSubtype`.
11. `mirror_corrupt` is returned when the mirror exists but git can't read it as a valid
    repository. The message tells the user to delete `~/.cuis-mcp-bridge/vm-mirror` and
    call `setup_vm_mirror` again. No tool repairs or deletes a damaged mirror itself, and
    `setup_vm_mirror` still reports `ready` for one, because it only checks that the
    mirror exists.
12. `git_unavailable` is returned by `get_vm_source` and `setup_vm_mirror` when the host has
    no usable `git` executable. The message says git is required. It is never reported as
    `fetch_failed` or `mirror_corrupt`. A `setup_vm_mirror` call that would start a clone
    returns it instead of `started`.

### Networking

13. Every network failure (DNS failure, connection refused, timeout, unreachable upstream)
    surfaces as `fetch_failed`. It is never silently turned into a different, possibly stale
    result, and never reported as `commit_not_found`. This includes the refresh in
    invariant 1, when it runs: if that fetch fails, the call fails with `fetch_failed` even
    though an introducing-commit source was available. A stamp mismatch on a token that the
    mirror already shows replaced makes no refresh, so it needs no network access.

### Version token

14. The version token is the whole `VMMaker.oscog-<initials>.<N>` name in `vmVersion`, for
    any author's initials (e.g. `eem`, `mt`, `nice`), not only `eem`. Resolution matches the
    initials and the number together, so tokens that share a number but not initials (e.g.
    `VMMaker.oscog-mt.3568` and `VMMaker.oscog-eem.3568`) resolve to different commits, each
    to the one that introduced it. This extends `vm-source-primitive-lookup-03-source-lookup`
    invariant 13, which names only `VMMaker.oscog-eem.<N>`, to every author.

### Unexpected failures

15. `internal_error` means a git command couldn't be run to completion, so git itself
    reported nothing. Examples are the host running out of processes, file descriptors or
    memory, output too large to collect, or the git process being killed. The message
    includes the underlying detail. It is never reported as `mirror_corrupt`, because nothing
    is known to be wrong with the mirror, and deleting it wouldn't help. `mirror_corrupt`
    (invariant 11) is only for a failure that git itself reports while reading the mirror.
    A git executable that is missing or can't be run is `git_unavailable` (invariant 12),
    not `internal_error`.

## Must not regress

- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 8
- `vm-source-primitive-lookup-02-mirror-setup` invariant 6
- `vm-source-primitive-lookup-02-mirror-setup` invariant 7
- `vm-source-primitive-lookup-02-mirror-setup` invariant 8
- `vm-source-primitive-lookup-02-mirror-setup` invariant 9
- `vm-source-primitive-lookup-02-mirror-setup` invariant 10
- `vm-source-primitive-lookup-02-mirror-setup` invariant 11
- `vm-source-primitive-lookup-03-source-lookup` invariant 7
- `vm-source-primitive-lookup-03-source-lookup` invariant 14
- `vm-source-primitive-lookup-03-source-lookup` invariant 20
