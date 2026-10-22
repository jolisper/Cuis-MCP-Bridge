# VM Source: Primitive Lookup — Functional Spec

## Summary

Six new MCP tools let an AI coding assistant (via Claude Code) go from a Cuis method's
`<primitive: ...>` pragma to the C source of that primitive, read from
`OpenSmalltalk/opensmalltalk-vm` at the exact commit the running VM was built from. Four
read-only Cuis-side tools report facts about the running VM. One host-side tool sets up a
shared local mirror of the VM repository, and another returns one function from it as
structured JSON, with the context needed to explain it.

## Problem

Nothing today connects a primitive pragma to its VM-level implementation. Reading whatever VM
checkout happens to be on disk isn't enough: it may be at a different revision than the VM
actually running the image, and VM source files run to tens of thousands of lines, so a whole
file isn't a useful answer.

## Non-goals

- Browsing VM source independently of a pragma or of the running VM's reported version,
  diagnosing a VM crash from a bare symbol, and reading platform code under
  `opensmalltalk-vm/platforms/` are out of scope (tracked in `TODO.md`).
- No tool compiles, builds or checks out anything.
- Windows (`platformName` `'Win32'`) is not supported, and neither are core-interpreter
  lookups on a Stack VM.

## Behavior

### Tools and inputs

1. `get_vm_version` returns the running image's `Smalltalk vmVersion` string, e.g.
   `'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3738] 7.20260327.1636'`.
2. `get_platform_name` returns the running image's `Smalltalk platformName` string (e.g.
   `'Mac OS'`, `'unix'`).
3. `get_platform_subtype` returns the running image's `Smalltalk platformSubtype` string (e.g.
   `'aarch64'`, `'x64'`).
4. `get_loaded_modules` returns the plugin stamps the running VM reports, as a JSON object
   with two arrays of strings, exactly as the VM reports them (suffix included):
   - `builtin` — the compiled-in plugins (`Smalltalk listBuiltinModules`), e.g.
     `'SocketPlugin VMMaker.oscog-eem.3739 (i)'`;
   - `loaded` — the plugins loaded so far (`Smalltalk listLoadedModules`), e.g.
     `'VectorEnginePlugin VectorEnginePlugin-jmv.26 (e)'`.
5. Each of the four Cuis-side tools reflects the VM's state at the moment of the call and
   depends on no other call; any one can be called alone. An external plugin that loads after
   a `get_loaded_modules` call appears in a later call.
6. `setup_vm_mirror()` takes no parameters and makes sure the shared VM mirror exists (see
   "Mirror setup").
7. `get_vm_source(vmVersion, lookupKey, module?, platformName?, platformSubtype?,
   moduleStamps?)` returns one VM function as JSON (see "Response"). The caller never
   supplies a file path; the tool decides which file to read.
8. The caller passes every `get_vm_source` input unprocessed:
   - `vmVersion` exactly as `get_vm_version` returned it, build suffix included;
   - `lookupKey` straight off the pragma: the primitive-name string for a named primitive,
     or the bare number for a numbered one. Only a JSON number counts as numbered; a JSON
     string is always a name, so `"1"` is looked up as the name `1` (and ends in
     `symbol_not_found`);
   - `module` as the pragma's module name, when the pragma has one;
   - `platformName` and `platformSubtype` exactly as their tools returned them;
   - `moduleStamps` exactly as `get_loaded_modules` returned it.
9. Which platform parameters `get_vm_source` requires depends on `module`:

   | `module` | `platformSubtype` | `platformName` |
   |---|---|---|
   | given, ordinary plugin | not required | not required |
   | given, `SqueakFFIPrims` | **required** | **required** |
   | omitted (numbered, or named with no module) | **required** | optional — see invariant 15 |

   A parameter that the case doesn't use is ignored, and supplying it is harmless.
10. `get_vm_source` doesn't require any Cuis-side tool to have been called first in the same
    session. A caller that already has valid inputs from any source can call it directly.
