# TODO

## cuis-mcp-bridge — Package vs. Category scope

Cuis organizes code at two distinct levels:

- **Package** (`.pck.st` files, `!provides:`) — the unit of loading/distribution.
- **Category** (`SystemOrganization`) — how classes are classified within the System
  Browser; this is what `initiatives/cuis-mcp-bridge` currently exposes (categories,
  classes, protocols, methods).

The initiative deliberately scopes the first delivery to categories only, matching "browse
like the System Browser." Packages are out of scope for now.

Revisit later: it may be useful for the bridge to also expose Package-level reflection (e.g.
"which `.pck.st` does this class live in") once the category-based read-only slice is done.

## vm-source-primitive-lookup — VM source reading use cases

`initiatives/vm-source-primitive-lookup` is scoped to the first two use cases below only (version
resolution, mirror, flow — for named-with-module, numbered, and named-without-module primitive
pragmas). The rest are
related needs, explicitly out of scope there, left for future initiatives. Note: the
`vm-source-*` names below are placeholder slugs for grouping only — none of these initiatives
has been set up yet (no `initiatives/vm-source-*` folder exists for them):

- [x] **Named-primitive correlation** — given a method's `<primitive: 'name' module:
  'Plugin'>` pragma, read the exact matching VM source via the plugin's `_exports` table.
  Covered in `initiatives/vm-source-primitive-lookup/initiative.md`.
- [x] **Numbered (bytecode) primitive correlation** — `<primitive: 60>`-style pragmas with no
  module name, dispatched positionally from `primitiveTable[...]` in the core interpreter, not
  looked up by name. Specified at the same level as named primitives in
  `initiatives/vm-source-primitive-lookup/initiative.md` (path derivation from `vmVersion` +
  `platformSubtype`, a stated default for the one residual ambiguity, and a full flow
  walkthrough) — with one known, explicitly flagged limitation: three build variants
  (`cog`/`cog.lowcode`/`sista`) can't be told apart from the image or VM binary, so the design
  defaults to `cog` and accepts the (verified-small) risk of a wrong body for a primitive that
  differs across those variants.
- [ ] **`vm-source-build-variant`** — `get_vm_source` always attaches the caveat "The build
  variant (cog, cog.lowcode or sista) could not be determined, so this is the cog variant's
  source" to a core-interpreter lookup (no `module`), because nothing the Cuis side reports
  (`vmVersion`, platform name/subtype, loaded modules) says which variant was built. Fine for
  a primitive that is identical across variants (e.g. `primitiveFloatAdd`), but possibly wrong
  for a Lowcode- or Sista-specific one. Needs a new Cuis-side signal (a VM parameter, a loaded
  Lowcode/Sista marker, or the executable name), which would be a new wire operation and so a
  `PROTOCOL_VERSION` bump. Follow-up to the limitation noted under *Numbered (bytecode)
  primitive correlation* above; not part of `vm-source-primitive-lookup`.
- [ ] **`vm-source-local-plugins`** — `get_vm_source` reads only the mirror of
  `OpenSmalltalk/opensmalltalk-vm`, so a locally built or third-party plugin is unreachable:
  e.g. `DummyPrimitiveDemo class>>hello:` (`<primitive: 'primitiveDummyHello' module: 'DummyPlugin'>`)
  has its C source in this repo at `vm-exploration/plugins/DummyPlugin/DummyPlugin.c`, and the
  lookup fails with `module_not_found` or `symbol_not_found`. Idea: also search configured extra
  source roots (a local directory) for plugin `.c` files. Version-to-commit resolution would not
  apply there, so the result needs a caveat such as "read from the working tree, not the commit
  the VM was built from". Future initiative, not part of `vm-source-primitive-lookup`.
- [ ] **`vm-source-platform-paths`** — the same primitive can call into OS-specific glue
  under `opensmalltalk-vm/platforms/<OS>/plugins/...`; reading the matching platform source
  (not just the shared plugin `.c` file) for cross-platform behavior questions. Future
  initiative, not part of `vm-source-primitive-lookup`.
- [ ] **`vm-source-browsing`** — e.g. "what primitives does `SocketPlugin` provide,"
  analogous to `list_methods` but for a plugin's `_exports` table, with no starting pragma at
  all. Future initiative, not part of `vm-source-primitive-lookup`.
- [ ] **`vm-source-bytecode-view`** — let the user see a method's bytecode and ask for
  explanations. Surfaced while researching the plain-vs-`gcc3x-` file question for primitive
  lookup (that's the one part of the core interpreter file where the two variants genuinely
  differ — GCC register-variable hints and computed-goto `CASE`/`BREAK` macros vs. a plain
  `switch` — so explaining dispatch itself, as opposed to a primitive's body, would need the
  *correct* variant, not whichever is more readable).

  Likely belongs Cuis-side, not host-side: Cuis already has a live, built-in bytecode
  decoder — `InstructionPrinter`/`RelativeInstructionPrinter` (confirmed in
  `Cuis7.8.sources`), which prints a `CompiledMethod`'s bytecodes as a symbolic listing
  entirely in Smalltalk. So "see the bytecode" is a reflection operation, same tier as
  `get_method_source`, not a VM-source/git lookup — the dispatch-loop-C-source angle above may
  only matter for a deeper "explain *why*" layer on top of that listing, not for showing the
  bytecode itself. Not yet explored beyond this. Future initiative, not part of
  `vm-source-primitive-lookup`.
- [ ] **`vm-source-stack-vm`** — support numbered and no-module named primitives on Stack VMs.
  Out of scope in `vm-source-primitive-lookup` (`get_vm_source` returns
  `unsupported_platform`) because all five `src/*.stack*` variants generate the identical
  `interpreterVersion` string (`Open Smalltalk Stack VM [StackInterpreterPrimitives …]`), with
  no memory-manager tag. Open questions: 32-bit V3 vs. Spur (`v3.stack` vs. `spur32.stack*`),
  `stack` vs. `stack.lowcode`, and whether `vmVersion` on a real Stack VM carries anything
  beyond that string (never booted, only read from the generated source). Stack directories
  hold `interp.c`/`gcc3x-interp.c`, not `cointerp.c`.
- [ ] **`vm-source-jit-inlining`** — see how the JIT inlines a primitive such as `+`. That
  code lives in the Cogit backends (`src/<variant>/cogit<ISA>.c`, e.g. `cogitARMv8.c`,
  `cogitX64SysV.c`), not in `cointerp.c` or the plugin files that
  `vm-source-primitive-lookup` reads. Note that the backends carry their own VMMaker stamp
  (e.g. `.3724` vs. the interpreter's `.3738`), though both live in the same commit. Future
  initiative, not part of `vm-source-primitive-lookup`.
