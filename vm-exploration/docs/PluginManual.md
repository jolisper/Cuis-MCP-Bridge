# Writing a minimal external VM plugin

A brief, practical manual for the hand-written approach we used for
`DummyPlugin` (C) and `DummyPluginZig` (Zig) — writing directly against the
VM's proxy ABI instead of going through VMMaker/Slang.

## Two ways to write a plugin

**The canonical way** — how the VM's own maintainers develop plugins, per the
opensmalltalk-vm README — is to write the primitive in Smalltalk, inside a
VMMaker development image, and let **Slang** (VMMaker's Smalltalk-to-C
translator) generate the `.c` file for you. See [VMMaker](http://source.squeak.org/VMMaker.html)
in Links below. This is the right choice for a plugin meant to be maintained
long-term or upstreamed.

**The hand-written way** — what this manual covers — is writing the `.c` file
directly against `sqVirtualMachine.h`, modeled on an existing plugin. It skips
fetching/building a whole separate VMMaker image and learning Slang, at the
cost of writing (and getting right) the generated-looking C by hand. That
tradeoff made sense here: a minimal, throwaway primitive to explore the
VM/image boundary, iterated as fast as possible — not a plugin meant to last.
If you're building something you intend to keep or contribute upstream, start
with VMMaker instead.

## The three things every plugin needs

An external plugin is a `.c` file at `opensmalltalk-vm/src/plugins/<Name>/<Name>.c`,
built as its own loadable bundle. It needs exactly three exported functions:

```c
const char* getModuleName(void);                          // identifies the module
sqInt setInterpreter(struct VirtualMachine *anInterpreter); // binds proxy fn pointers
sqInt primitiveYourThing(void);                            // the primitive itself
```

`setInterpreter` is called once, when the VM loads the bundle. Its only job is
to copy the function pointers you need off `interpreterProxy` into your own
statics — every VM service (reading arguments, allocating objects, returning a
value) is reached through this proxy table, never called directly:

```c
static sqInt (*methodArgumentCount)(void);
...
methodArgumentCount = interpreterProxy->methodArgumentCount;
```

Declare each primitive's calling convention with a `Metadata` short (arg count
encoded as `0x1` per arg in the low byte-ish; copy the value from a similar
existing primitive rather than deriving it — `-255` for zero-arg "always
available"-style primitives, `0x101` for one real argument; see `DESPlugin.c`
and `MD5Plugin.c` for more shapes):

```c
#if SPURVM
EXPORT(signed short) primitiveYourThingMetadata = 0x101;
#endif
```

Full reference: `opensmalltalk-vm/platforms/Cross/vm/sqVirtualMachine.h` — every
proxy function's exact signature lives there. The proxy functions we actually
used, as a starting vocabulary:

| Function | Purpose |
|---|---|
| `methodArgumentCount()` | how many args the Smalltalk send passed |
| `stackValue(n)` | the nth argument's oop (0 = last arg) |
| `isBytes(oop)` | true if oop is a byte-indexable object (String, ByteArray, …) |
| `stSizeOf(oop)` | number of indexable bytes/slots in oop |
| `firstIndexableField(oop)` | raw `void*` to oop's bytes — re-fetch after any allocation, see Gotchas |
| `classString()` | the String class oop, for allocating a new String |
| `instantiateClassindexableSize(cls, n)` | allocate a new `n`-byte instance of `cls` |
| `methodReturnInteger(n)` | succeed, returning a SmallInteger |
| `methodReturnValue(oop)` | succeed, returning an arbitrary object |
| `primitiveFailFor(reasonCode)` | fail the primitive — Smalltalk fallback code runs next |

## The Smalltalk side

```smalltalk
hello: aString
    <primitive: 'primitiveDummyHello' module: 'DummyPlugin'>
    ^ 'Hello world', (Character value: 33) asString, ' ', aString
```

The pragma names the primitive function and its module by string — resolved
*lazily*, on first actual send, not at compile time. If the module can't be
loaded or the primitive fails, execution just falls through to the ordinary
Smalltalk method body below the pragma. Always write a real fallback: it's
what makes the method work on a VM that never loaded your plugin at all.

## Registering and building