11. No tool calls another. The caller orchestrates them, typically: read the pragma with the
    existing `get_method_source`, call `get_vm_version`, call the platform tools the case
    requires (and optionally `get_loaded_modules`), then call `get_vm_source`. If that fails
    with `mirror_missing`, call `setup_vm_mirror` and retry `get_vm_source` later.

### Response

12. A successful `get_vm_source` response contains:
    - `function` — the function's full source, including the generated comment naming the
      VMMaker method it came from;
    - `generatedFrom` — that VMMaker method (e.g. `InterpreterPrimitives>>#primitiveAdd`);
    - `helpers` — the source of the functions in the same file that `function` calls, one
      level deep, with no cap on their number or size;
    - `externalCalls` — the names of called functions that aren't in the file, each marked
      either as VM interface or as platform code that isn't available;
    - metadata: the resolved commit SHA, the file path, the function's line range, the
      dispatch entry (the exports row or the `primitiveTable` slot), and every default the
      tool applied in choosing the file;
    - `caveats` — an array of plain-language sentences, one for each default the tool applied
      or warning it raised: the build variant default (invariant 14), the plain-vs-actual
      rendering (15), a shared dispatcher (18), and a `mismatch` or `not_verifiable` stamp
      check (17). It is an empty array when there is nothing to say. The `get_vm_source`
      tool description tells the assistant to state these caveats when it explains the
      function, and never to present a defaulted source as the exact compiled one.
13. A response never contains a whole file, and its source never comes from a working tree
    or from any checkout on disk. It always comes from the resolved commit.
14. A lookup that leaves the build variant (`cog`, `cog.lowcode` or `sista`) undetermined
    returns the `cog` variant's source, and the metadata says that this default was applied.
15. For a lookup with `module` omitted:
    - without `platformName`, the tool returns the plain C rendering of the core interpreter,
      and the metadata says the actual build may use the GCC-optimized rendering;
    - with `platformName`, the tool returns the rendering the VM was actually compiled from
      on that platform, and the metadata says which one that is.
16. A `SqueakFFIPrims` lookup returns the function from the architecture-specific FFI source
    that matches `platformName` and `platformSubtype` (e.g. `ARM64AppleFFIPlugin.c` for
    `'Mac OS'` and `'aarch64'`), and the metadata path names that file.
