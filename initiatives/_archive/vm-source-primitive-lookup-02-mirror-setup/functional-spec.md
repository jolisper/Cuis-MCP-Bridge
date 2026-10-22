# VM Source: Primitive Lookup — Part 2: Mirror Setup — Functional Spec

## Summary

One host-side tool sets up a shared local mirror of the VM repository, and another returns one function from it as structured JSON, with the context needed to explain it.

Covered by `vm-source-primitive-lookup-03-source-lookup`.

## Non-goals

- No tool compiles, builds or checks out anything.

## Assumes

- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 6
- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 7

## Behavior

### Tools and inputs

1. `setup_vm_mirror()` takes no parameters and makes sure the shared VM mirror exists (see
   "Mirror setup").

### Mirror setup

2. The shared mirror is in one of three states the consumer can observe: missing,
   initializing (a clone is running) or ready.
3. `setup_vm_mirror` returns immediately and never waits for a clone. It returns `ready` if
   the mirror is ready (with no network access and no change), `in_progress` if a clone is
   already running (started by this bridge instance or another), or `started` if it has just
   started one in the background.
4. Concurrent `setup_vm_mirror` calls, from the same or different bridge instances, start at
   most one clone. Every other caller gets `in_progress`.
5. If a clone was interrupted (e.g. its bridge process exited), the next `setup_vm_mirror`
   call discards it and starts a new one, rather than reporting `in_progress` forever. This
   holds even if the interrupted process's ID has since been reused by an unrelated
   process.

### Networking

6. `get_vm_source` and `setup_vm_mirror` are the only tools in the bridge, new or existing,
   that make network calls, and only to fetch from or clone upstream.

### Cuis-side connectivity

7. `get_vm_source` and `setup_vm_mirror` never use the Cuis-side connection. They work while
   a Cuis-side session is active, idle or unreachable, and never fail with `session_busy`.

### Read-only and isolation (must not regress)

8. The only writes in this surface are `setup_vm_mirror` creating the mirror and
   `get_vm_source` fetching into it, both confined to `~/.cuis-mcp-bridge/`.
9. The mirror is a bare repository. No tool creates a working tree, checks out a commit or
   moves `HEAD` in it.
10. No tool reads from or writes to a project-local `opensmalltalk-vm/` checkout used for
    building a VM. The mirror is a separate clone, in a separate location.
11. The mirror isn't tied to one project. A bridge instance in a different Cuis project uses,
    and benefits from, the same mirror.

## Must not regress

- `vm-source-primitive-lookup-01-cuis-vm-facts` invariant 8
