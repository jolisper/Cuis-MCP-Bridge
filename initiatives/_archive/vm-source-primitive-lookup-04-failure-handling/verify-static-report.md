# Static verify report — vm-source-primitive-lookup-04-failure-handling
Date: 2026-10-22

Test files are under `mcp-bridge/server/src/vmSource/`.

Invariant 1 — Several consecutive commits can carry the same token. Resolution then picks:
  Static: covered — resolveCommit.test.ts:451 (closed window picks the matching stamp), :502 (open window, one fetch), :530 (refresh fetch fails), :626 (closed window mismatch, no fetch); getVmSource.test.ts:433, :481 (mismatch/not_verifiable/open-window table)

Invariant 2 — If a background clone fails, the next `setup_vm_mirror` call reports the failure and starts nothing
  Static: covered — mirror.test.ts:312 (fetch_failed, next call starts nothing), :338 (mirror_write_failed, mirror_missing, then new clone), :375, :401, :445

Invariant 3 — Every `get_vm_source` failure is a structured error with a code. The codes are checked in this order
  Static: covered — getVmSource.test.ts:657 (mirror check before type guards), lookupPlan.test.ts:460 (invalid_request > version_unparseable > missing_platform_info > unsupported_platform), getVmSource.test.ts:591 (module_not_found before any show), :331/:296 (path_not_found, symbol_not_found while reading)

Invariant 4 — `commit_not_found` means no commit carries the token, even after fetching from upstream.
  Static: covered — resolveCommit.test.ts:143

Invariant 5 — `fetch_failed` means upstream couldn't be reached
  Static: covered — resolveCommit.test.ts:164 (fetch_failed), :194 (mirror_write_failed on a disk-full fetch), errors.test.ts:45, mirror.test.ts:338

Invariant 6 — `path_not_found` means the resolved commit lacks the file the tool expects for the case
  Static: covered — getVmSource.test.ts:331

Invariant 7 — `symbol_not_found` means the file exists but `lookupKey` matches nothing in it
  Static: covered — cSource.test.ts:157, :213; getVmSource.test.ts:616 (never module_not_found or path_not_found)

Invariant 8 — `primitive_slot_empty` means a numbered `lookupKey` names a `primitiveTable` slot that holds no function
  Static: covered — cSource.test.ts:213; getVmSource.test.ts:619 (names slot 3, never symbol_not_found)

Invariant 9 — A Stack VM's `vmVersion` doesn't stop lookups that have a `module`
  Static: covered — getVmSource.test.ts:620

Invariant 10 — `unsupported_platform` is returned, naming the value, when:
  Static: covered — lookupPlan.test.ts:234 (unmapped values), :253 (Win32 on an ordinary plugin); tools.test.ts:215 (handler output)

Invariant 11 — `mirror_corrupt` is returned when the mirror exists but git can't read it as a valid repository.
  Static: covered — git.test.ts:267, resolveCommit.test.ts:358, getVmSource.test.ts:356 (`setup_vm_mirror` still `ready`: mirror.test.ts:147, indirect)

Invariant 12 — `git_unavailable` is returned by `get_vm_source` and `setup_vm_mirror` when the host has no usable `git`
  Static: covered — git.test.ts:101, :126; resolveCommit.test.ts:380; mirror.test.ts:424 (not `started`, no lock or tmp dir)

Invariant 13 — Every network failure surfaces as `fetch_failed`
  Static: covered — errors.test.ts:5 (all network patterns), resolveCommit.test.ts:164, :530 (refresh fetch fails), :626 (no refresh on a closed window)

Invariant 14 — The version token is the whole `VMMaker.oscog-<initials>.<N>` name
  Static: covered — lookupPlan.test.ts:314, resolveCommit.test.ts:672 (`mt.3568` vs `eem.3568`)

Invariant 15 — `internal_error` means a git command couldn't be run to completion
  Static: covered — git.test.ts:149 (SIGKILL), :220 (maxBuffer); resolveCommit.test.ts:380; getVmSource.test.ts:356

15 invariants — 15 covered, 0 uncovered
