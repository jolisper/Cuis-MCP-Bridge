# VM Source: Primitive Lookup

## Problem

The existing MCP bridge tools (`list_classes`, `list_senders_of`, `get_method_source`, etc.)
only reflect the Smalltalk side of a running Cuis image. Some methods, though, are backed by
primitives implemented in the VM itself — C code in `OpenSmalltalk/opensmalltalk-vm` — and
there is currently no way for an assistant to go from "this method has
`<primitive: ... module: 'SocketPlugin'>`" to "here is the actual C implementation behind it."
Answering that requires reading VM/plugin source, which is a different kind of artifact
(static C source) than anything the live-image socket protocol currently exposes.

The naive approach — just reading whatever `opensmalltalk-vm/` checkout happens to be on disk
— doesn't actually answer the question correctly: that checkout could be at a different
revision than the VM binary actually running the image, so the C source returned might not
match the primitive that's actually executing.

## Goals

- Resolve the exact VM build a running image is using, from the image itself
  (`Smalltalk vmVersion`, `platformName`, `platformSubtype`), and use that to pin which
  revision — and which of the several candidate files — of the VM source to read.
- Read VM/plugin source at that exact revision, read-only, with no risk of corrupting any
  checkout (live image, build checkout, or the lookup's own mirror).
- Make this work for any Cuis project, not just this repo — one shared cache of the upstream
  VM history rather than a per-project clone.
- Keep it safe under concurrent use: multiple projects' MCP servers hitting the same cache at
  once must not corrupt it or interfere with each other.

## Non-goals

- Not a general VM-source browser decoupled from a specific image's version — every lookup is
  driven by what a live image actually reports, not an arbitrary/user-chosen revision.
- Not touching, building, or checking out the VM — no working tree is ever created for this
  purpose, and the project's own `opensmalltalk-vm/` build checkout is never read from or
  written to by this feature.
- Not part of the Cuis-side socket protocol beyond the four read-only queries (`vmVersion`,
  `platformName`, `platformSubtype`, and the VM's module list) — version resolution and source reading happen entirely
  host-side, in the MCP server process.
- Scoped to the three primitive-pragma cases (named-with-module, numbered, and
  named-without-module) only — VM crash/error
  diagnosis starting from a VM-side symbol with no pragma, platform-specific code paths under
  `opensmalltalk-vm/platforms/`, and VM-side browsing independent of any method (e.g. "what
  primitives does `SocketPlugin` provide") are related but out of scope here; tracked as
  separate future initiatives in `TODO.md`.

## Scope

Two small pieces:

- **Cuis-side** (`mcp-bridge/image/`): expose four read-only calls, same shape as the
  existing reflection tools, each its own call rather than one bundled "VM build info" call
  (see Decisions) — this is the only part that needs the live image, since only the image
  knows which VM binary is actually running it:
  - `Smalltalk vmVersion` — the VMMaker build token, used for commit resolution, plus the
    family tag used to pick the core-interpreter file. Live value on the bundled VM:
    `'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3738] 7.20260327.1636'`.
  - `Smalltalk platformName` — the image's host OS (`'Mac OS'`, `'unix'`, `'Win32'`), used to
    resolve the plain-vs-`gcc3x-` file question for numbered primitives, and as half of the
    `SqueakFFIPrims` exception's resolution (see Decisions).
  - `Smalltalk platformSubtype` — the image's CPU architecture (e.g. `'aarch64'`, `'x64'` on
    macOS), needed only for the `SqueakFFIPrims` exception to the module→path convention
    below (see Decisions).
  - `Smalltalk listBuiltinModules` and `Smalltalk listLoadedModules`, exposed together as
    `get_loaded_modules` — the stamps of the plugins the running VM reports, used only by
    the optional plugin stamp check (see Decisions). It returns an object with two arrays of
    strings, `builtin` and `loaded`, holding the stamps exactly as the VM reports them,
    suffix included.

  These four operations are new wire operations, so adding them bumps `PROTOCOL_VERSION`
  from 2 to 3 on both sides (`mcp-bridge/PROTOCOL.md` first, then the TypeScript and
  Smalltalk constants). Without the bump, an image that still has the older
  `MCP-Bridge.pck.st` loaded would answer the unknown operation with `invalid_request`
  (`PROTOCOL.md`: an unrecognized `op` is answered that way), which looks like a mistake in
  the caller's own request. With it, the handshake fails with `protocol_mismatch`, whose
  message says to reload the package.
- **Host-side** (`mcp-bridge/server/`): two new tools.

  `setup_vm_mirror()` creates the shared bare mirror at `~/.cuis-mcp-bridge/vm-mirror` if it
  doesn't exist yet. It starts the clone in the background and returns immediately, so no
  tool call ever waits on the roughly 750 MB download (see "Mirror creation" under Decisions).

  `get_vm_source(vmVersion, lookupKey, module?, platformName?, platformSubtype?,
  moduleStamps?)`:
  0. checks that the mirror is ready, returning `mirror_missing` (pointing the caller to
     `setup_vm_mirror`) or `mirror_initializing` if it isn't; it never starts a clone itself,
  1. parses the `VMMaker.oscog-eem.<N>` token out of `vmVersion`,
  2. resolves that token to a commit SHA in a shared bare mirror of
     `OpenSmalltalk/opensmalltalk-vm` by searching file contents, not commit messages
     on the main `Cog` branch (`git log Cog -S'<token>]' -- 'src/*/cointerp.c'
     'src/*/interp.c'`; see Decisions),
  3. fetches from `origin` into the mirror if no match is found locally, and retries the
     resolution,
  4. derives the file path **itself**, from `module`/`platformName`/`platformSubtype` — the
     caller never supplies a path,
  5. reads that file at the resolved SHA via `git show <sha>:path`, and
  6. locates the one function named by `lookupKey` within it and returns that function plus
     the context needed to explain it: the VMMaker method it was generated from, the bodies of
     same-file helpers it calls, the names of calls it can't show, and metadata. It never
     returns the whole file. See "Response shape" under Decisions.

  The caller supplies only what it already has straight off a method's pragma, no derivation
  required on its side. `lookupKey`'s JSON type decides the kind: a JSON number is a
  numbered primitive, and a JSON string is always a name (so `"1"` is looked up as a name):

  - **Named primitive, with module** (`<primitive: 'name' module: '<Module>'>`): pass
    `lookupKey` = the primitive-name string, `module` = `<Module>`, both read verbatim off the
    pragma. The tool maps `<Module>` to its conventional location,
    `src/plugins/<Module>/<Module>.c` — except for the one plugin where that convention
    doesn't hold (`SqueakFFIPrims`, which additionally requires `platformName` +
    `platformSubtype`; see "Flow: a method with an architecture-specific primitive" below).
  - **Numbered primitive** (`<primitive: N>`, no module): pass `lookupKey` = the bare number,
    `module` omitted, `platformSubtype` required. The tool derives the core-interpreter file
    from two live-image facts — see "Numbered primitives" under Verified examples below for
    the exact derivation and its one residual ambiguity.
  - **Named primitive, no module** (`<primitive: 'name'>`): pass `lookupKey` = the
    primitive-name string, `module` omitted, `platformSubtype` required. Same file-derivation
    as the numbered case (it lives in the same core-interpreter file), but the tool's internal
    lookup is a string search instead of a positional one once that file is read — see "Named
    primitives without a module" under Verified examples below.

  `platformName`'s role depends on the case. For `SqueakFFIPrims` it is **required**: it picks
  *which* file is read, because `platformSubtype` alone can't tell `ARM64AppleFFIPlugin.c`
  from `ARM64FFIPlugin.c` (both `aarch64`) or `X64SysVFFIPlugin.c` from `X64Win64FFIPlugin.c`
  (both `x64`). When `module` is omitted it is optional, and it only selects whether the tool
  returns the plain or the `gcc3x-`-prefixed variant of the core-interpreter file (see
  Decisions' default below). For an ordinary plugin it isn't needed, and the tool ignores it.
  `'Win32'` is unsupported wherever `platformName` is used (see Decisions).

No step in the host-side tool ever checks out a working tree or moves HEAD — steps 2, 3, and 5
are read operations (or, for step 3, a fetch) against a bare repository.

## Verified examples

Checked against the live image (via `get_method_source`) and the actual VM source
(`src/plugins/`), across three different plugins. Line numbers in every table in this section
are at `759d8f204`, the commit the bundled VM was built from (see "Separately discovered"
below):

| Smalltalk method | Pragma | VM source |
|---|---|---|
| `Socket>>primSocketReceiveDataAvailable:` | `<primitive: 'primitiveSocketReceiveDataAvailable' module: 'SocketPlugin' error: ec>` | `SocketPlugin.c:1796` |
| `FileIOAccessor>>primFileExists:` | `<primitive: 'primitiveFileExists' module: 'FileAttributesPlugin'>` | `FileAttributesPlugin.c:547` |
| `FileIOAccessor>>primCreateDirectory:` | `<primitive: 'primitiveDirectoryCreate' module: 'FilePlugin'>` | `FilePlugin.c:541` |

All three confirm the same mechanism: every plugin file declares a `<Module>_exports` array
(e.g. `SocketPlugin_exports`), each row shaped `{module name, primitive name string, function
pointer}` — e.g. `{(void*)_m, "primitiveSocketReceiveDataAvailable\000\001\000",
(void*)primitiveSocketReceiveDataAvailable}`. This is what the VM itself uses at runtime to
resolve a named primitive to a function, and it's an exact string match: the pragma's
primitive-name string is identical to the C function name, with no prefix/suffix
transformation needed. (An earlier assumption — that the pragma name needed a `prim:` →
`primitive` rewrite — turned out to be wrong, traced back to a test stub's error-message
string rather than a real pragma; the live-image check above corrected it.) So step 6's
"locate the function" reduces to searching the file for the pragma's primitive-name string
inside its `_exports` array and reading off the function name next to it.

### Numbered primitives

Not every primitive pragma names a module — `<primitive: 1>`-style pragmas are core-interpreter
primitives, resolved differently. Verified live:

| Smalltalk method | Pragma | VM source |
|---|---|---|
| `SmallInteger>>+` | `<primitive: 1>` | `src/spur64.sista/cointerp.c:2048`, `:29036` |

The resolution mechanism is different from the named-primitive case, not just a variant of it:
the core interpreter file declares a fixed-size `primitiveTable[MaxPrimitiveIndex + 2]` array
indexed positionally by primitive number (`/* 1 */ primitiveAdd,` at line 2048, defined at line
29036) — there's no module name, no string-keyed `_exports` array, and no file name to derive
from the pragma at all (unlike `src/plugins/<Module>/<Module>.c`, which is fixed per module).

**Deriving the file, and the one residual ambiguity.** `opensmalltalk-vm/src/` has 12 core-
interpreter variant directories (`v3.cog`, `v3.stack`, and `spur32`/`spur64` crossed with
`cog`/`cog.lowcode`/`sista`/`stack`/`stack.lowcode`). The tool narrows them down from two live-
image facts, both supplied by the caller:

1. `vmVersion`'s family tag picks the interpreter family, and for Cog VMs the memory manager
   too: `Cog[Spur]` → one of the six `spur*.cog*`/`spur*.sista` directories, and
   `Cog[SqueakV3]` → `v3.cog`. (Verified two ways. First, statically: grepped
   `interpreterVersion =` across every variant's generated source, with filenames shown.
   Second, live: booted an isolated headless image on the bundled `CuisVM.app` and evaluated
   `Smalltalk vmVersion` (`getSystemAttribute: 1004`). It returned
   `'Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3738] 7.20260327.1636'`,
   so the family tag does reach the image. The live value is not exactly `interpreterVersion`:
   the VM appends a build suffix (` 7.20260327.1636`, a build date). The tool therefore
   extracts the tag and the `VMMaker.oscog-eem.<N>` token rather than matching the whole
   string. The token is still followed by `]`, so the pickaxe pattern in Decisions works
   unchanged.) Stack VMs (`Open Smalltalk Stack VM
   […]`) are **out of scope for now**. All five `*.stack*` directories (`v3.stack`,
   `spur32.stack`, `spur32.stack.lowcode`, `spur64.stack`, `spur64.stack.lowcode`) generate
   the identical string, with no memory-manager tag, so 32-bit V3 vs. Spur can't be told
   apart, and neither can `stack` vs. `stack.lowcode`. See Decisions.
2. Bit width (32 vs. 64) narrows it further, from `platformSubtype` — the same fact already
   needed for the `SqueakFFIPrims` exception, reused here instead of introducing a second
   signal. On macOS, `platformSubtype`'s own source
   (`platforms/iOS/vm/OSX/sqSqueakOSXApplication+attributes.m`) returns `'x64'`/`'aarch64'` on
   the `__x86_64__`/`__arm64__` branches (64-bit) and `'intel'`/`'powerpc'` on the
   `__i386__`/`__ppc__` branches (32-bit) — confirmed by reading that source directly, the
   same file already relied on for the FFI-plugin exception below. (An earlier version of this
   design used `SmallInteger maxVal` for this step instead; dropped because nothing in this
   bridge can evaluate an arbitrary Smalltalk expression and return its value — only
   `platformSubtype`, an existing structural-reflection call, actually works here.) **Known
   gap, same shape as the `SqueakFFIPrims` one below**: only macOS's four branches were
   checked against real source; not live-verified on an actual 32-bit build.
3. For a 64-bit `Cog[Spur]` result, that still leaves three candidates —
   `spur64.cog`, `spur64.cog.lowcode`, `spur64.sista` — that are **not distinguishable** from
   anything the image or the VM binary expose. Checked concretely: grepped the actual bundled
   `Cuis7-8-main/CuisVM.app` binary's strings for build-variant markers
   (`EncoderForSistaV1`, expected to be Sista-specific) and found it present in *all three*
   candidate directories' source — not a usable discriminator after all.

**Decision**: default to the plain `cog` variant (e.g. `spur64.cog`) whenever this 3-way
ambiguity remains, rather than trying to resolve it further. This is verified safe for
ordinary primitives: diffed `primitiveAdd`'s full C body across `spur64.cog`,
`spur64.cog.lowcode`, and `spur64.sista` — byte-identical in all three, since `cog`/`lowcode`/
`sista` only change JIT and bytecode-set machinery, not individual primitive implementations.
**How big the gap is, measured.** All primitive bodies were compared across the three files
at `759d8f204`:
- **276 of 285** shared primitives are byte-identical.
- **9 differ:** the closure-value family (`primitiveClosureValue`,
  `primitiveClosureValueNoContextSwitch`, `primitiveClosureValueWithArgs`, and the three
  `primitiveFullClosureValue*` variants), `primitiveInvokeObjectAsMethod`,
  `primitiveMethodXray` and `primitiveVMParameter`. The differences are JIT decisions, not
  semantics: e.g. Sista adds an "optimized method" check before deciding whether to compile
  a block.
- **2 exist only in Sista:** `primitiveResetCountersInMethod` and
  `primitiveSistaMethodPICAndCounterData`.

Sista turns out to be distinguishable after all, from the VM binary. Exported primitive
names survive in a release binary as strings: `primitiveImageFormatVersion` is present in
the bundled `CuisVM.app`. The two Sista-only exports are absent, so the bundled VM is not a
Sista build. The macOS ARM build directories don't offer `lowcode` (see Decisions), so for
the bundled VM the `cog` default is almost certainly the exact file. `lowcode` has exactly
the same 66 exports as `cog`, so nothing distinguishes it. The tool doesn't read the VM
binary, so this is evidence for the default, not a mechanism it uses.

**Known limitation**: on a `lowcode` or `sista` VM, the 9 primitives above would show the
`cog` version of the JIT-related logic, with no error. Every other primitive is identical
across the three.

**Separately discovered, and relevant to confidence in every "verified" claim in this
document**: the actual VM binary bundled in this repo (`Cuis7-8-main/CuisVM.app`) reports
`VMMaker.oscog-eem.3738` in its own embedded `interpreterVersion` string — not `.3794`, the
version the `opensmalltalk-vm/` checkout here is pinned to. This is a live, concrete instance
of exactly the mismatch risk the Problem section describes in the abstract. **Since
re-checked**: every example in this section was re-located at `759d8f204`, the commit that
VM was built from (see "Version resolution mechanism" under Decisions). All the mechanisms
hold, but the line numbers had moved (e.g. `primitiveSocketReceiveDataAvailable` 1792 → 1796,
`primitiveImageFormatVersion` 32111 → 32593), and the tables now show the `759d8f204`
numbers. The interactive image runs on that same binary: the running VM process
(`RunCuisOnMac.sh` → `CuisVM.app/Contents/MacOS/Squeak CuisImage/Cuis7.8.image`) has code
type ARM64 and version `7.20260327.1636`, the same build suffix the headless checks read
from `vmVersion`. So the headless checks and the live image agree on the VM.

### Named primitives without a module

A third pragma shape exists, found by enumerating every distinct `<primitive: ...>` shape
actually used in the Cuis kernel source: a named primitive with **no module at all**. Verified
live:

| Smalltalk method | Pragma | VM source |
|---|---|---|
| `SystemDictionary>>imageFormatVersion` | `<primitive: 'primitiveImageFormatVersion'>` | `src/spur64.cog/cointerp.c:32593`, exports table `:84061` |

This combines the other two cases rather than introducing a fully new mechanism: the function
lives in the *same core-interpreter file* as numbered primitives (same `path` derivation,
same family/bit-width/`cog`-`lowcode`-`sista`/plain-vs-`gcc3x` questions, same answers), but
once that file is read, the lookup is a *string search* like the named-with-module case — the
core-interpreter file declares its own exports array (`vm_exports`, not `<Module>_exports`),
with the module string left empty (`static char _m[] = "";`), e.g.
`{(void*)_m, "primitiveImageFormatVersion\000\377\000", (void*)primitiveImageFormatVersion}`.
So: derive `path` the numbered-primitive way, then locate the function the named-primitive
way, searching `vm_exports` instead of a plugin's `<Module>_exports`.

## Flow: a method with a primitive implementation

End-to-end walkthrough, using `Socket>>primSocketReceiveDataAvailable:` as the example:

1. **Cuis-side (existing)** — read the method's source via `get_method_source`. Returns
   `<primitive: 'primitiveSocketReceiveDataAvailable' module: 'SocketPlugin' error: ec>`
   among the rest of the method source.
2. **Caller parses** that pragma to pull out the module (`SocketPlugin`) and the primitive
   name string (`primitiveSocketReceiveDataAvailable`) — used verbatim, no transformation
   (see Verified examples above).
3. **Cuis-side (new)** — read `Smalltalk vmVersion`. Returns a string containing a
   `VMMaker.oscog-eem.<N>` token.
4. **Host-side (new)** — call `get_vm_source(vmVersion, lookupKey:
   'primitiveSocketReceiveDataAvailable', module: 'SocketPlugin')`. The tool parses the
   token, resolves it to a commit SHA in the shared mirror (fetching from `origin` first if
   needed, retrying resolution on fetch-lock contention), derives the file itself
   (`SocketPlugin` → `src/plugins/SocketPlugin/SocketPlugin.c`), reads it at that exact SHA
   via `git show <sha>:path`, locates `primitiveSocketReceiveDataAvailable` inside the file's
   `SocketPlugin_exports` array, and returns that function with its context (see "Response
   shape" under Decisions) — not the whole file. Here that means `generatedFrom`
   `SocketPlugin>>#primitiveSocketReceiveDataAvailable:`, no same-file helpers, and
   `externalCalls` listing `sqSocketReceiveDataAvailable` as platform code that isn't
   available.

Only steps 1 and 3 touch the live image (and only because only the image can answer "what
primitive/module does this method use" and "what VM build is actually running"). Steps 2 and
4 are host-side/caller-side and work the same whether or not an image is connected.

## Flow: a method with a numbered primitive

Same shape, using `SmallInteger>>+` as the example:

1. **Cuis-side (existing)** — read the method's source via `get_method_source`. Returns
   `<primitive: 1>` among the rest of the method source — a bare number, no module.
2. **Caller parses** that pragma to pull out the primitive number (`1`).
3. **Cuis-side (new)** — read `Smalltalk vmVersion`. Returns a string with the bracketed
   family tag (e.g. `Cog[Spur]`) and the `VMMaker.oscog-eem.<N>` token.
4. **Cuis-side (new)** — read `Smalltalk platformSubtype`, needed for bit width (see
   "Deriving the file" above) — required whenever `module` is omitted.
5. **Caller decides whether to also pass `platformName`**: omitted by default (tool shows the
   plain file and says so); supplied only if the user has asked for the actual compiled
   source instead.
6. **Host-side (new)** — call `get_vm_source(vmVersion, lookupKey: 1, platformSubtype:
   'aarch64')` (adding `platformName` per step 5). The tool parses the token, resolves it to
   a commit SHA in the shared mirror, derives the directory from (family tag, bit width) —
   e.g. `Cog[Spur]` + 64-bit → `spur64.cog`, defaulting to plain `cog` when
   `cog`/`cog.lowcode`/`sista` remain ambiguous — picks the file within it (plain unless
   `platformName` says otherwise), reads it at that SHA via `git show <sha>:path`, reads off
   entry `1` of `primitiveTable[...]` — positional lookup, not a string search, unlike the
   named-primitive case — and returns that function with its context (see "Response shape"
   under Decisions), here including `stackIntegerValue` under `helpers`.

Steps 1, 3, and 4 touch the live image; step 5's decision is caller-side only. The rest is
internal to the host-side tool.

## Flow: a method with a named primitive and no module

Same shape, using `SystemDictionary>>imageFormatVersion` as the example — path derivation
borrowed from the numbered-primitive flow, lookup borrowed from the named-with-module flow:

1. **Cuis-side (existing)** — read the method's source via `get_method_source`. Returns
   `<primitive: 'primitiveImageFormatVersion'>` — a name, but no `module:` keyword.
2. **Caller parses** that pragma: a primitive-name string, with the absence of `module:`
   itself being the signal to use this third case.
3–5. **Same as steps 3–5 of the numbered-primitive flow** — read `Smalltalk vmVersion` and
   `Smalltalk platformSubtype`, decide whether to also pass `platformName`.
6. **Host-side (new)** — call `get_vm_source(vmVersion, lookupKey:
   'primitiveImageFormatVersion', platformSubtype: 'aarch64')`. Same internal steps as the
   numbered-primitive flow up through deriving and reading the core-interpreter file, but the
   final lookup is a string search — like the named-with-module flow, not the numbered one —
   against `vm_exports` instead of a plugin's `<Module>_exports`. Returns that function with its
   context (see "Response shape" under Decisions).

Touches the live image in the same steps as the numbered-primitive flow; the only difference
from that flow is the tool's final lookup being a string search instead of a positional one.

## Flow: a method with an architecture-specific primitive (the `SqueakFFIPrims` exception)

Using `ExternalFunction>>primInvokeWithArguments:` as the example — found in
`Cuis7-8-main/Packages/System/FFI.pck.st:655`, with
`<primitive: 'primitiveCalloutWithArgs' module: 'SqueakFFIPrims' error: ec>`. `ExternalFunction`
isn't in the default image (the bridge returns `not_found` for it), so it was verified live
by loading `WeakDictionaries`, `Alien-Core` and `FFI` into an isolated headless boot on the
bundled VM. The method's pragma reads
`<primitive: 'primitiveCalloutWithArgs' module: 'SqueakFFIPrims' error: 'ec'>`, its
primitive index is 117 (`primitiveExternalCall`), and literal 1 is
`#(#SqueakFFIPrims #primitiveCalloutWithArgs 0 0)` — the module and name the VM resolves at
call time.

1. **Cuis-side (existing)** — read the method's source via `get_method_source`. Returns the
   pragma above — module `'SqueakFFIPrims'`, which looks like an ordinary named-with-module
   case at this point.
2. **Caller parses** the module (`SqueakFFIPrims`) and primitive name
   (`primitiveCalloutWithArgs`), same as any named-with-module pragma.
3. **Cuis-side (new)** — read `Smalltalk vmVersion`, for commit resolution (same as every
   other flow).
4. **Cuis-side (new)** — read `Smalltalk platformName` and `Smalltalk platformSubtype`. On
   this machine: `'Mac OS'` and `'aarch64'`. Both are required here — `module ==
   'SqueakFFIPrims'` is exactly the case this bridge can't resolve from `module` alone (see
   "Required parameters by case" in `functional-spec.md`).
5. **Host-side (new)** — call `get_vm_source(vmVersion, lookupKey:
   'primitiveCalloutWithArgs', module: 'SqueakFFIPrims', platformName: 'Mac OS',
   platformSubtype: 'aarch64')`. The tool resolves the commit SHA and, because the module is
   `SqueakFFIPrims`, skips the conventional path entirely (`SqueakFFIPrims.c` has no
   primitives or exports table at all; see Decisions). Instead it derives the file directly
   from (`platformName`, `platformSubtype`):
   `'Mac OS'` + `'aarch64'` → `src/plugins/SqueakFFIPrims/ARM64AppleFFIPlugin.c`. Checked for
   macOS only (x64/aarch64) — the mapping for Linux, Windows, 32-bit ARM, and RISC-V rests on
   reading the filenames, not a checked `platformSubtype` value on those platforms (see
   Decisions' known gap). Reads that file at the SHA, locates
   `primitiveCalloutWithArgs` inside `ARM64AppleFFIPlugin_exports` (not
   `SqueakFFIPrims_exports` — that array doesn't exist), and returns that function with its
   context (see "Response shape" under Decisions).

Steps 1, 3, and 4 touch the live image. The rest is internal to the host-side tool.

## Decisions

- **Mirror location**: a single bare mirror at `~/.cuis-mcp-bridge/vm-mirror`, shared across
  every Cuis project's MCP server instance, created by `setup_vm_mirror` (see "Mirror
  creation" below). It is intentionally
  separate from any project-local `opensmalltalk-vm/` checkout used for actually building the
  VM — the two are never the same clone, so neither can disturb the other.
- **Mirror creation: a separate `setup_vm_mirror` tool that clones in the background.** The
  first clone is large: 742 MB, 1m35s measured. Doing it inside a `get_vm_source` call would
  risk the MCP client's tool-call timeout. So:
  - `get_vm_source` never clones. With no mirror it returns `mirror_missing`, naming
    `setup_vm_mirror` so the assistant knows what to call. While a clone is running it
    returns `mirror_initializing`.
  - The clone is a full bare clone of every branch, as measured (742 MB, 39 branches), even
    though only `Cog` is ever searched or refreshed. A `--single-branch --branch Cog` clone
    would probably be smaller; it hasn't been measured, and is left for later.
  - `setup_vm_mirror` takes no parameters and returns one of three statuses: `ready` (the
    mirror already exists; nothing to do), `in_progress` (a clone is already running, from
    this bridge or another), or `started` (it just started one).
  - **Readiness check.** The mirror counts as ready only if `~/.cuis-mcp-bridge/vm-mirror`
    exists. The clone goes into a temporary sibling directory
    (`~/.cuis-mcp-bridge/vm-mirror.tmp-<pid>`) and is renamed to `vm-mirror` only once it
    has finished. The rename is atomic, so a half-finished clone is never mistaken for a
    ready mirror.
  - **Concurrent setup.** Two bridges calling `setup_vm_mirror` at the same moment are
    serialized by a lock file, `~/.cuis-mcp-bridge/vm-mirror.lock`, created exclusively and
    holding the cloning process's PID. A second caller sees the lock and returns
    `in_progress`. Git's ref lockfiles (see Concurrency below) protect fetches into an
    existing repository, not two `git clone`s into the same path, which is why this lock is
    needed.
  - **Stale lock.** The lock holds the cloning process's start time as well as its PID. If
    no process with that PID is running, or one is running but started at a different time
    (macOS reuses PIDs, so an unrelated process can inherit a crashed clone's PID), the lock
    is stale. The next `setup_vm_mirror` call then removes the lock and the temporary
    directory, and starts over. Checking the PID alone would leave a crashed clone's lock
    looking held for as long as the unrelated process lives, with every call returning
    `in_progress`.
  - **Failure.** If the background clone fails, the temporary directory and the lock are
    removed and the error is recorded in `~/.cuis-mcp-bridge/vm-mirror.error`. The next
    `setup_vm_mirror` call reports it, clears it, and does nothing else; calling again
    retries. Until then `get_vm_source` keeps returning `mirror_missing`. The reported code
    depends on the cause: `fetch_failed` if git's error text shows upstream couldn't be
    reached (DNS failure, connection refused, timeout), and `mirror_write_failed` for
    anything else, such as a full disk or an unwritable `~/.cuis-mcp-bridge`. Git has no
    separate exit code for these, so the tool decides from git's error text. Text it doesn't
    recognise as a network error becomes `mirror_write_failed`, so a local problem is never
    reported as a network one. Both messages include git's own text. The recorded error
    keeps the code and the text. The same classification applies to a fetch inside
    `get_vm_source` (see the error taxonomy).
- **Why bare, not a working-tree clone copied to scratch (à la `.headless-base/`)**: that
  pattern exists to protect against an operation that *mutates* files (booting an image writes
  to it). Reading a blob via `git show <sha>:path` is non-mutating by construction — there is
  no working tree to protect, so there is nothing to copy before each use.
- **Version resolution mechanism: pickaxe search on the core-interpreter files, not
  commit-message grep, not tags.** `opensmalltalk-vm` has no tags for VMMaker versions. Each
  generation commit is titled `"CogVM source as per VMMaker.oscog-eem.<M>"`, but `<M>` is the
  newest revision in that generation run, not the interpreter's own. Checked against the
  bundled `CuisVM.app`: it reports `.3738`, and no commit message in the whole history mentions
  `.3738`. The binary was built from `759d8f204` ("… as per VMMaker.oscog-eem.**3739**"), whose
  files match every version stamp in the binary: `cointerp.c` `.3738`, `cogitARMv8.c`
  `.3724`, `SocketPlugin.c` `.3739`, `FilePlugin.c` `.3735`. So the original commit-message
  grep would have returned `commit_not_found` for the VM actually in use.

  Instead, the tool searches file contents on the main branch: `git log Cog
  -S'VMMaker.oscog-eem.<N>]' -- 'src/*/cointerp.c' 'src/*/interp.c'`. It searches `Cog`, not
  `--all`, because the mirror has 39 branches, and side branches (e.g. `virtend`) re-introduce
  the same interpreter strings (see "Multiple pickaxe results" below). `Cog` is the mirror's
  default branch, and `759d8f204` is on it. The trailing `]` anchors the match to the end of the
  `interpreterVersion` string, so `.3738` can't match `.37380`. Restricting the search to the
  core-interpreter files keeps plugin stamps that happen to share the number from matching.
  Searching every variant file, not just the one the case resolves to, means the
  named-with-module case (which has no `platformSubtype`) needs no file derivation for this
  step. Pickaxe returns the commits where the string's occurrence count changes: the one that
  introduced it and, if any, the one that replaced it. The tool takes the **oldest** result,
  the commit that introduced it. For `.3738` that returns `759d8f204` (introduced) and
  `2fa5409d7` (replaced by `.3743`).

  Measured on a full bare clone (742 MB, 1m35s to clone): 4.9–5.9 s on `Cog` across all
  core-interpreter files (6.1 s with `--all`), versus 0.08 s for a commit-message grep.
  There's no token → commit cache for now, so every lookup pays this cost. A cache would be
  safe to add later, since a token resolved on `Cog` always maps to the same commit.

  **Fetching must name its refspec.** A bare clone (`git clone --bare`) records no fetch
  refspec, so a plain `git fetch origin` only writes `FETCH_HEAD` and leaves `refs/heads/Cog`
  where it was. Verified on a throwaway origin: after a new upstream commit, `Cog` stayed put
  after `git fetch origin` and moved after `git fetch origin +refs/heads/Cog:refs/heads/Cog`.
  With a plain fetch the pickaxe search on `Cog` would never see new commits, and every VM
  newer than the clone would end in `commit_not_found`. So the tool always fetches with
  `+refs/heads/Cog:refs/heads/Cog` and doesn't rely on the clone's configuration. It
  refreshes only `Cog`, the one branch searched.

  **Worst-case latency of one `get_vm_source` call**, measured on the full mirror: a pickaxe
  search that finds nothing takes 6.8 s; a fetch with nothing new takes 0.6 s; reading a
  plugin's stamp at one commit takes about 0.02 s, so the stamp-guided walk through a window
  is negligible. A token missing from the mirror therefore costs about 6.8 s (miss) + a
  fetch + up to 6.8 s (second search), roughly 14 s plus the transfer time for new commits,
  which wasn't measured. If another bridge holds the fetch lock, the retries (see
  Concurrency) can add up to about 5.6 s. The MCP client's tool-call timeout isn't known;
  `setup_vm_mirror` exists because the first clone alone (1m35s) would exceed any plausible
  one.

  **The window, measured.** Every commit from the introducing one up to, but not including,
  the replacing one contains the same interpreter string. A VM built from any of them reports
  the same `vmVersion`. Walking `Cog`'s full history: 381 `src/` commits carry 215 distinct
  interpreter strings, and in **47 of those 215 windows** (22%) plugins changed after the
  introducing commit. For example, `.3719` was introduced on 2025-12-28 (`0750af2af`), and
  plugins then changed on Dec 30, Jan 3, Jan 4 and Jan 6. A VM built on Jan 6 reports
  `.3719`, but the introducing commit holds Dec 28's plugin source. Core-interpreter lookups
  are unaffected, since the interpreter file is the same throughout a window by definition.
  The bundled VM's `.3738` window is a single commit (`759d8f204`), so it's exact.

  **Narrowing the window for plugin lookups.** When the caller passes `moduleStamps` (see
  "Optional plugin stamp check" below), the tool walks the window's commits and picks the
  oldest one whose plugin `moduleName` matches the live stamp, instead of the introducing
  commit. Without `moduleStamps` it uses the introducing commit.

  **A stale mirror can hide the right commit.** The window is read from the local mirror. If
  the mirror was cloned before upstream added more commits under the same token, a VM built
  from one of the later commits has no match locally, and the stamp check would report a
  `mismatch` that is really just the mirror being out of date. So when `moduleStamps` is
  given, the VM reports a stamp for that plugin, and no window commit matches, the tool
  fetches once (`+refs/heads/Cog:refs/heads/Cog`,
  see "Fetching must name its refspec") and walks the window again. If there's still no match
  it falls back to the introducing commit and reports the stamp check result as usual. The
  refresh happens at most once per call. If the fetch fails, the call fails with
  `fetch_failed`, like every other network failure, even though the introducing commit
  would have given a source to return. The cost is that an offline user doing a plugin
  lookup with `moduleStamps` gets `fetch_failed` instead of a `mismatch` warning whenever
  no local commit matches; a lookup whose stamp matches locally still needs no network.

  **Remaining gap**: without `moduleStamps`, or for an external plugin that hasn't loaded
  yet, a plugin lookup in one of those 47 windows may show older plugin source than the VM
  runs.
- **Concurrency**: reads against the mirror are always safe, with no coordination needed —
  git objects are content-addressed and immutable. Concurrent `git fetch` calls from different
  sessions are protected from corruption by git's own ref lockfiles; a losing fetch fails
  cleanly rather than corrupting anything. The tool treats a lock-contention error as
  retryable — it retries commit resolution (the commit it needed was likely just brought in by
  the winning fetch) rather than surfacing the lock error as a hard failure. Retry budget: 5
  retries with backoff from 500 ms up to 2 s (0.5, 0.7, 1, 1.4, 2 s, about 5.6 s in
  all). After the fifth retry fails, the call returns `mirror_busy`.
- **Numbered-primitive path resolution**: derive the core-interpreter file from two live-image
  facts — `Smalltalk vmVersion`'s bracketed family tag and `Smalltalk platformSubtype` for bit
  width — then default to the plain `cog` variant whenever `cog`/`cog.lowcode`/`sista` remain
  ambiguous after that. `platformSubtype` is reused rather than introducing a second signal
  (it's already required for the `SqueakFFIPrims` exception below); an earlier version of
  this design used `SmallInteger maxVal` instead, dropped because this bridge has no
  capability to evaluate an arbitrary expression and return its value — only
  `platformSubtype`, an existing structural-reflection call, actually works. Accepted because
  276 of the 285 shared primitive bodies are identical across the three candidates; the 9
  that differ are JIT-related, and the bundled VM is verifiably not Sista (see "How big the
  gap is, measured" under Numbered primitives). (On macOS specifically, this 3-way is actually 2-way: the
  `building/macos64ARMv8` build directories only offer `squeak.cog.spur` and
  `squeak.sista.spur` — no `cog.lowcode` variant is even built there.)
- **Plain vs. `gcc3x-`-prefixed file — two separate questions, resolved differently.**
  Diffing `cointerp.c` against `gcc3x-cointerp.c` shows every difference confined to the
  bytecode dispatch loop (`gcc3x-` adds GCC register-variable hints and computed-goto
  `CASE`/`BREAK` macros in place of a plain `switch`) — individual primitives are untouched.
  Checked on two structurally different primitives, not just one: `primitiveAdd`
  (`SmallInteger>>+`, arithmetic) and `primitiveClass` (`Object>>class`, an object-header
  read, `<primitive: 111>`) — both byte-identical between the two files. That byte-for-byte
  equivalence is what makes the two questions below separable. This decision is only about
  *which file to read* — it says nothing yet about which one gets shown to the user. That's
  its own decision, right below.
- **Resolving which file the VM actually compiled from** (only needed when the actual file is
  requested — see below). Determined live, not assumed: query `Smalltalk platformName` first
  — `'Mac OS'`/`'unix'` means `gcc3x-`, confirmed by build-config evidence
  (`platforms/unix/vm/Makefile.in`, `building/macos64ARMv8/squeak.cog.spur/deps/gcc3x-cointerp.d`,
  `building/macos64ARMv8/HowToBuild:268`). There's no fallback for when no image is
  connected: every flow already needs a live image for `vmVersion`, so the image is always
  available to ask.
- **`'Win32'` is unsupported for now.** Its Makefiles select the core-interpreter source
  through a variable/pattern rule that doesn't show up by grepping for `cointerp`. The build
  comments also mention an LLVM/Clang toolchain, which supports the same GCC extensions, so
  "Windows → plain" can't be assumed either. On top of that, the `SqueakFFIPrims` mapping for
  Windows (`X64Win64FFIPlugin.c`) hasn't been checked. So whenever `platformName` is
  `'Win32'`, `get_vm_source` returns `unsupported_platform` before any git operation, instead
  of guessing a file.
- **Stack VMs are unsupported for now, for core-interpreter lookups only.** When `module` is
  omitted and `vmVersion` is a Stack VM string (`Open Smalltalk Stack VM […]`),
  `get_vm_source` returns `unsupported_platform` before any git operation. The reason is the
  variant ambiguity described under "Deriving the file" above. Cuis ships a Cog VM, so this
  doesn't affect the bundled setup. Named-with-module lookups aren't affected: plugin files
  live under `src/plugins/` regardless of the VM family, and commit resolution already
  searches `src/*/interp.c` as well as `cointerp.c`. Tracked in `TODO.md`.
- **Assistant default: show the plain file, say so, switch to the actual file on request.**
  This is the behavioral rule the whole plain/`gcc3x-` investigation exists to support, so it
  gets stated on its own: by default, when explaining a primitive, the assistant shows the
  **plain file** — simpler to read, and verified identical to the actual build for primitive
  bodies specifically (see above). It must be explicit about this (e.g. "showing the
  standard-C source; the actual build may use the GCC-optimized file, same primitive body"),
  never silently present the plain file as if it were the exact compiled source. If the user
  asks for the real/actual file, the assistant resolves and shows that one instead, using the
  mechanism above. The default applies only to primitive bodies — not if the user asks about
  the bytecode dispatch loop itself, where the two files genuinely differ.
- **Function lookup differs by pragma kind, and happens inside the tool, not the caller.**
  Named primitives (`lookupKey` a string) are found by searching the resolved file for that
  string inside a `<Module>_exports` array; numbered primitives (`lookupKey` a number) are
  found by positional index into `primitiveTable[...]` — two distinct lookups, not one
  mechanism parameterized by pragma kind, both performed by `get_vm_source` itself so the
  caller never sees or searches a whole file.
- **Response shape: enough context to explain the primitive, not just the function's lines.**
  The goal is that the assistant can answer from one `get_vm_source` call, without a second
  lookup. Checked against two primitives at `759d8f204`:
  `primitiveSocketReceiveDataAvailable` (`SocketPlugin.c`) and `primitiveAdd`
  (`spur64.cog/cointerp.c`). Both have their Slang helpers already inlined, marked with
  `/* begin socketValueOf: */`-style comments. But `primitiveAdd` calls `stackIntegerValue`,
  defined 51k lines further down, which holds the SmallInteger check and the failure path.
  And the socket primitive's real work happens in `sqSocketReceiveDataAvailable`, platform
  code that isn't in the file at all. So the response contains:
  - **`function`** — the full body, from the `/* Class>>#selector */` comment immediately
    above the signature through the closing `}`. Generated files end every function body
    with a `}` at column 0, which gives a dependable stopping point. Checked across every
    `.c` file under `src/` at `759d8f204` (136 files, 26,751 functions, 931 of them with
    `#if` inside the body): braces balance at the first column-0 `}` in every one, counting
    braces outside strings, character literals and comments. Preprocessor branches inside
    a body never contain a column-0 `}` of their own.
  - **`generatedFrom`** — the VMMaker method named in that comment (e.g.
    `InterpreterPrimitives>>#primitiveAdd`, `SocketPlugin>>#primitiveSocketReceiveDataAvailable:`),
    so the assistant knows the C is generated, and from what. Checked across every `.c`
    file under `src/` at `759d8f204`: all 26,751 functions have this comment directly above
    the signature, so `generatedFrom` is always present.
  - **`helpers`** — the bodies of functions defined in the same file that the function calls,
    one level deep only, to keep the response bounded. For `primitiveAdd` that means
    `stackIntegerValue`. There's no cap on the number or size of helpers for now.
  - **`externalCalls`** — names only of called functions not defined in the file, each tagged
    either *VM interface* (a function-pointer declaration in the plugin, e.g.
    `static sqInt (*stackValue)(sqInt offset);`) or *platform code, not available* (e.g.
    `sqSocketReceiveDataAvailable`; reading it is the `vm-source-platform-paths` TODO). The
    assistant can then say where the real work happens even when it can't show it.
  - **Metadata** — the resolved commit SHA, the file path and the function's line range;
    the dispatch entry (the `_exports` row, or the `primitiveTable` slot); and every default
    the tool applied (plain vs. `gcc3x-`, `cog` chosen over `cog.lowcode`/`sista`), so the
    assistant can state the caveats the "say so" rule above requires.
  - **`caveats`** — the same facts as ready-made plain sentences, so the assistant doesn't
    have to assemble them from metadata fields. One entry for each applied default or raised
    warning: the `cog` default over `lowcode`/`sista`, plain vs. `gcc3x-` rendering, a shared
    dispatcher, and a `mismatch` or `not_verifiable` stamp check. It is an empty array when
    there is nothing to say. An MCP server can only steer the assistant through its tool
    descriptions and the response itself, so this is the mechanism behind the "Assistant
    default" rule: the `get_vm_source` tool description tells the assistant to state the
    caveats and never to present a defaulted source as the exact compiled one. Example
    entry: "Showing the standard-C rendering of the core interpreter; the actual build may
    use the GCC-optimized file, with the same primitive body."

  Deliberately left out: macros such as `GIV`, `longAtput` and `DECL_MAYBE_SQ_GLOBAL_STRUCT`.
  They're standard VM plumbing, and including them would add noise without helping explain
  any particular primitive.
- **Optional plugin stamp check, reported as a warning, never an error.** Resolving everything
  from the core `vmVersion` assumes every plugin came from that same commit. An external
  `.bundle` can be replaced independently, though, and then the tool would show the wrong
  source without noticing. Each plugin embeds a `moduleName` stamp
  (`static const char *moduleName = "SocketPlugin VMMaker.oscog-eem.3739 " INT_EXT;`), and
  the running VM reports the same strings. Verified live on an isolated headless boot of the
  bundled VM:
  - `Smalltalk listBuiltinModules` returned all 35 compiled-in plugins, e.g.
    `'SocketPlugin VMMaker.oscog-eem.3739 (i)'`.
  - `Smalltalk listLoadedModules` returned the 7 loaded so far, including the one external
    bundle in use, `'VectorEnginePlugin VectorEnginePlugin-jmv.26 (e)'`.
  - The stamps compared against `759d8f204` matched. Those were `SocketPlugin`, `FilePlugin`
    and `FileAttributesPlugin` (`FileAttributesPlugin.oscog-eem.65`, a non-VMMaker stamp),
    plus the external bundles' embedded strings, e.g. `DESPlugin CryptographyPlugins-eem.30`.
    Not all 35 were compared.

  The same comparison also chooses the commit within a pickaxe window, when plugins changed
  after the interpreter string was introduced (see "Version resolution mechanism" above).

  So, when the caller passes `moduleStamps` (the output of `get_loaded_modules`) on a
  named-with-module lookup, the tool reads the `moduleName` string from the resolved file and
  looks for the live entry with the same name. That name is the first word of the
  `moduleName` string, which isn't always the pragma's module: for `SqueakFFIPrims` it is
  e.g. `ARM64AppleFFIPlugin`. The live entry carries an extra ` (i)`/` (e)` suffix, which the
  comparison ignores. The result goes into metadata as `moduleStampCheck`:
  - `match` — the stamps agree.
  - `mismatch` — a live entry with that name exists but carries a different stamp. Both
    values are included, so the assistant can warn that the shown source may not be what's
    running.
  - `not_verifiable` — no live entry with that name. This happens for an external plugin
    the VM hasn't loaded yet (`DESPlugin`, `MD5Plugin` and `SHA2Plugin` weren't listed in
    the headless boot, presumably because nothing had called them), or for a file with no
    `moduleName`.

  Without `moduleStamps`, or for numbered and no-module lookups (where `vmVersion` already
  pins the core file), the check is skipped and `moduleStampCheck` is omitted. A matching
  stamp shows consistency, not proof: package versions like `CryptographyPlugins-eem.30`
  change rarely, so many commits carry the same stamp. `vmVersion`, `platformName` and
  `platformSubtype` stay separate calls (see below), but the two module lists are one call,
  `get_loaded_modules`, because they answer a single question: which plugin stamps the VM
  can report.
- **Numbered slots without a dedicated function.** Not every `primitiveTable` slot names a
  function that implements that primitive. Checked at `759d8f204` (`spur64.cog/cointerp.c`):
  - **Empty slots** — 79 slots hold `(void (*)(void))0`, e.g. `/* 520 */`. A method whose
    pragma names one always runs its Smalltalk fallback code. The lookup itself succeeded,
    so this isn't `symbol_not_found`: the tool returns its own code, `primitive_slot_empty`,
    naming the slot, so the assistant can say the method always runs its Smalltalk fallback.
  - **Quick primitives (256–519)** — slots hold the index cast to a pointer, e.g.
    `/* 264 */ (void (*)(void))264`. The interpreter checks
    `primitiveFunctionPointer <= MaxQuickPrimitiveIndex` and handles them all in one shared
    dispatcher, `externalQuickPrimitiveResponse` (256 returns self, 257 onwards return
    constants such as `true`, 264 and above return instance variable N−264). The tool
    returns that dispatcher as `function`, with metadata marking it as shared and stating
    which branch applies to N. These rarely reach the tool: the compiler generates quick
    primitives automatically for trivial methods like `x ^x`, without any pragma in the
    source, so a caller only meets one through an explicit `<primitive: 264>`-style pragma.
  - **Slot 117, `primitiveExternalCall`** — a real function, but a generic loader: it reads
    the method's literal to find a module and name, then loads that plugin primitive. The
    tool returns it the same way, marked as shared. Smalltalk source normally writes the
    named form (`<primitive: 'name' module: 'X'>`), which the named case already handles, so
    an explicit `<primitive: 117>` is rare.
- **A named primitive with no module composes the other two decisions, rather than needing a
  third mechanism.** `<primitive: 'name'>` (no `module:`) uses the numbered-primitive path
  derivation (it lives in the core-interpreter file) and the named-primitive lookup (a string
  search, here against `vm_exports`, the core file's own exports array with an empty module
  string). Treating "has a module?" as the only branch point, and "named vs. numbered" as a
  second, independent branch point for the lookup step, avoids a parallel third code path.

- **Error taxonomy for the host-side tool**, mirroring the existing bridge's code style
  (`not_found`, `invalid_request`, etc. — see `mcp-bridge/README.md`'s Troubleshooting
  section):
  - `mirror_missing` — no mirror exists and no clone is running; the message names
    `setup_vm_mirror`. Checked before anything else.
  - `mirror_initializing` — a `setup_vm_mirror` clone is still running; call again later.
  - `invalid_request` — the existing bridge's code, reused: `module` is given with a numeric
    `lookupKey`. That combination can't come from a real pragma, since Cuis's
    `Parser>>primitive:module:error:` rejects a non-string name
    (`^ self expected: 'Named primitive'`; checked in the live image). Also returned when
    `moduleStamps` isn't an object with `builtin` and `loaded` arrays of strings. Returned before any git
    operation. The four input checks (`invalid_request`, `version_unparseable`,
    `missing_platform_info`, `unsupported_platform`) run in that order, and the first that
    applies is reported.
  - `git_unavailable` — the host has no usable `git` executable. Returned by both
    `get_vm_source` and `setup_vm_mirror` the first time git is needed, so it never
    surfaces as `fetch_failed` or `mirror_corrupt`. Not checked at startup, because every
    other bridge tool works without git.
  - `version_unparseable` — `vmVersion`'s string doesn't contain a `VMMaker.oscog-eem.<N>`-
    shaped token at all.
  - `missing_platform_info` — a parameter the case requires (per "Required parameters by
    case" in `functional-spec.md`) was omitted; returned before any git operation, naming
    which parameter.
  - `unsupported_platform` — `platformName` is `'Win32'` (whenever it is supplied), or a
    value the case actually uses has no mapping: a `platformName` other than `'Mac OS'` or
    `'unix'`; a `platformSubtype` that maps to no bit width (`module` omitted) or no FFI
    file (`SqueakFFIPrims`); or, with `module` omitted, a Stack VM or a family tag other
    than `Cog[Spur]` or `Cog[SqueakV3]` (see above). The message names the value. Returned
    before any git operation, instead of failing later as a misleading `path_not_found`.
    Values the case doesn't use are still ignored.
  - `module_not_found` — `module` was given but doesn't match a plugin that exists at the
    resolved commit; returned before reading any file.
  - `fetch_failed` — network/git failure actually reaching `origin` (distinct from a fetch
    that succeeds but still finds nothing). The message includes git's own error text.
  - `mirror_write_failed` — a clone (in `setup_vm_mirror`) or a fetch (in `get_vm_source`)
    failed for a reason other than reaching upstream: a full disk, an unwritable
    `~/.cuis-mcp-bridge`, or any git error text not recognised as a network error. The
    message includes git's error text. One code serves both tools, so a local problem is
    never reported as a network one wherever it happens.
  - `commit_not_found` — fetch succeeded (or wasn't needed), but no commit's core-interpreter
    files contain the token.
  - `path_not_found` — the tool's own internally-derived path doesn't exist at the resolved
    commit (e.g. a very old commit with a different repo layout). Rare: since the tool
    derives the path itself from a known, validated `module` (or from the core-interpreter
    convention), this should only fire against commits old enough to predate that layout.
  - `symbol_not_found` — the resolved file exists but `lookupKey` matches no entry in it
    (no row in its `_exports`/`vm_exports` array, or no slot in `primitiveTable`) — never
    conflated with `module_not_found` or `path_not_found`.
  - `primitive_slot_empty` — a numbered `lookupKey` names a `primitiveTable` slot that holds
    no function (`(void (*)(void))0`); the method always runs its Smalltalk fallback (see
    "Numbered slots without a dedicated function" above).
  - `mirror_busy` — the lock-contention retry (see Concurrency above) exhausts its budget
    without succeeding, rather than hanging indefinitely.
  - `mirror_corrupt` — `~/.cuis-mcp-bridge/vm-mirror` exists but git can't read it as a
    valid repository (e.g. partly deleted by hand). The message tells the user to delete the
    directory and call `setup_vm_mirror` again. The tool never repairs or deletes it itself:
    the mirror is shared across projects, so removing it is the user's call. Note that
    `setup_vm_mirror` reports `ready` for a damaged mirror, since readiness only checks that
    the directory exists.
- **Multiple pickaxe results are not an error: auto-resolve to the oldest.** The pickaxe
  search normally returns two commits, the one that introduced the string and the one that
  replaced it. The tool takes the oldest, with no `commit_ambiguous` code and no surfaced
  failure (see Version resolution mechanism above). The search is restricted to `Cog`
  because duplicates are real across branches. Searching `--all` (39 branches) finds 4
  interpreter strings introduced more than once, all from 2022 side branches such as
  `virtend` (e.g. `.3188` five times). With `--all`, "oldest" can even land off the main
  branch: `.3787` resolves to `b0a5f72ae` with `--all`, but to `11e1e4988` on `Cog`. On
  `Cog` alone, a walk of its full history found **no** string introduced twice, so "oldest"
  is unambiguous there. The assumption this adds is that released VMs are built from `Cog`.
  It holds for the bundled VM, and a VM built from a side branch would resolve to the `Cog`
  commit that introduced the same string.
- **No caller-supplied `path` at all — `module` is validated against a known list instead.**
  An earlier version of this design took `path` directly from the caller and validated it as
  a string (reject `..` segments, absolute paths, shell metacharacters) before any git call.
  That's gone: the caller now supplies `module` (a plugin name) and the tool derives the
  actual file path itself, so the injection/traversal surface mostly disappears. What remains
  is validating `module` against the set of plugins that actually exist at the resolved
  commit — anything else is `module_not_found`, returned before reading any file. This also
  closes the gap the redesign was for: forcing every caller (even the 73/74 trivial
  named-with-module cases) to pre-compute an opaque path just to handle the 1-in-74
  `SqueakFFIPrims` exception.

- **Module→path convention checked against all 74 plugins, not just the original 3 — one real
  exception found, and resolved.** `src/plugins/<Module>/<Module>.c` (filename == module name)
  holds for 73 of 74. The exception is `SqueakFFIPrims` (the FFI plugin):
  `SqueakFFIPrims.c` itself declares no primitives and no exports table at all — the real
  primitive bodies and exports arrays live in 7 architecture-specific files in the same
  directory (`ARM32FFIPlugin.c`, `ARM64FFIPlugin.c`, `ARM64AppleFFIPlugin.c`,
  `IA32FFIPlugin.c`, `RiscV64FFIPlugin.c`, `X64SysVFFIPlugin.c`, `X64Win64FFIPlugin.c`), each
  with the same module string (`_m = "SqueakFFIPrims"`) but a differently-named exports array.
  Resolving which one applies needs a second live fact beyond the module name:
  `Smalltalk platformSubtype` — traced to `platforms/iOS/vm/OSX/sqSqueakOSXApplication+attributes.m`
  on macOS (a different file entirely from the generic Unix path initially checked), a
  compile-time branch returning `"x64"` on Intel or `"aarch64"` on Apple Silicon. Confirmed
  two ways: statically, via `lipo`-extracting each architecture slice of the bundled
  `Cuis7-8-main/CuisVM.app` binary and finding each literal string present only in its
  matching slice; and directly, by booting a real headless image via
  `tools/run-headless-tests.sh` and evaluating `Smalltalk platformSubtype` live (returned
  `aarch64`, matching this machine). Combined with `platformName` (already in use for the
  plain/`gcc3x-` question), this resolves the exception for macOS: e.g. `aarch64` + `'Mac OS'`
  → `ARM64AppleFFIPlugin.c` specifically, not the generic `ARM64FFIPlugin.c`. **Known gap**:
  only macOS's `platformSubtype` values (`'x64'`, `'aarch64'`) were actually checked, against
  the Obj-C implementation and a live boot. The mapping for Linux, Windows, 32-bit ARM, and
  RISC-V — i.e. which string `platformSubtype` returns there, and which of
  `ARM32FFIPlugin.c`/`IA32FFIPlugin.c`/`RiscV64FFIPlugin.c`/`X64Win64FFIPlugin.c`/generic
  `ARM64FFIPlugin.c` it should map to — rests on reading filenames, not a checked value.
- **`vmVersion`, `platformName`, and `platformSubtype` stay three separate Cuis-side calls,
  not one bundled "VM build info" call.** Considered combining them to save round trips (most
  flows need two or three of them together), but kept separate: matches the existing bridge's
  one-call-per-fact style (`list_categories`, `get_method_source`, etc. are all single-purpose
  too), and most flows don't need all three — bundling would mean every caller pays for facts
  it doesn't need.
- **A second, independent VMMaker revision exists for the Cogit JIT backend, not just the
  core interpreter.** Surfaced while checking `cogitClass` as a candidate signal (ruled out —
  its string carries no architecture-specific content, just a generator class name, uuid, and
  build date). Live-booted value: `cogitClass` reports `VMMaker.oscog-eem.3724`, while
  `vmVersion` reports `.3738` on the same running VM, so the Cogit backend and the core
  interpreter were generated by different VMMaker revisions. They still live in the **same git
  commit**, though: at `759d8f204`, `cogitARMv8.c` carries `.3724` and `cointerp.c` carries
  `.3738`. So once `vmVersion`'s token is resolved to that commit (see Version resolution
  mechanism), the matching JIT-backend source is also there. This doesn't affect any case this
  initiative covers, since none of the three pragma scenarios reach into the Cogit backend
  files (e.g. `cogitX64SysV.c`).
