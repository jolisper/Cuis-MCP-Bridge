# Partition: vm-source-primitive-lookup

52 invariants into 4 ordered parts. Part K may assume parts 1..K-1 only.

## Parts and implementation order

| # | Part dir | Count | Assumes |
|---|---|---|---|
| 1 | `vm-source-primitive-lookup-01-cuis-vm-facts` | 8 | none |
| 2 | `vm-source-primitive-lookup-02-mirror-setup` | 11 | 1 |
| 3 | `vm-source-primitive-lookup-03-source-lookup` | 20 | 1, 2 |
| 4 | `vm-source-primitive-lookup-04-failure-handling` | 13 | 1, 2, 3 |

Implement in the order 1, 2, 3, 4.

## Invariant mapping

| old | part-dir | new |
|---|---|---|
| 1 | 01-cuis-vm-facts | 1 |
| 2 | 01-cuis-vm-facts | 2 |
| 3 | 01-cuis-vm-facts | 3 |
| 4 | 01-cuis-vm-facts | 4 |
| 5 | 01-cuis-vm-facts | 5 |
| 44 | 01-cuis-vm-facts | 6 |
| 45 | 01-cuis-vm-facts | 7 |
| 47 | 01-cuis-vm-facts | 8 |
| 6 | 02-mirror-setup | 1 |
| 24 | 02-mirror-setup | 2 |
| 25 | 02-mirror-setup | 3 |
| 28 | 02-mirror-setup | 4 |
| 29 | 02-mirror-setup | 5 |
| 42 | 02-mirror-setup | 6 |
| 46 | 02-mirror-setup | 7 |
| 48 | 02-mirror-setup | 8 |
| 49 | 02-mirror-setup | 9 |
| 50 | 02-mirror-setup | 10 |
| 51 | 02-mirror-setup | 11 |
| 7 | 03-source-lookup | 1 |
| 8 | 03-source-lookup | 2 |
| 9 | 03-source-lookup | 3 |
| 10 | 03-source-lookup | 4 |
| 11 | 03-source-lookup | 5 |
| 12 | 03-source-lookup | 6 |
| 13 | 03-source-lookup | 7 |
| 14 | 03-source-lookup | 8 |
| 15 | 03-source-lookup | 9 |
| 16 | 03-source-lookup | 10 |
| 17 | 03-source-lookup | 11 |
| 18 | 03-source-lookup | 12 |
| 19 | 03-source-lookup | 13 |
| 21 | 03-source-lookup | 14 |
| 22 | 03-source-lookup | 15 |
| 23 | 03-source-lookup | 16 |
| 26 | 03-source-lookup | 17 |
| 27 | 03-source-lookup | 18 |
| 34 | 03-source-lookup | 19 |
| 52 | 03-source-lookup | 20 |
| 20 | 04-failure-handling | 1 |
| 30 | 04-failure-handling | 2 |
| 31 | 04-failure-handling | 3 |
| 32 | 04-failure-handling | 4 |
| 33 | 04-failure-handling | 5 |
| 35 | 04-failure-handling | 6 |
| 36 | 04-failure-handling | 7 |
| 37 | 04-failure-handling | 8 |
| 38 | 04-failure-handling | 9 |
| 39 | 04-failure-handling | 10 |
| 40 | 04-failure-handling | 11 |
| 41 | 04-failure-handling | 12 |
| 43 | 04-failure-handling | 13 |

## Edge evidence (all point backward)

- 2→1: old 46 uses `session_busy`, "unreachable" and the Cuis-side connection defined by old 44 and 45.
- 3→1: old 8 requires inputs "exactly as" old 1–4 returned them; old 9 uses old 2 and 3; old 11 names old 1–4.
- 3→2: old 26 and 27 use the mirror states and `setup_vm_mirror` statuses of old 24 and 25; old 13 relies on old 49 (bare, no working tree); old 23 and 34 fetch into the mirror, whose writes old 48 confines.
- 4→1: old 31 cites old 4.
- 4→2: old 30 shares clone state and the "next `setup_vm_mirror` call" with old 25 and 29; old 40 relies on old 25 (`ready`); old 41 relies on old 25 (`started`).
- 4→3: old 31 cites old 26 and 9; old 39 cites old 9; old 20 uses old 17, 19 and 23; old 30 uses old 26; old 35 uses old 9 and 16; old 36 and 37 use old 12 and 18; old 38 uses old 9; old 43 uses old 23.

## Kept apart despite link

- old 8 (part 3) and old 36 (part 4): single shared code `symbol_not_found`.
- old 34 (part 3) and old 31 (part 4): single shared code `mirror_busy`.
- old 42, 46, 48 (part 2) name `get_vm_source` before it exists; constraints only, no behavior borrowed.

## Placement decisions

- old 30 sits in part 4: it bundles `get_vm_source`'s `mirror_missing` (old 26) and codes defined with old 33, which cites it.
- old 20 and 43 cite each other and stay together in part 4.
- old 34 and 52 (concurrency) go in part 3, where `get_vm_source` first fetches.
- old 12 bare references "(15)", "(18)", "(17)" were renumbered to "(9)", "(12)", "(11)"; the verify script does not mask bare numbers.
