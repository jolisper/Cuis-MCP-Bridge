#!/usr/bin/env bash
# Downloads the Cuis 7.8 distribution (VM + image + packages) from upstream and
# unpacks it to Cuis7-8-main/ at the repo root. Not versioned in this repo — see
# .gitignore — so this script is how you get it locally.
#
# Usage: tools/fetch-cuis.sh [-f|--force]
#   -f, --force   re-download and overwrite an existing Cuis7-8-main/ checkout

set -euo pipefail

UPSTREAM_ZIP_URL="https://github.com/Cuis-Smalltalk/Cuis7-8/archive/refs/heads/main.zip"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIP_PATH="$REPO_ROOT/Cuis7-8-main.zip"
TARGET_DIR="$REPO_ROOT/Cuis7-8-main"

FORCE=0
if [ "${1:-}" = "-f" ] || [ "${1:-}" = "--force" ]; then
	FORCE=1
fi

if [ -d "$TARGET_DIR" ] && [ "$FORCE" -ne 1 ]; then
	echo "HARNESS: $TARGET_DIR already exists (use -f/--force to re-download)" >&2
	exit 0
fi

echo "HARNESS: downloading $UPSTREAM_ZIP_URL" >&2
curl -fsSL "$UPSTREAM_ZIP_URL" -o "$ZIP_PATH"

rm -rf "$TARGET_DIR"
unzip -q "$ZIP_PATH" -d "$REPO_ROOT"

echo "HARNESS: done — Cuis distribution at $TARGET_DIR" >&2
