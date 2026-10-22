# OpenSmalltalk VM — architecture notes

Everything below was learned by direct inspection (reading source, diffing files, grepping
build configs, and booting a real headless image via `tools/run-headless-tests.sh`) while
designing `initiatives/vm-source-primitive-lookup`. It's general knowledge about the VM
project's structure, not specific to that initiative, so it lives here instead.

## The C source is generated, not hand-written

`opensmalltalk-vm/src/*.c` is generated from a Smalltalk model (VMMaker) via Slang, the
Smalltalk-to-C translator — see `vm-exploration/docs/PluginManual.md` for the canonical
VMMaker/Slang workflow vs. the hand-written-plugin shortcut. Generated files carry their
provenance as an embedded string, e.g.:

```c
const char *interpreterVersion = "Open Smalltalk Cog[Spur] VM [CoInterpreterPrimitives VMMaker.oscog-eem.3794]";
```

There are no git tags for VMMaker versions. Generation commits are titled `"CogVM source as
per VMMaker.oscog-eem.<M>"`, but `<M>` is the newest revision in that generation run, which
can be newer than the interpreter's own. For example, `759d8f204` is titled `.3739`, while its
`cointerp.c` says `.3738`, and no commit message mentions `.3738` at all. To pin an
`interpreterVersion` to a commit, search file contents instead:
`git log Cog -S'VMMaker.oscog-eem.<N>]' -- 'src/*/cointerp.c' 'src/*/interp.c'`. The oldest
result is the commit that introduced it. That takes about 5–6 s on a full bare clone. Search
`Cog`, not `--all`: of the repo's 39 branches, 2022 side branches such as `virtend`
re-introduce the same interpreter strings, while `Cog` has none introduced twice.

One interpreter string usually spans several commits, because plugins can be regenerated
without regenerating the core. On `Cog`, 47 of 215 interpreter strings span later plugin
changes. A plugin's own `moduleName` stamp, which the running VM reports via
`Smalltalk listLoadedModules` / `listBuiltinModules`, tells those commits apart.

**The VM isn't generated from one single version number.** Different subsystems can come from
different VMMaker revisions in the same build — confirmed live: on one running VM, `Smalltalk
vmVersion` reported `VMMaker.oscog-eem.3738` (the core interpreter) while `Smalltalk
cogitClass` reported `VMMaker.oscog-eem.3724` (the Cogit JIT backend). Plugins carry their
own stamps too: the same binary has `SocketPlugin` at `.3739`, `FilePlugin` at `.3735`, and
others as old as `.3475`. These stamps record when each file was last regenerated. They
don't point to different git commits: all of them sit together in one commit (`759d8f204`
for that binary), so a single commit pins the whole build's source.

## Source tree layout

```
opensmalltalk-vm/
├── src/
│   ├── plugins/                        — 74 plugin directories
│   │   ├── SocketPlugin/
│   │   │   └── SocketPlugin.c          — primitives + SocketPlugin_exports table
│   │   ├── FilePlugin/
│   │   │   └── FilePlugin.c
│   │   └── SqueakFFIPrims/              — the one exception (see below)
│   │       ├── SqueakFFIPrims.c         — shared glue only, no primitives, no exports table
│   │       ├── ARM64AppleFFIPlugin.c    — primitives + its own *_exports table
│   │       ├── X64SysVFFIPlugin.c       — ditto, different CPU/ABI
│   │       └── ...                      — 5 more, one per CPU/ABI
│   ├── spur64.cog/                      — core interpreter, one of 12 variant dirs
│   │   ├── cointerp.c                   — plain C rendering
│   │   └── gcc3x-cointerp.c             — same logic, GCC-extension rendering
│   ├── spur64.cog.lowcode/
│   ├── spur64.sista/
│   ├── spur64.stack/
│   └── ...                              — spur32.*, v3.cog, v3.stack, etc.
├── platforms/
│   ├── unix/vm/sqUnixMain.c             — getAttributeString() for generic Unix/X11
│   └── iOS/vm/
│       ├── Common/Classes/sqSqueakAttributesAPI.m   — trampoline into Obj-C delegate
│       └── OSX/sqSqueakOSXApplication+attributes.m  — actual macOS getAttribute: switch
└── building/
    └── macos64ARMv8/
        ├── squeak.cog.spur/Makefile     — builds from src/spur64.cog/
        ├── squeak.sista.spur/Makefile   — builds from src/spur64.sista/
        └── HowToBuild                   — states explicitly which file each target compiles
```

- `src/plugins/<Module>/<Module>.c` — one directory per plugin, 74 total. 73 of them put every
  primitive and the module's exports table directly in `<Module>.c`.
