#!/usr/bin/env bash
# Builds the local OpenSmalltalk VM (opensmalltalk-vm/, fetched by
# tools/fetch-vm.sh) into a runnable Squeak.app, per vm-exploration/docs/
# HowToBuild.md. Idempotent — skips the build if Squeak.app already exists
# and is executable, unless -f/--force is given. Called automatically by
# tools/run-vm-primitive-test.sh when the VM isn't built yet; also safe to
# run directly.
#
# Usage: tools/build-local-vm.sh [-f|--force]
#   -f, --force   rebuild even if Squeak.app already exists
#
# Exit codes:
#   0    Squeak.app is present and executable when this returns
#   2    setup error (opensmalltalk-vm/ or Cuis7-8-main/ missing, build failed)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_DIR="$REPO_ROOT/opensmalltalk-vm"
BUILD_DIR="$VM_DIR/building/macos64ARMv8/squeak.cog.spur"
VM_PATH="$BUILD_DIR/Squeak.app/Contents/MacOS/Squeak"
NIB_SRC="$REPO_ROOT/Cuis7-8-main/CuisVM.app/Contents/Resources/English.lproj/MainMenu.nib"
NIB_DEST="$BUILD_DIR/Squeak.app/Contents/Resources/English.lproj/MainMenu.nib"

FORCE=0
if [ "${1:-}" = "-f" ] || [ "${1:-}" = "--force" ]; then
	FORCE=1
fi

if [ -x "$VM_PATH" ] && [ "$FORCE" -ne 1 ]; then
	echo "HARNESS: $VM_PATH already built (use -f/--force to rebuild)" >&2
	exit 0
fi

if [ ! -d "$VM_DIR" ]; then
	echo "HARNESS: $VM_DIR not found — run tools/fetch-vm.sh first" >&2
	exit 2
fi
if [ ! -f "$NIB_SRC" ]; then
	echo "HARNESS: $NIB_SRC not found — run tools/fetch-cuis.sh first (its precompiled nib is reused below)" >&2
	exit 2
fi

echo "HARNESS: stamping VM version headers" >&2
( cd "$VM_DIR" && ./scripts/updateSCCSVersions )

echo "HARNESS: building $VM_PATH (this takes a few minutes)" >&2
(
	cd "$BUILD_DIR"
	# ibtool (compiling MainMenu.nib) requires full Xcode; a Command Line
	# Tools-only machine doesn't have it, so reuse the shipped VM's
	# already-compiled nib instead of building one — see
	# vm-exploration/docs/HowToBuild.md.
	mkdir -p "$(dirname "$NIB_DEST")"
	cp -R "$NIB_SRC" "$NIB_DEST"
	touch "$NIB_DEST"
	./mvm -f
)

if [ ! -x "$VM_PATH" ]; then
	echo "HARNESS: build finished but $VM_PATH is still missing/not executable" >&2
	exit 2
fi

echo "HARNESS: done — $VM_PATH" >&2
