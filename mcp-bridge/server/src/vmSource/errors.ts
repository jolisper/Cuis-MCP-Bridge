/** Machine-readable reasons a VM source lookup can fail. */
export type VmSourceErrorCode =
  | 'invalid_request'
  | 'version_unparseable'
  | 'missing_platform_info'
  | 'unsupported_platform'
  | 'mirror_missing'
  | 'mirror_initializing'
  | 'mirror_busy'
  | 'fetch_failed'
  | 'mirror_write_failed'
  | 'commit_not_found'
  | 'module_not_found'
  | 'path_not_found'
  | 'symbol_not_found'
  | 'primitive_slot_empty'
  | 'git_unavailable'
  | 'mirror_corrupt'
  | 'internal_error';

/** Error raised by VM source lookups, tagged with a `VmSourceErrorCode`. */
export class VmSourceError extends Error {
  constructor(
    readonly code: VmSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VmSourceError';
  }
}

/** Git (LC_ALL=C) stderr patterns that indicate a network-level transfer failure. */
const NETWORK_FAILURE_PATTERNS: readonly RegExp[] = [
  /Could not resolve host/,
  /Failed to connect/,
  /Connection refused/,
  /timed out/,
  /Network is unreachable/,
  /unable to access '/,
  /Could not read from remote repository/,
  /does not appear to be a git repository/,
  /repository '.*' (does not exist|not found)/,
  /remote end hung up/,
  /early EOF/,
];

/** True when a git stderr indicates a network failure rather than a local one. */
export function isNetworkFailure(stderr: string): boolean {
  return NETWORK_FAILURE_PATTERNS.some((pattern) => pattern.test(stderr));
}

/**
 * Maps a failed git transfer's stderr to a `VmSourceError`: `fetch_failed` for
 * network failures, `mirror_write_failed` otherwise. The trimmed stderr is
 * embedded in the message.
 */
export function transferError(stderr: string): VmSourceError {
  const detail = stderr.trim();
  if (isNetworkFailure(stderr)) {
    return new VmSourceError('fetch_failed', `could not reach upstream: ${detail}`);
  }
  return new VmSourceError('mirror_write_failed', `could not write to the VM source mirror: ${detail}`);
}

/** Builds the `git_unavailable` error raised when the git binary cannot be run. */
export function gitUnavailable(detail: string): VmSourceError {
  return new VmSourceError('git_unavailable', `git is required for the VM source tools but could not be run (${detail})`);
}