1. List the plugin in the build config's external-plugins file, e.g.
   `building/macos64ARMv8/squeak.cog.spur/plugins.ext` (append `YourPlugin \`).
2. Build just that plugin — no VM relink needed:
   ```
   cd building/macos64ARMv8/squeak.cog.spur
   make build/vm/YourPlugin.bundle
   cp -R build/vm/YourPlugin.bundle Squeak.app/Contents/Resources/
   ```
   This is the fast loop: ~0.1s once the VM itself is built once.

In this repo, `vm-exploration/plugins/<Name>/` is where we track plugin
sources (the VM checkout itself is gitignored/disposable), and
`tools/install-vm-plugins.sh` copies them into place and edits `plugins.ext`
for you — see `HowToBuild.md` for the full local workflow.

## Any language works, not just C

The VM's plugin ABI is just "a loadable bundle exporting `getModuleName`,
`setInterpreter`, and your primitive function(s), C calling convention."
Nothing about it requires C specifically — we rebuilt the same `hello:`
primitive in **Zig** (`vm-exploration/plugins/DummyPluginZig/`) to confirm it,
registered as a separate module (`DummyPluginZig`) so it coexists with the C
one for side-by-side comparison. Both are loaded the same way, from the same
`Resources/` directory, found by the same lazy lookup.

Both plugins — the C one and the Zig one — are external, `dlopen`'d modules
with **no link-time dependency on the VM binary**: everything is reached
through the `interpreterProxy` pointer handed to `setInterpreter`. That means
neither needs the VM's own Make-based build or `plugins.ext` registration at
all — they only need to be compiled against the VM's real headers for a
binary-compatible ABI. `build.zig`, in this directory, does exactly that for
both:

```
cd vm-exploration
zig build                     # builds both
zig build dummy-plugin        # just DummyPlugin.bundle (C)
zig build dummy-plugin-zig    # just DummyPluginZig.bundle (Zig)
```

Output lands in the gitignored `vm-exploration/build/<Name>/<Name>.bundle`,
ready to `cp -R` into any VM's `Contents/Resources/`. It only requires
`../opensmalltalk-vm` to be checked out (`tools/fetch-vm.sh`, from the repo
root) — not built.

For each plugin, `build.zig` compiles the source to a plain object (`zig cc`
for the `.c` file, `zig build-obj`-equivalent for the `.zig` one), then links
that object into a `.bundle` via `clang -bundle` — the same link step the
VM's own `Makefile.plugin` uses — since Zig's own dynamic-library linker
isn't what produces this Apple bundle format.

The VM headers actually needed to compile against the ABI (confirmed by
tracing the real include tree with `clang -H`):

- `platforms/Cross/vm` — for `sqVirtualMachine.h` itself
- `src/spur64.cog` — for `interp.h`, which defines `sqInt`/`usqInt` for this
  specific VM variant
- `platforms/iOS/vm/OSX` — for `config.h`, which `DummyPlugin.c` includes
  directly (not just transitively through `sqVirtualMachine.h`)

The rest of the conventional per-plugin `-I` list Make passes (plugin-specific
scaffolding dirs, `sqMathShim.h`, the `.pch`, etc.) is unused for this plugin.

Zig-specific notes:
- Export functions as `export fn name(...) ReturnType`, and the arg-count
  `Metadata` value as `export var nameMetadata: i16 = 0x101;` — same
  convention as the C side, just Zig syntax.
- `DummyPlugin.zig` imports `sqVirtualMachine.h` as `@import("cimport")`, a
  module `build.zig` produces by running the header through Zig's
  `TranslateC` build step and wiring it in via `Module.addImport`. Older Zig
  versions did this inline with `@cImport(@cInclude(...))`; that builtin was
  removed upstream, so anything still using it needs this migration on newer
  Zig. The translation itself is clean either way — the headers we need have
  no Objective-C in them. One macro (`returnSelf`) fails to translate and
  becomes a `@compileError` placeholder in the generated Zig, but that's
  harmless as long as nothing references it.
- Expect a "built for newer macOS version" link warning — `zig cc`'s object
  output targets the host macOS SDK version, while the final link step pins
  `-mmacosx-version-min=11.0` to match the VM's own build. Cosmetic, not a
  functional problem.
- `zig cc`'s debug-mode UBSan instrumentation needs a matching runtime that a
  plain `clang -bundle` link (no `libclang_rt`) doesn't provide, so
  `build.zig` sets `sanitize_c = .off` on the C plugin's module — otherwise
  the link fails on undefined `__ubsan_handle_*` symbols. The VM's own
  `Makefile.plugin` build never enables UBSan for this plugin either, so this
  keeps parity with it.

## Gotchas

- **GC safety**: allocating an object (`instantiateClassindexableSize`, etc.)
  can move existing objects. Any oop you captured *before* the allocation
  (e.g. an argument) may now be stale — re-fetch pointers with
  `firstIndexableField` *after* you're done allocating, or protect an oop
  across the call with `pushRemappableOop`/`popRemappableOop`.
- **`.pck.st` files are bang/chunk format**: every `!` character is a chunk
  delimiter — *even inside comments and string literals*. A literal `!` typed
  directly into a comment or string silently truncates that chunk and
  corrupts everything after it; the installer won't error, and the VM just
  hangs (near-zero CPU — it's blocked on a UI callback that doesn't exist
  headless, easy to mistake for an infinite loop in your C code). Build a
  literal `!` at runtime instead, e.g. `(Character value: 33) asString`, or
  escape it as `!!` if it must appear in the source text.
- **Test the fallback path too**: run against a VM/image that doesn't have
  your plugin loaded (e.g. the shipped VM) to confirm the Smalltalk fallback
  alone produces a correct result — it's what runs for everyone who doesn't
  have your primitive built.

## Links

- [OpenSmalltalk VM repo](https://github.com/OpenSmalltalk/opensmalltalk-vm) — source, issues, CI
- [VMMaker](http://source.squeak.org/VMMaker.html) — the "proper" way to develop the VM and plugins: write the primitive in Smalltalk inside a VMMaker image, and Slang (VMMaker's Smalltalk-to-C translator) generates the `.c` file. What we did by hand in `DummyPlugin.c` is what Slang would otherwise generate for you.
- [Two Decades of Smalltalk VM Development: Live VM Development through Simulation Tools](https://www.researchgate.net/publication/328509577_Two_Decades_of_Smalltalk_VM_Development_Live_VM_Development_through_Simulation_Tools) — paper on the VM Simulator referenced by the VM repo's own README
- `opensmalltalk-vm/platforms/Cross/vm/sqVirtualMachine.h` — the full interpreter-proxy function table (in-repo, not a URL)
- `opensmalltalk-vm/src/plugins/MD5Plugin/`, `DESPlugin/` — small, real plugins worth reading as templates
- [Zig's C interop / `@cImport`](https://ziglang.org/documentation/master/#Import-from-C-Header-File) — how `translate-c` turns a C header into a binary-compatible Zig `extern struct`, which is what makes `DummyPluginZig` work
- [Cuis community](https://cuis.st/community) / [Squeak community](https://squeak.org/community) — where to ask VM/image questions unrelated to the VM's own build
