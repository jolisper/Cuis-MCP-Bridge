#!/usr/bin/env bash
# Runs a Cuis headless test script (a run-tests.st) in full filesystem isolation
# from any other running Cuis image, against a frozen, known-good image/sources/
# changes triplet — never the shared, mutable working image under
# Cuis7-8-main/CuisImage/, which an interactive session can corrupt (as happened
# on 2026-09-04: a hung "save" left it half-written, hanging every subsequent
# headless boot regardless of script content).
#
# Usage: tools/run-headless-tests.sh <path/to/run-tests.st> [timeout_seconds]
#
# Exit codes:
#   0    all tests passed
#   1    tests ran but had failures/errors (from the .st script's own exit code)
#   124  timed out before completion (script never reached quitPrimitive:)
#   2    setup error (missing zip, missing VM, bad arguments)

set -euo pipefail

if [ "$#" -lt 1 ]; then
	echo "Usage: $0 <path/to/run-tests.st> [timeout_seconds]" >&2
	exit 2
fi

SCRIPT_PATH="$1"
TIMEOUT="${2:-60}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIP_PATH="$REPO_ROOT/Cuis7-8-main.zip"
VM_PATH="$REPO_ROOT/Cuis7-8-main/CuisVM.app/Contents/MacOS/Squeak"
FROZEN_BASE="$REPO_ROOT/.headless-base"

if [ ! -f "$SCRIPT_PATH" ]; then
	echo "HARNESS: script not found: $SCRIPT_PATH" >&2
	exit 2
fi
if [ ! -x "$VM_PATH" ]; then
	echo "HARNESS: VM not found or not executable: $VM_PATH" >&2
	exit 2
fi

# Lazily populate the frozen base (image/sources/changes) from the pristine
# zip the first time this runs, or if it's missing/incomplete. Never derived
# from the mutable working image, so it can never inherit its corruption.
if [ ! -f "$FROZEN_BASE/Cuis7.8.image" ] || [ ! -f "$FROZEN_BASE/Cuis7.8.sources" ]; then
	if [ ! -f "$ZIP_PATH" ]; then
		echo "HARNESS: frozen base missing and $ZIP_PATH not found to build it from" >&2
		exit 2
	fi
	echo "HARNESS: populating frozen base at $FROZEN_BASE from $ZIP_PATH (one-time)" >&2
	rm -rf "$FROZEN_BASE"
	mkdir -p "$FROZEN_BASE"
	TMP_EXTRACT="$(mktemp -d)"
	unzip -q "$ZIP_PATH" -d "$TMP_EXTRACT"
	cp "$TMP_EXTRACT/Cuis7-8-main/CuisImage/Cuis7.8.image" "$FROZEN_BASE/Cuis7.8.image"
	cp "$TMP_EXTRACT/Cuis7-8-main/CuisImage/Cuis7.8.sources" "$FROZEN_BASE/Cuis7.8.sources"
	cp "$TMP_EXTRACT/Cuis7-8-main/CuisImage/Cuis7.8.changes" "$FROZEN_BASE/Cuis7.8.changes"
	rm -rf "$TMP_EXTRACT"
fi

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/cuis-headless-XXXXXX")"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

cp "$FROZEN_BASE/Cuis7.8.image" "$SCRATCH/Cuis7.8.image"
cp "$FROZEN_BASE/Cuis7.8.sources" "$SCRATCH/Cuis7.8.sources"
cp "$FROZEN_BASE/Cuis7.8.changes" "$SCRATCH/Cuis7.8.changes"

LOG="$SCRATCH/output.log"

# Run from REPO_ROOT (in THIS shell, not a subshell) so the script's own
# relative package paths (DirectoryEntry currentDirectory // '...') resolve
# against the real repo, and so $! / wait below track a direct job of this
# shell rather than an untrackable grandchild of a subshell.
cd "$REPO_ROOT"
"$VM_PATH" -headless "$SCRATCH/Cuis7.8.image" -s "$SCRIPT_PATH" < /dev/null > "$LOG" 2>&1 &
PID=$!

(
	sleep "$TIMEOUT"
	kill -9 "$PID" 2>/dev/null || true
) &
WATCHDOG=$!

STATUS=0
wait "$PID" 2>/dev/null || STATUS=$?
kill "$WATCHDOG" 2>/dev/null || true
wait "$WATCHDOG" 2>/dev/null || true

cat "$LOG"

if ! grep -q "DONE exitCode=" "$LOG"; then
	echo "HARNESS: timed out after ${TIMEOUT}s or crashed before reaching quitPrimitive: (killed)" >&2
	exit 124
fi

exit "$STATUS"
