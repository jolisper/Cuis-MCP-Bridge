# VM Source: Primitive Lookup — Part 3: Source Lookup — Functional Spec

## Summary

Six new MCP tools let an AI coding assistant (via Claude Code) go from a Cuis method's
`<primitive: ...>` pragma to the C source of that primitive, read from
`OpenSmalltalk/opensmalltalk-vm` at the exact commit the running VM was built from. One host-side tool sets up a shared local mirror of the VM repository, and another returns one function from it as structured JSON, with the context needed to explain it.

Covered by `vm-source-primitive-lookup-01-cuis-vm-facts`.

Covered by `vm-source-primitive-lookup-02-mirror-setup`.

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

## Assumes

- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 1
- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 2
- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 3
- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 4
- `vm-source-primitive-lookup-02-mirror-setup` invariant 1
- `vm-source-primitive-lookup-02-mirror-setup` invariant 2
- `vm-source-primitive-lookup-02-mirror-setup` invariant 3

## Behavior

### Tools and inputs

1. `get_vm_source(vmVersion, lookupKey, module?, platformName?, platformSubtype?,
   moduleStamps?)` returns one VM function as JSON (see "Response"). The caller never
   supplies a file path; the tool decides which file to read.
2. The caller passes every `get_vm_source` input unprocessed:
   - `vmVersion` exactly as `get_vm_version` returned it, build suffix included;
   - `lookupKey` straight off the pragma: the primitive-name string for a named primitive,
     or the bare number for a numbered one. Only a JSON number counts as numbered; a JSON
     string is always a name, so `"1"` is looked up as the name `1` (and ends in
     `symbol_not_found`);
   - `module` as the pragma's module name, when the pragma has one;
   - `platformName` and `platformSubtype` exactly as their tools returned them;
   - `moduleStamps` exactly as `get_loaded_modules` returned it.
3. Which platform parameters `get_vm_source` requires depends on `module`:

   | `module` | `platformSubtype` | `platformName` |
   |---|---|---|
   | given, ordinary plugin | not required | not required |
   | given, `SqueakFFIPrims` | **required** | **required** |
   | omitted (numbered, or named with no module) | **required** | optional — see invariant 9 |

   A parameter that the case doesn't use is ignored, and supplying it is harmless.
4. `get_vm_source` doesn't require any Cuis-side tool to have been called first in the same
    session. A caller that already has valid inputs from any source can call it directly.
5. No tool calls another. The caller orchestrates them, typically: read the pragma with the
    existing `get_method_source`, call `get_vm_version`, call the platform tools the case
    requires (and optionally `get_loaded_modules`), then call `get_vm_source`. If that fails
    with `mirror_missing`, call `setup_vm_mirror` and retry `get_vm_source` later.

### Response

6. A successful `get_vm_source` response contains:
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
      or warning it raised: the build variant default (invariant 8), the plain-vs-actual
      rendering (9), a shared dispatcher (12), and a `mismatch` or `not_verifiable` stamp
      check (11). It is an empty array when there is nothing to say. The `get_vm_source`
      tool description tells the assistant to state these caveats when it explains the
      function, and never to present a defaulted source as the exact compiled one.
7. A response never contains a whole file, and its source never comes from a working tree
    or from any checkout on disk. It always comes from the resolved commit.
8. A lookup that leaves the build variant (`cog`, `cog.lowcode` or `sista`) undetermined
    returns the `cog` variant's source, and the metadata says that this default was applied.
9. For a lookup with `module` omitted:
    - without `platformName`, the tool returns the plain C rendering of the core interpreter,
      and the metadata says the actual build may use the GCC-optimized rendering;
    - with `platformName`, the tool returns the rendering the VM was actually compiled from
      on that platform, and the metadata says which one that is.
10. A `SqueakFFIPrims` lookup returns the function from the architecture-specific FFI source
    that matches `platformName` and `platformSubtype` (e.g. `ARM64AppleFFIPlugin.c` for
    `'Mac OS'` and `'aarch64'`), and the metadata path names that file.
11. When `moduleStamps` is given on a lookup with `module`, the metadata includes
    `moduleStampCheck`:
    - `match` — the running VM reports the same stamp for that plugin as the returned source;
    - `mismatch` — it reports a different stamp, and both stamps are included;
    - `not_verifiable` — the VM reports no entry for that plugin (e.g. an external plugin
      that hasn't loaded yet).

    A `mismatch` is a warning in a successful response, never an error. Without
    `moduleStamps`, or when `module` is omitted, `moduleStampCheck` is absent.
12. For a numbered primitive whose `primitiveTable` slot is served by a shared dispatcher
    rather than its own function (quick primitives 256–519, and slot 117,
    `primitiveExternalCall`), `function` is that dispatcher. The metadata marks it as shared
    and says which part of it applies to the requested number.

### Version and commit resolution

13. `get_vm_source` resolves the `VMMaker.oscog-eem.<N>` token in `vmVersion` to the commit
    on upstream's main development branch (`Cog`) that introduced that token into the
    core-interpreter source. A commit whose title names a different VMMaker revision than
    its interpreter source is still resolved correctly.
14. The same inputs give the same response on every call, as long as upstream doesn't
    rewrite its history.
15. If the commit for a token is already in the shared mirror, from any earlier call by any
    bridge instance, resolving it needs no network access.
16. If it isn't, `get_vm_source` fetches from upstream first and then resolves. That call can
    take noticeably longer; the latency is expected, not a failure. The `get_vm_source` tool
    description says so, so the assistant tells the user when a call may be fetching.

### Mirror setup

17. `get_vm_source` never starts a clone. While the mirror is missing it fails with
    `mirror_missing`, and the error names `setup_vm_mirror`. While a clone is running it
    fails with `mirror_initializing`.
18. A half-finished clone is never treated as ready. `get_vm_source` succeeds only after a
    clone has fully completed.

### Errors

19. When concurrent calls need to fetch into the mirror at once:
    - calls in the same bridge instance share one fetch: the first starts it, and the others
      wait for it to finish;
    - a call that finds another bridge instance already fetching fails right away with
      `mirror_busy`, without waiting or retrying. The tool description tells the assistant to
      tell the user that another session is fetching.

### Concurrency

20. Concurrent `get_vm_source` calls, from the same or different bridge instances and with the
    same or different inputs, never corrupt each other's results or the mirror. Reads need no
    coordination; only fetches are serialized (invariant 19).

## Must not regress

- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 8
- `vm-source-primitive-lookup-02-mirror-setup` invariant 6
- `vm-source-primitive-lookup-02-mirror-setup` invariant 7
- `vm-source-primitive-lookup-02-mirror-setup` invariant 8
- `vm-source-primitive-lookup-02-mirror-setup` invariant 9
- `vm-source-primitive-lookup-02-mirror-setup` invariant 10
- `vm-source-primitive-lookup-02-mirror-setup` invariant 11
