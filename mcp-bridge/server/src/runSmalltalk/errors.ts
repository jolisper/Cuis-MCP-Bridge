/** Machine-readable reasons a run_smalltalk input can be rejected. */
export type RunInputErrorCode =
  | 'invalid_code'
  | 'package_not_found'
  | 'package_not_pck'
  | 'package_unreadable'
  | 'invalid_timeout'
  | 'invalid_packages';

/** Error raised for invalid run_smalltalk input, tagged with a `RunInputErrorCode`. */
export class RunInputError extends Error {
  constructor(
    readonly code: RunInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunInputError';
  }
}