17. When `moduleStamps` is given on a lookup with `module`, the metadata includes
    `moduleStampCheck`:
    - `match` — the running VM reports the same stamp for that plugin as the returned source;
    - `mismatch` — it reports a different stamp, and both stamps are included;
    - `not_verifiable` — the VM reports no entry for that plugin (e.g. an external plugin
      that hasn't loaded yet).

    A `mismatch` is a warning in a successful response, never an error. Without
    `moduleStamps`, or when `module` is omitted, `moduleStampCheck` is absent.
18. For a numbered primitive whose `primitiveTable` slot is served by a shared dispatcher
    rather than its own function (quick primitives 256–519, and slot 117,
    `primitiveExternalCall`), `function` is that dispatcher. The metadata marks it as shared
    and says which part of it applies to the requested number.

### Version and commit resolution

19. `get_vm_source` resolves the `VMMaker.oscog-eem.<N>` token in `vmVersion` to the commit
    on upstream's main development branch (`Cog`) that introduced that token into the
    core-interpreter source. A commit whose title names a different VMMaker revision than
    its interpreter source is still resolved correctly.
20. Several consecutive commits can carry the same token. Resolution then picks:
    - the oldest of them (the introducing commit), by default;
    - for a lookup with `module` and `moduleStamps`, the oldest of them whose plugin stamp
      matches the running VM's. If the VM reports a stamp for that plugin and none matches,
      the mirror may simply predate the VM's build, so the tool fetches from upstream once
      and tries again (and fails with `fetch_failed` if that fetch fails, invariant 43). If
      none matches after that, it uses the introducing commit. If the VM reports no stamp
      for that plugin (`not_verifiable`), there is nothing to match against, so the tool uses
      the introducing commit without fetching.

    Several candidates are never surfaced as an ambiguity or an error.
21. The same inputs give the same response on every call, as long as upstream doesn't
    rewrite its history.
22. If the commit for a token is already in the shared mirror, from any earlier call by any
    bridge instance, resolving it needs no network access.
23. If it isn't, `get_vm_source` fetches from upstream first and then resolves. That call can
    take noticeably longer; the latency is expected, not a failure.

### Mirror setup

24. The shared mirror is in one of three states the consumer can observe: missing,
    initializing (a clone is running) or ready.
25. `setup_vm_mirror` returns immediately and never waits for a clone. It returns `ready` if
    the mirror is ready (with no network access and no change), `in_progress` if a clone is
    already running (started by this bridge instance or another), or `started` if it has just
    started one in the background.
26. `get_vm_source` never starts a clone. While the mirror is missing it fails with
    `mirror_missing`, and the error names `setup_vm_mirror`. While a clone is running it
    fails with `mirror_initializing`.
27. A half-finished clone is never treated as ready. `get_vm_source` succeeds only after a
    clone has fully completed.
28. Concurrent `setup_vm_mirror` calls, from the same or different bridge instances, start at
    most one clone. Every other caller gets `in_progress`.
29. If a clone was interrupted (e.g. its bridge process exited), the next `setup_vm_mirror`
    call discards it and starts a new one, rather than reporting `in_progress` forever. This
    holds even if the interrupted process's ID has since been reused by an unrelated
    process.
30. If a background clone fails, the next `setup_vm_mirror` call reports the failure and
    starts nothing; the call after that starts a new clone. The failure is `fetch_failed`
    when upstream couldn't be reached, and `mirror_write_failed` for any other cause (e.g.
    a full disk, or a `~/.cuis-mcp-bridge` that can't be written), with git's own error text
    in the message. Until a clone succeeds, `get_vm_source` keeps failing with
    `mirror_missing`.

### Errors

31. Every `get_vm_source` failure is a structured error with a code. The codes are checked in
    this order:
    1. `mirror_missing` or `mirror_initializing` (see invariant 26), before any other check;
    2. then, before any git operation, these input checks, in this order (the first that
       applies is reported):
       - `invalid_request` — `module` is given with a numeric `lookupKey` (no pragma has
         that shape: the Cuis compiler rejects `<primitive: N module: '...'>`, and the
         message says a numbered primitive can't have a module), or `moduleStamps` isn't an
         object with `builtin` and `loaded` arrays of strings (invariant 4);
       - `version_unparseable` — `vmVersion` has no recognizable `VMMaker.oscog-eem.<N>`
         token;
       - `missing_platform_info` — a parameter required by the case (invariant 9) is
         missing; the error names which one;
       - `unsupported_platform` — see invariant 39;
    3. when git is first needed: `git_unavailable` (invariant 41); then, during resolution,
       `fetch_failed`, `mirror_write_failed`, `commit_not_found`, `mirror_busy` and
       `mirror_corrupt`;
    4. against the resolved commit, before reading any file: `module_not_found` — `module`
       doesn't name a plugin that exists at that commit;
    5. while reading: `path_not_found`, `symbol_not_found` and `primitive_slot_empty`.
32. `commit_not_found` means no commit carries the token, even after fetching from upstream.
33. `fetch_failed` means upstream couldn't be reached, and its message includes git's own
    error text. It is never reported as `commit_not_found`, which means a fetch succeeded
    but nothing matched, and never used for a failure that isn't about reaching upstream.
    A clone or fetch that fails for another reason, e.g. a full disk or an unwritable
    mirror, is `mirror_write_failed`, in `get_vm_source` as well as in `setup_vm_mirror`
    (invariant 30), with git's own error text in the message.
34. When concurrent calls need to fetch into the mirror at once, one fetch proceeds and the
    others retry automatically, for about 5.6 seconds (5 retries at increasing intervals,
    from 500 ms up to 2 s). Only when those retries run out does the caller see
    `mirror_busy`.
35. `path_not_found` means the resolved commit lacks the file the tool expects for the case
    (e.g. an old commit with a different repository layout).
36. `symbol_not_found` means the file exists but `lookupKey` matches nothing in it: no
    exports row for a name, or no `primitiveTable` slot for a number. It is never reported
    as `module_not_found` or `path_not_found`.
37. `primitive_slot_empty` means a numbered `lookupKey` names a `primitiveTable` slot that
    holds no function, so the method always runs its Smalltalk fallback code. The error
    names the slot. It is never reported as `symbol_not_found`, because the slot exists.
38. A Stack VM's `vmVersion` doesn't stop lookups that have a `module`; they resolve as on a
    Cog VM.
39. `unsupported_platform` is returned, naming the value, when:
    - `platformName` is `'Win32'`, whenever it is supplied, in every case;
    - or a value the case actually uses is one the tool has no mapping for:
      - `platformName` is anything other than `'Mac OS'` or `'unix'`;
      - `platformSubtype` doesn't map to a bit width (`module` omitted) or to an FFI source
        file (`SqueakFFIPrims`);
      - `module` is omitted and `vmVersion`'s family tag is a Stack VM, or anything other
        than `Cog[Spur]` or `Cog[SqueakV3]`.

    Apart from `'Win32'`, a value the case doesn't use is still ignored (invariant 9), so an
    ordinary plugin lookup never fails because of an unknown `platformName` or
    `platformSubtype`.
40. `mirror_corrupt` is returned when the mirror exists but git can't read it as a valid
    repository. The message tells the user to delete `~/.cuis-mcp-bridge/vm-mirror` and
    call `setup_vm_mirror` again. No tool repairs or deletes a damaged mirror itself, and
    `setup_vm_mirror` still reports `ready` for one, because it only checks that the
    mirror exists.
41. `git_unavailable` is returned by `get_vm_source` and `setup_vm_mirror` when the host has
    no usable `git` executable. The message says git is required. It is never reported as
    `fetch_failed` or `mirror_corrupt`. A `setup_vm_mirror` call that would start a clone
    returns it instead of `started`.

### Networking

42. `get_vm_source` and `setup_vm_mirror` are the only tools in the bridge, new or existing,
    that make network calls, and only to fetch from or clone upstream.
43. Every network failure (DNS failure, connection refused, timeout, unreachable upstream)
    surfaces as `fetch_failed`. It is never silently turned into a different, possibly stale
    result, and never reported as `commit_not_found`. This includes the refresh in
    invariant 20: if that fetch fails, the call fails with `fetch_failed` even though an
    introducing-commit source was available.

### Cuis-side connectivity

44. The four Cuis-side tools make no network calls. They fail only with the existing bridge's
    `unreachable` and `protocol_mismatch` errors, under the same conditions as every existing
    Cuis-side tool (see `initiatives/cuis-mcp-bridge/functional-spec.md` invariants 12–14).
    An image whose Cuis-side bridge package predates these four tools fails them with
    `protocol_mismatch`, whose message says to reload the package. It never fails them with
    `invalid_request`, which would look like a mistake in the caller's own request.
45. They share the single active session with the nine existing Cuis-side tools. A call made
    while another session holds the connection fails with `session_busy` (see
    `initiatives/cuis-mcp-bridge/functional-spec.md` invariant 20).
46. `get_vm_source` and `setup_vm_mirror` never use the Cuis-side connection. They work while
    a Cuis-side session is active, idle or unreachable, and never fail with `session_busy`.

### Read-only and isolation (must not regress)

47. The four Cuis-side tools are read-only, with no side effects on the image.
48. The only writes in this surface are `setup_vm_mirror` creating the mirror and
    `get_vm_source` fetching into it, both confined to `~/.cuis-mcp-bridge/`.
49. The mirror is a bare repository. No tool creates a working tree, checks out a commit or
    moves `HEAD` in it.
50. No tool reads from or writes to a project-local `opensmalltalk-vm/` checkout used for
    building a VM. The mirror is a separate clone, in a separate location.
51. The mirror isn't tied to one project. A bridge instance in a different Cuis project uses,
    and benefits from, the same mirror.

### Concurrency

52. Concurrent `get_vm_source` calls, from the same or different bridge instances and with the
    same or different inputs, never corrupt each other's results or the mirror. Reads need no
    coordination; only fetches are serialized (invariant 34).
