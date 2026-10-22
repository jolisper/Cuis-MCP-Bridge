# Dynamic verify report — vm-source-primitive-lookup-04-failure-handling
Date: 2026-10-22

Method: the Node bridge (`mcp-bridge/server/dist/index.js`) was driven over MCP stdio with a scratch `HOME` (fresh clone of upstream, 739 MB). Failures were injected with an unreachable `url.insteadOf`, a read-only home, a corrupt mirror, a PATH without git, and wrapper `git` scripts. Cuis was launched per the recipe on 6790. The recipe's `driver.mjs` can't handshake (it sends protocol 2, the server expects 3) and doesn't reach Node-side tools, so it wasn't used.

Invariant 1 — Several consecutive commits can carry the same token. Resolution then picks:
  Dynamic: pass — mt.3568 (3 candidates) resolves to the introducing commit, stamp match/mismatch reported with no fetch; current token (eem.3816) with mismatching stamp fetches and fails with fetch_failed; no stamp (not_verifiable) returns the introducing commit without fetching. Not run live: a refresh fetch that succeeds and finds a match.

Invariant 2 — If a background clone fails, the next `setup_vm_mirror` call reports the failure and starts nothing
  Dynamic: pass — sequence fetch_failed (git text), then started, then fetch_failed again; get_vm_source mirror_missing meanwhile; read-only home gives mirror_write_failed

Invariant 3 — Every `get_vm_source` failure is a structured error with a code. The codes are checked in this order
  Dynamic: pass — mirror_missing/mirror_initializing first; then invalid_request, version_unparseable, missing_platform_info, unsupported_platform ahead of git (git_unavailable) and ahead of mirror_corrupt; module_not_found before reading; symbol_not_found/path_not_found/primitive_slot_empty while reading

Invariant 4 — `commit_not_found` means no commit carries the token, even after fetching from upstream.
  Dynamic: pass — eem.99999999 and eem.2000 / nice.3568 → commit_not_found

Invariant 5 — `fetch_failed` means upstream couldn't be reached
  Dynamic: pass — injected "Could not resolve host" → fetch_failed with git text; injected "No space left on device" → mirror_write_failed with git text

Invariant 6 — `path_not_found` means the resolved commit lacks the file the tool expects for the case
  Dynamic: pass — eem.55 numbered lookup → path_not_found (gcc3x-cointerp.c missing)

Invariant 7 — `symbol_not_found` means the file exists but `lookupKey` matches nothing in it
  Dynamic: pass — 'noSuchName' → no exports row; slot 99999 → no primitiveTable slot

Invariant 8 — `primitive_slot_empty` means a numbered `lookupKey` names a `primitiveTable` slot that holds no function
  Dynamic: pass — slot 0 → primitive_slot_empty naming the slot; slot 1 returns source

Invariant 9 — A Stack VM's `vmVersion` doesn't stop lookups that have a `module`
  Dynamic: pass — Stack VM + FilePlugin returns primitiveFileSize source

Invariant 10 — `unsupported_platform` is returned, naming the value, when:
  Dynamic: pass — Win32 with a module, Plan9 platformName, x86_64 subtype, and Stack VM without module all named; ordinary plugin with Plan9/weird still resolved

Invariant 11 — `mirror_corrupt` is returned when the mirror exists but git can't read it as a valid repository.
  Dynamic: pass — corrupt mirror → mirror_corrupt with delete/setup advice; setup_vm_mirror still ready

Invariant 12 — `git_unavailable` is returned by `get_vm_source` and `setup_vm_mirror` when the host has no usable `git` executable
  Dynamic: pass — both return git_unavailable; setup left no lock or tmp dir

Invariant 13 — Every network failure surfaces as `fetch_failed`
  Dynamic: pass — host-resolve failure on open-token fetch and on the stamp refresh both fetch_failed

Invariant 14 — The version token is the whole `VMMaker.oscog-<initials>.<N>` name
  Dynamic: pass — mt.3568 → b6c45de, eem.3568 → b0d6a58; nice.3568 → commit_not_found

Invariant 15 — `internal_error` means a git command couldn't be run to completion
  Dynamic: pass — git killed with SIGKILL → internal_error with detail, not mirror_corrupt

15 invariants — 15 passed, 0 failed, 0 skipped