- `src/<variant>/` — the core interpreter, in 12 variant directories: `v3.cog`, `v3.stack`, and
  `spur32`/`spur64` crossed with `cog`/`cog.lowcode`/`sista`/`stack`/`stack.lowcode`. Each
  variant directory has the same interpreter logic rendered as **two** near-duplicate files —
  see "Plain vs. `gcc3x-`" below.
- `platforms/<os>/` — platform glue (window system, file I/O, process/signal handling). Not
  uniform across OSes — see "Live system attributes" below for how differently two platforms
  can implement the *same* Smalltalk-visible API.
- `building/<platform><arch>/squeak.<variant>.spur/` — one build directory per platform per
  variant (e.g. `building/macos64ARMv8/squeak.cog.spur/`), each a thin Makefile including a
  shared fragment (`Makefile.app.squeak.cog`, etc.) from `building/<platform>/common/`.
  `building/<platform>/HowToBuild` documents, in prose, exactly which source file that
  directory compiles — the most reliable way to confirm which variant/file a given platform
  actually uses, better than inferring it.

## Named primitives: the `_exports` table

Every plugin file declares a static array, the VM's own runtime lookup table for named
primitives:

```c
static char _m[] = "SocketPlugin";
void* SocketPlugin_exports[][3] = {
	{(void*)_m, "getModuleName", (void*)getModuleName},
	...
	{(void*)_m, "primitiveSocketReceiveDataAvailable\000\001\000", (void*)primitiveSocketReceiveDataAvailable},
	...
```

Each row is `{module name, primitive name string, function pointer}`. A Smalltalk pragma like
`<primitive: 'primitiveSocketReceiveDataAvailable' module: 'SocketPlugin'>` is resolved by the
VM searching exactly this array for a matching name string. The pragma's name string is an
**exact** match to the C function name — no naming transformation (verified across three
plugins: `SocketPlugin`, `FileAttributesPlugin`, `FilePlugin`).

**The core interpreter file has its own version of this same table**, `vm_exports`, with the
module string left empty (`static char _m[] = "";`). This is what backs a named primitive with
**no** `module:` keyword at all, e.g. `<primitive: 'primitiveImageFormatVersion'>` →
`SystemDictionary>>imageFormatVersion`. Same lookup mechanism as a plugin's `_exports`, just
living in the interpreter file instead, under an empty module name meaning "the VM itself."

## Numbered primitives: the `primitiveTable`

Primitives with no name at all — `<primitive: 1>` style — are dispatched differently: by
position, not by string match. The core interpreter file declares:

```c
static void (*primitiveTable[MaxPrimitiveIndex + 2])(void) = {
	/* 0 */ (void (*)(void))0,
	/* 1 */ primitiveAdd,
	/* 2 */ primitiveSubtract,
	...
```

`<primitive: 1>` on `SmallInteger>>+` means "call `primitiveTable[1]`," full stop — no module,
no string lookup, just an index into this one array.

## One plugin breaks the "filename == module name" rule: `SqueakFFIPrims`

Out of all 74 plugins, exactly one doesn't follow `src/plugins/<Module>/<Module>.c`:
`SqueakFFIPrims.c` itself declares zero primitives and no exports table. The actual bodies and
exports arrays live in 7 architecture-specific files in the same directory —
`ARM32FFIPlugin.c`, `ARM64FFIPlugin.c`, `ARM64AppleFFIPlugin.c`, `IA32FFIPlugin.c`,
`RiscV64FFIPlugin.c`, `X64SysVFFIPlugin.c`, `X64Win64FFIPlugin.c` — each with the *same* module
string (`_m = "SqueakFFIPrims"`), differentiated only by which CPU architecture/ABI they
implement. The module name alone can't tell you which file; you need the image's actual CPU
architecture too (see `platformSubtype` below).

## Plain vs. `gcc3x-`-prefixed core interpreter files

Every core-interpreter variant directory generates **two** files for the same logic:
`cointerp.c`/`interp.c` (plain, portable C) and `gcc3x-cointerp.c`/`gcc3x-interp.c` (the same
logic, using GCC-only extensions: register-variable hints and computed-goto `CASE`/`BREAK`
macros instead of a plain `switch`, for the bytecode dispatch loop specifically). Every other
diff between the two files — including every individual primitive body — is identical;
checked on two structurally different primitives (`primitiveAdd`, arithmetic; `primitiveClass`,
an object-header read), both byte-for-byte the same in both files.

