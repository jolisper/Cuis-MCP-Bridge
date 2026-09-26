# Building the local VM for primitive exploration

`tools/build-local-vm.sh` does this for you — it's idempotent (skips the build if
`Squeak.app` already exists; pass `-f`/`--force` to rebuild), and
`tools/run-vm-primitive-test.sh` calls it automatically if the VM isn't built yet, so a
fresh `tools/fetch-vm.sh` re-clone (or a wiped `opensmalltalk-vm/`) doesn't leave the
plugin test unrunnable. It does exactly the manual steps below:

1. `tools/fetch-vm.sh` — clones OpenSmalltalk VM source to `opensmalltalk-vm/` (gitignored).
2. `cd opensmalltalk-vm && ./scripts/updateSCCSVersions` — one-time, stamps the version headers `mvm` checks for.
3. `cd building/macos64ARMv8/squeak.cog.spur && ./mvm -f` — builds the production VM (`squeak.cog.spur` matches Cuis7-8's shipped `CuisVM.app`: Cog JIT + Spur object format).

On a Command Line Tools-only machine (no full Xcode), `./mvm -f` fails at the `ibtool`
step compiling `MainMenu.nib` — `ibtool` requires full Xcode. Work around it by reusing
the already-compiled nib from the shipped VM (from `tools/fetch-cuis.sh`) before building:

```
mkdir -p Squeak.app/Contents/Resources/English.lproj
cp -R ../../../../Cuis7-8-main/CuisVM.app/Contents/Resources/English.lproj/MainMenu.nib \
      Squeak.app/Contents/Resources/English.lproj/MainMenu.nib
touch Squeak.app/Contents/Resources/English.lproj/MainMenu.nib
./mvm -f
```

Verified: the resulting `Squeak.app/Contents/MacOS/Squeak` boots the frozen base image
and passes the full MCP-Bridge test suite identically to the shipped VM.

## Adding a plugin

Our own plugin sources are tracked at `vm-exploration/plugins/<Name>/<Name>.c` (the
VM checkout itself is gitignored and disposable, so plugin code can't live inside
it). `tools/install-vm-plugins.sh` copies each into
`opensmalltalk-vm/src/plugins/<Name>/` and registers it in
`building/macos64ARMv8/squeak.cog.spur/plugins.ext` — run it once after
`fetch-vm.sh`, and again any time a fresh checkout is fetched.

`DummyPlugin` is a minimal hand-written external plugin: one primitive,
`primitiveDummyHello`, takes a String argument and allocates a new String directly
in C (`classString` / `instantiateClassindexableSize` / `methodReturnValue`) —
`'Hello world! ', aString`, computed with no Smalltalk bytecode involved. See its
source for the shape a named external primitive needs.

Fast iteration loop, from `building/macos64ARMv8/squeak.cog.spur/`:

```
../../../../tools/install-vm-plugins.sh   # after editing vm-exploration/plugins/...
make build/vm/DummyPlugin.bundle          # ~0.1s once the VM itself is built
cp -R build/vm/DummyPlugin.bundle Squeak.app/Contents/Resources/
```

No VM relink needed — only that one plugin recompiles.

### Building plugins without the VM's own build system

Both `DummyPlugin` (C) and `DummyPluginZig` (Zig) are external, `dlopen`'d
plugins with no link-time dependency on the VM binary, so they don't actually
need the Make-based build above at all — they only need to compile against
the VM's real headers for a binary-compatible ABI. `vm-exploration/build.zig`
does that directly from `vm-exploration/plugins/`, with no
`install-vm-plugins.sh` copy step and no VM build required:

```
cd vm-exploration
zig build                     # builds both bundles
cp -R build/DummyPlugin/DummyPlugin.bundle \
      build/DummyPluginZig/DummyPluginZig.bundle \
      ../opensmalltalk-vm/building/macos64ARMv8/squeak.cog.spur/Squeak.app/Contents/Resources/
```

Requires `opensmalltalk-vm/` checked out (`tools/fetch-vm.sh`) but not built,
and a Zig toolchain (see `PluginManual.md`'s "Any language
works, not just C" section for how it's structured and why the Make path
above isn't a hard requirement for external plugins).

## Running the check

`tools/run-vm-primitive-test.sh vm-exploration/image/run-check.st` — same
frozen-base/scratch-copy/watchdog isolation as `tools/run-headless-tests.sh`, but
pointed at this locally-built VM so it can see both plugins. Calls
`hello: 'Cuis'` (C) and `helloZig: 'Cuis'` (Zig), checking for
`'Hello world! Cuis'` and `'Hello world from Zig! Cuis'` respectively. Both
plugin bundles are (re)built and installed into `Squeak.app/Contents/Resources/`
automatically before every run (`tools/install-local-plugins.sh`), so plugin
source changes always take effect and a missing/stale bundle can't cause a
false pass or fail here.

## Gotcha: `!` in .pck.st files must be escaped

`vm-exploration/image/VM-Exploration.pck.st` is Cuis bang/chunk format: every `!`
character is a chunk delimiter, **even inside comments and string literals**. A
raw `!` anywhere in the source text (e.g. writing `'Hello world! '` directly in a
method comment) silently truncates that chunk and corrupts everything after it —
the installer doesn't error, and the VM hangs indefinitely the moment anything
tries to compile or load past the corruption (with no crash and near-zero CPU,
since it's blocked waiting on a UI callback that can't exist headless — easy to
mistake for an infinite loop in the C primitive itself). `hello:`'s fallback body
builds its `!` at runtime via `(Character value: 33) asString` specifically to
avoid ever typing a literal `!` into this file. If you need one in a comment or
string, double it (`!!`) instead.
