import { promises as fs } from 'node:fs';

export function fakeShScript(body: string): string {
  return '#!fake-sh\n' + body;
}

// Invocation contract (same as the real VM): <vm> -headless <image> -s <script>
const VM_SCRIPT = `#!/bin/sh
image="$2"
script="$4"
first=$(head -n 1 "$script")
if [ "$first" = "#!fake-sh" ]; then
  FAKE_IMAGE="$image"
  export FAKE_IMAGE
  sh "$script"
  exit $?
fi
BOOT_BEHAVIOR
`;

export async function writeFakeVm(
  filePath: string,
  opts: {
    bootFails?: boolean;
    markerPrefix?: string;
    requireRealVmScript?: boolean;
    writesUserChanges?: boolean;
  } = {},
): Promise<void> {
  // The real VM prints nothing unless the Transcript is logged to stdout and the marker line is ended with newLine.
  const userChanges = opts.writesUserChanges
    ? `mkdir -p UserChanges\necho x > UserChanges/Cuis7.8.user.changes\n`
    : '';
  const boot = userChanges + (opts.bootFails
    ? `echo 'fake VM: cannot boot' >&2\nexit 3`
    : opts.requireRealVmScript
      ? `if grep -qF "Transcript logToStdout: true" "$script" && grep -qF "Transcript show: 'DONE exitCode=0'; newLine" "$script"; then echo 'DONE exitCode=0'; fi\nexit 0`
      : `echo 'DONE exitCode=0'\nexit 0`);
  // Scripts print the marker as: echo "$FAKE_MARKER_PREFIX""DONE exitCode=0"
  const prefix = (opts.markerPrefix ?? '').replace(/'/g, `'\\''`);
  const vm = VM_SCRIPT.replace('BOOT_BEHAVIOR', boot).replace(
    '  export FAKE_IMAGE\n',
    `  export FAKE_IMAGE\n  FAKE_MARKER_PREFIX='${prefix}'\n  export FAKE_MARKER_PREFIX\n`,
  );
  await fs.writeFile(filePath, vm);
  await fs.chmod(filePath, 0o755);
}
