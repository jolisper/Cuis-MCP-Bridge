#!/usr/bin/env bash
# Clones the OpenSmalltalk VM source from upstream to opensmalltalk-vm/ at the
# repo root. Not versioned in this repo — see .gitignore — so this script is
# how you get it locally.
#
# Usage: tools/fetch-vm.sh [-f|--force]
#   -f, --force   remove and re-clone an existing opensmalltalk-vm/ checkout

set -euo pipefail

UPSTREAM_REPO_URL="https://github.com/OpenSmalltalk/opensmalltalk-vm.git"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$REPO_ROOT/opensmalltalk-vm"

FORCE=0
if [ "${1:-}" = "-f" ] || [ "${1:-}" = "--force" ]; then
	FORCE=1
fi

if [ -d "$TARGET_DIR" ] && [ "$FORCE" -ne 1 ]; then
	echo "HARNESS: $TARGET_DIR already exists (use -f/--force to re-clone)" >&2
	exit 0
fi

rm -rf "$TARGET_DIR"
echo "HARNESS: cloning $UPSTREAM_REPO_URL" >&2
git clone --depth 1 "$UPSTREAM_REPO_URL" "$TARGET_DIR"

echo "HARNESS: done — OpenSmalltalk VM source at $TARGET_DIR" >&2
