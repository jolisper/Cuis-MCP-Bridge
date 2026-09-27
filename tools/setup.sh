#!/usr/bin/env bash
# Fetches every external dependency this repo needs locally but doesn't
# version — the Cuis distribution and the OpenSmalltalk VM source (see
# .gitignore) — by running tools/fetch-cuis.sh and tools/fetch-vm.sh in turn.
# Pure convenience: each script is independently idempotent and safe to run
# on its own, so this just saves calling both by hand on a fresh checkout.
#
# Usage: tools/setup.sh [-f|--force]
#   -f, --force   re-download/re-clone both, even if already present

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$REPO_ROOT/tools/fetch-cuis.sh" "$@"
"$REPO_ROOT/tools/fetch-vm.sh" "$@"

echo "HARNESS: setup done" >&2
