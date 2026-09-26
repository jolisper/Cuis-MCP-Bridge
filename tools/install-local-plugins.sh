#!/usr/bin/env bash
# Builds DummyPlugin and DummyPluginZig (vm-exploration/plugins/, via
# vm-exploration/build.zig) and installs both bundles into the locally-built
# VM's Contents/Resources/, so it can load them. Called automatically by
# tools/run-vm-primitive-test.sh before every run, so the installed plugins
# always match the current vm-exploration/plugins/ source — zig build's own
# caching makes rebuilding on every call cheap (well under a second once
# warm), so there's no separate "already installed" skip here.
#
# Usage: tools/install-local-plugins.sh
#
# Exit codes:
#   0    both bundles built and installed
#   2    setup error (local VM not built yet, or the zig build failed)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCES="$REPO_ROOT/opensmalltalk-vm/building/macos64ARMv8/squeak.cog.spur/Squeak.app/Contents/Resources"

if [ ! -d "$RESOURCES" ]; then
	echo "HARNESS: $RESOURCES not found — build the local VM first (tools/build-local-vm.sh)" >&2
	exit 2
fi

echo "HARNESS: building plugin bundles (zig build)" >&2
( cd "$REPO_ROOT/vm-exploration" && zig build )

for name in DummyPlugin DummyPluginZig; do
	bundle="$REPO_ROOT/vm-exploration/build/$name/$name.bundle"
	if [ ! -d "$bundle" ]; then
		echo "HARNESS: expected $bundle after zig build — did the build succeed?" >&2
		exit 2
	fi
	rm -rf "$RESOURCES/$name.bundle"
	cp -R "$bundle" "$RESOURCES/"
	echo "HARNESS: installed $name.bundle" >&2
done

echo "HARNESS: done" >&2
