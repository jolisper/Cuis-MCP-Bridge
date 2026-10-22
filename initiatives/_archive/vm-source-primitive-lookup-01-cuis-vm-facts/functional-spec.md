# VM Source: Primitive Lookup — Part 1: Cuis VM Facts — Functional Spec

## Summary

Four read-only Cuis-side tools report facts about the running VM.

Covered by `vm-source-primitive-lookup-02-mirror-setup`.

Covered by `vm-source-primitive-lookup-03-source-lookup`.

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

### Cuis-side connectivity

6. The four Cuis-side tools make no network calls. They fail only with the existing bridge's
   `unreachable` and `protocol_mismatch` errors, under the same conditions as every existing
   Cuis-side tool (see `initiatives/cuis-mcp-bridge/functional-spec.md` invariants 12–14).
   An image whose Cuis-side bridge package predates these four tools fails them with
   `protocol_mismatch`, whose message says to reload the package. It never fails them with
   `invalid_request`, which would look like a mistake in the caller's own request.
7. They share the single active session with the nine existing Cuis-side tools. A call made
   while another session holds the connection fails with `session_busy` (see
   `initiatives/cuis-mcp-bridge/functional-spec.md` invariant 20).

### Read-only and isolation (must not regress)

8. The four Cuis-side tools are read-only, with no side effects on the image.
