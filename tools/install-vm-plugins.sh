#!/usr/bin/env bash
# Installs our own C plugin sources from vm-exploration/plugins/ into the
# (gitignored, tools/fetch-vm.sh-managed) opensmalltalk-vm/ checkout, and
# makes sure each is listed as an external plugin for the squeak.cog.spur
# build. Our plugin sources are the versioned artifact; the VM checkout is
# disposable and rebuilt from upstream, so this script is what makes a
# fresh checkout reproduce the same plugins without hand-editing anything
# inside opensmalltalk-vm/.
#
# Only installs plugins with a <Name>/<Name>.c source file -- the VM's own
# Make-based build system only knows how to compile C (see
# vm-exploration/docs/PluginManual.md's "Any language works, not just C" section).
# A plugin written in another language (e.g. DummyPluginZig) is built by its
# own separate script instead and is skipped here, since adding it to
# plugins.ext would give Make a plugins.ext entry with no .c file to compile,
# breaking a subsequent full VM build.
#
# Usage: tools/install-vm-plugins.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGINS_SRC="$REPO_ROOT/vm-exploration/plugins"
VM_PLUGINS_DIR="$REPO_ROOT/opensmalltalk-vm/src/plugins"
PLUGINS_EXT="$REPO_ROOT/opensmalltalk-vm/building/macos64ARMv8/squeak.cog.spur/plugins.ext"

if [ ! -d "$VM_PLUGINS_DIR" ]; then
	echo "HARNESS: $VM_PLUGINS_DIR not found — run tools/fetch-vm.sh first" >&2
	exit 2
fi

for plugin_dir in "$PLUGINS_SRC"/*/; do
	name="$(basename "$plugin_dir")"

	if [ ! -f "$plugin_dir/$name.c" ]; then
		echo "HARNESS: skipping $name (no $name.c -- not a Make-buildable C plugin)" >&2
		continue
	fi

	echo "HARNESS: installing $name" >&2
	rm -rf "$VM_PLUGINS_DIR/$name"
	cp -R "$plugin_dir" "$VM_PLUGINS_DIR/$name"

	if ! grep -q "^$name \\\\\$" "$PLUGINS_EXT"; then
		# Insert right after the "EXTERNAL_PLUGINS = \" header line.
		awk -v name="$name" '
			{ print }
			/^EXTERNAL_PLUGINS = \\$/ && !done { print name " \\"; done=1 }
		' "$PLUGINS_EXT" > "$PLUGINS_EXT.tmp"
		mv "$PLUGINS_EXT.tmp" "$PLUGINS_EXT"
		echo "HARNESS: added $name to plugins.ext" >&2
	fi
done

echo "HARNESS: done" >&2
