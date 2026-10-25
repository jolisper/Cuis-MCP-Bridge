import { describe, expect, it } from 'vitest';
import { RunInputError } from './errors.js';

describe('RunInputError', () => {
  it('is an Error carrying its code, message and the RunInputError name', () => {
    // Given
    const code = 'invalid_code';
    const message = 'code must not be empty';

    // When
    const error = new RunInputError(code, message);

    // Then
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('invalid_code');
    expect(error.message).toBe('code must not be empty');
    expect(error.name).toBe('RunInputError');
  });
});