Build configs confirm Unix/macOS always compile the `gcc3x-` file, never the plain one
(`platforms/unix/vm/Makefile.in`, `platforms/unix/config/configure`, every macOS build
directory's `deps/gcc3x-cointerp.d`, explicit in `building/macos64ARMv8/HowToBuild:268`).
Windows is genuinely unclear from this checkout — its Makefiles select the source file through
a variable/pattern rule that doesn't show up by grepping for `cointerp`, and the build comments
mention an LLVM/Clang toolchain even there (which also supports these GCC extensions), so
"Windows → plain" can't be assumed.

## `cog` / `cog.lowcode` / `sista`: not always distinguishable

For a given word size and interpreter family (e.g. 64-bit `Cog[Spur]`), three variant
directories can apply: `spur64.cog`, `spur64.cog.lowcode`, `spur64.sista`. Nothing the image
exposes distinguishes which one a given VM was actually built from. A build-variant marker
(`EncoderForSistaV1`) that looked promising turned out to be present in all three.

The compiled binary does tell Sista apart, though, because exported primitive names survive
in a release binary as strings. `spur64.sista` exports two names the others don't
(`primitiveResetCountersInMethod`, `primitiveSistaMethodPICAndCounterData`). Both are absent
from the bundled `CuisVM.app`, while a control export (`primitiveImageFormatVersion`) is
present, so that VM is not Sista. `cog` and `cog.lowcode` export the same 66 names, so
nothing tells those two apart.

Comparing every primitive body across the three files at `759d8f204`: 276 of the 285 shared
primitives are byte-identical. The 9 that differ are JIT-related: the closure-value family
(`primitiveClosureValue*`, `primitiveFullClosureValue*`), `primitiveInvokeObjectAsMethod`,
`primitiveMethodXray` and `primitiveVMParameter`. For example, Sista adds an "optimized
method" check before deciding whether to compile a block. So defaulting to plain `cog` is
exact for the vast majority, and wrong only in JIT-related details of those 9, on a
`lowcode` or `sista` VM.

On macOS specifically, this is actually a 2-way choice, not 3-way: the
`building/macos64ARMv8` (and `win64x64`) build directories only offer `squeak.cog.spur` and
`squeak.sista.spur` — no `cog.lowcode` variant is even built there. `lowcode` (no native JIT
code generation) appears to be for platforms that disallow a JIT, like iOS.

## Live system attributes: `Smalltalk getSystemAttribute:`

The image can introspect its own VM/platform at runtime through one primitive, indexed by
number, with friendly Smalltalk wrapper selectors already defined on `SystemDictionary`:

| Index | Selector | Returns |
|---|---|---|
| 1001 | `platformName` | OS family: `'Mac OS'`, `'unix'`, `'Win32'` |
| 1002 | `osVersion` | OS version string |
| 1003 | `platformSubtype` | CPU architecture: e.g. `'x64'`, `'aarch64'` on macOS |
| 1004 | `vmVersion` | the `interpreterVersion` string (VMMaker token) |
| 1007 | `interpreterClass` | build info, Cog VMs only |
| 1008 | `cogitClass` | Cogit JIT backend build info (own VMMaker revision — see above) |

**The same Smalltalk-level API is implemented completely differently per platform family.**
On generic Unix/X11, `getAttributeString` is a plain C `switch` in
`platforms/unix/vm/sqUnixMain.c`, e.g. `case 1003: return VM_TARGET_CPU;` (an autoconf
`configure`-time macro). On macOS/iOS, it's a trampoline
(`platforms/iOS/vm/Common/Classes/sqSqueakAttributesAPI.m`) into an Objective-C app-delegate
method (`platforms/iOS/vm/OSX/sqSqueakOSXApplication+attributes.m`), with its own `switch` and
its own compile-time branches, e.g.:

```objc
case 1003: { /* processor architecture */
# if __x86_64__
    return "x64";
# elif __arm64__
    return "aarch64";
# endif
}
```

These are baked in per architecture slice of a universal binary — verified on the actual
bundled `Cuis7-8-main/CuisVM.app` (a Mach-O universal binary, x86_64 + arm64) by `lipo
-thin`-extracting each slice and confirming each literal string (`"x64"`, `"aarch64"`) appears
only in its matching slice — and directly, by booting a real headless image and evaluating
`Smalltalk platformSubtype`, which returned `aarch64` on this machine.

## Verification method, as a takeaway

Reverse-engineering from source and `strings`-ing the binary works, but booting a disposable
headless image via `tools/run-headless-tests.sh` and evaluating the actual Smalltalk
expression is strictly more direct and authoritative when it's an option — it was available
the whole time and should be the first move, not a fallback after static analysis.
