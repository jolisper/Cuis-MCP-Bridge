#!/usr/bin/env bash
# Runs a Cuis .st script against the locally-built OpenSmalltalk VM (from
# opensmalltalk-vm/, fetched by tools/fetch-vm.sh), in full filesystem
# isolation from any other running Cuis image — same
# frozen-base-plus-disposable-scratch-copy pattern as tools/run-headless-
# tests.sh, but pointed at our own VM binary instead of the shipped
# Cuis7-8-main/CuisVM.app, so it can see our own plugins. If that VM hasn't
# been built yet (or was wiped by a fresh tools/fetch-vm.sh re-clone), this
# builds it automatically via tools/build-local-vm.sh, then (re)builds and
# installs DummyPlugin/DummyPluginZig via tools/install-local-plugins.sh, so
# plugin source changes are always reflected before running.
#
# Usage: tools/run-vm-primitive-test.sh <path/to/script.st> [timeout_seconds]
#
# Exit codes:
#   0    script signaled success (its own DONE exitCode=0)
#   1    script ran but signaled failure
#   124  timed out before completion (script never reached quitPrimitive:)
#   2    setup error (missing frozen base, missing VM, bad arguments)

set -euo pipefail

if [ "$#" -lt 1 ]; then
	echo "Usage: $0 <path/to/script.st> [timeout_seconds]" >&2
	exit 2
fi

SCRIPT_PATH="$1"
TIMEOUT="${2:-60}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_PATH="$REPO_ROOT/opensmalltalk-vm/building/macos64ARMv8/squeak.cog.spur/Squeak.app/Contents/MacOS/Squeak"
FROZEN_BASE="$REPO_ROOT/.headless-base"

if [ ! -f "$SCRIPT_PATH" ]; then
	echo "HARNESS: script not found: $SCRIPT_PATH" >&2
	exit 2
fi
if [ ! -x "$VM_PATH" ]; then
	echo "HARNESS: locally-built VM not found — building it now" >&2
	"$REPO_ROOT/tools/build-local-vm.sh"
fi
"$REPO_ROOT/tools/install-local-plugins.sh"
if [ ! -f "$FROZEN_BASE/Cuis7.8.image" ] || [ ! -f "$FROZEN_BASE/Cuis7.8.sources" ]; then
	echo "HARNESS: frozen base missing at $FROZEN_BASE — run tools/run-headless-tests.sh once to populate it" >&2
	exit 2
fi

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/cuis-vm-primitive-XXXXXX")"
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
