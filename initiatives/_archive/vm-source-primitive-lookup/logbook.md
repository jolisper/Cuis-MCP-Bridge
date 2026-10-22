---
spec: initiatives/vm-source-primitive-lookup/technical-spec.md
started: 2026-10-22
status: archived
archived: 2026-10-22
---

# Implementation Log: VM Source Primitive Lookup

This initiative was partitioned (`partition.md`) into four ordered parts rather than implemented
directly, so this log only ties the parts together. Each part has its own logbook, technical
spec and static/dynamic verify reports under `initiatives/_archive/`.

| # | Part | Invariants |
|---|---|---|
| 1 | `vm-source-primitive-lookup-01-cuis-vm-facts` | 8 |
| 2 | `vm-source-primitive-lookup-02-mirror-setup` | 11 |
| 3 | `vm-source-primitive-lookup-03-source-lookup` | 20 |
| 4 | `vm-source-primitive-lookup-04-failure-handling` | 13 |

The 52 invariants of `functional-spec.md` map one-to-one onto the parts (see the mapping table
in `partition.md`). All four parts are archived, each with a clean static verification and a
passing dynamic verification.

## Open items carried forward

- **Build variant:** `get_vm_source` always caveats that the `cog`/`cog.lowcode`/`sista` variant
  could not be determined for a core-interpreter lookup. Removing it needs a new Cuis-side
  signal and a protocol bump. Tracked in `TODO.md` as `vm-source-build-variant`.
- **Run recipe driver:** `.claude/skills/run-cuis-mcp-bridge/driver.mjs` still sends protocol
  version 2 while the server is at 3, so its handshake fails. It also only reaches Cuis-side
  operations, not the host-side VM source tools.
- **Other TODO items:** platform paths, VM source browsing, bytecode view, Stack VM support and
  JIT inlining remain future initiatives (see `TODO.md`).

## Retrospective

This initiative was a design-and-partition effort. The functional spec, initiative and technical spec were written and refined across about 30 commits. The 52 invariants were then split into four ordered parts, and each part was implemented, verified and archived on its own.

**Deviations**
- The first partition attempt was reverted and redone with different part names.
- Each part drifted slightly from the parent spec as it was implemented. Examples are the 2 s cap on fetch-lock waits, `mirror_busy`, and the full-name `VMMaker.oscog-<initials>.<N>` token. The per-part specs are the source of truth for those.

**Results:** the host-side tools `setup_vm_mirror` and `get_vm_source` and the Cuis-side VM facts tools (protocol v3) shipped. The server test suite is 243 tests, and every part passed static and dynamic verification.

**Lessons**
- Partitioning kept each part small enough to implement and verify test-first. Parts 2 to 4 rewrite the same files, though, so the history can't be cleanly split by part at the code level. That is why the branch was later reshaped by layer.
- A parent that is only partitioned needs its own logbook so that archiving works.
- Two items are carried forward: the permanent "build variant undetermined" caveat (a `TODO.md` item, needing a Cuis-side signal and a protocol bump), and the stale run-recipe driver, which still sends protocol 2 while the server is at 3.
