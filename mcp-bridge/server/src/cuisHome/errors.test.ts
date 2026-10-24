import { describe, expect, it } from 'vitest';
import { HeadlessError, formatHeadlessError } from './errors.js';

describe('HeadlessError', () => {
  it('is an Error carrying its code, message and the HeadlessError name', () => {
    // Given
    const code = 'cuis_missing';
    const message = 'not installed';

    // When
    const error = new HeadlessError(code, message);

    // Then
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('cuis_missing');
    expect(error.message).toBe('not installed');
    expect(error.name).toBe('HeadlessError');
  });
});

describe('formatHeadlessError', () => {
  it('renders a HeadlessError as "<code>: <message>"', () => {
    // Given
    const error = new HeadlessError('cuis_checksum_mismatch', 'expected a, got b');

    // When
    const formatted = formatHeadlessError(error);

    // Then
    expect(formatted).toBe('cuis_checksum_mismatch: expected a, got b');
  });
});
