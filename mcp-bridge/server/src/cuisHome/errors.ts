/** Machine-readable reasons a headless Cuis setup can fail. */
export type HeadlessErrorCode =
  | 'unsupported_platform'
  | 'cuis_missing'
  | 'cuis_initializing'
  | 'cuis_fetch_failed'
  | 'cuis_checksum_mismatch'
  | 'cuis_write_failed'
  | 'cuis_base_build_failed'
  | 'cuis_corrupt'
  | 'internal_error';

/** Error raised by headless Cuis setup, tagged with a `HeadlessErrorCode`. */
export class HeadlessError extends Error {
  constructor(
    readonly code: HeadlessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HeadlessError';
  }
}

/** Renders a `HeadlessError` as `code: message`. */
export function formatHeadlessError(error: HeadlessError): string {
  return `${error.code}: ${error.message}`;
}
