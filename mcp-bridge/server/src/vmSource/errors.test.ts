import { describe, expect, it } from 'vitest';
import { gitUnavailable, isNetworkFailure, transferError, VmSourceError } from './errors.js';

describe('isNetworkFailure', () => {
  it('classifies an unresolvable-host stderr as network and a permission stderr as not', () => {
    // Given
    const network =
      "fatal: unable to access 'https://github.com/OpenSmalltalk/opensmalltalk-vm.git/': Could not resolve host: github.com";
    const local = 'error: insufficient permission for adding an object to repository database ./objects';

    // When
    const networkResult = isNetworkFailure(network);
    const localResult = isNetworkFailure(local);

    // Then
    expect(networkResult).toBe(true);
    expect(localResult).toBe(false);
  });

  it.each([
    "fatal: unable to access 'https://github.com/x/y.git/': Failed to connect to 127.0.0.1 port 1 after 0 ms: Couldn't connect to server",
    'ssh: connect to host github.com port 22: Connection refused',
    "fatal: unable to access 'https://github.com/x/y.git/': Operation timed out after 300000 milliseconds",
    'ssh: connect to host github.com port 22: Network is unreachable',
    "fatal: unable to access 'https://github.com/x/y.git/': SSL certificate problem: unable to get local issuer certificate",
    'fatal: Could not read from remote repository.',
    "fatal: '/tmp/gone.git' does not appear to be a git repository",
    "fatal: repository '/tmp/gone.git' does not exist",
    "remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found",
    'fatal: the remote end hung up unexpectedly',
    'fatal: early EOF',
  ])('classifies %j as a network failure', (stderr) => {
    // Given
    const input = stderr;

    // When
    const result = isNetworkFailure(input);

    // Then
    expect(result).toBe(true);
  });
});

describe('transferError', () => {
  it('maps a network stderr to fetch_failed with the trimmed stderr in the message', () => {
    // Given
    const stderr = "  fatal: unable to access 'https://x/': Could not resolve host: x\n";

    // When
    const error = transferError(stderr);

    // Then
    expect(error).toBeInstanceOf(VmSourceError);
    expect(error.code).toBe('fetch_failed');
    expect(error.message).toContain("fatal: unable to access 'https://x/': Could not resolve host: x");
    expect(error.message).not.toMatch(/\s$/);
  });

  it.each([
    'error: insufficient permission for adding an object to repository database ./objects\n',
    'fatal: write error: No space left on device',
    'error: unable to create temporary file: Read-only file system',
    'fatal: something nobody has seen before',
  ])('maps non-network stderr %j to mirror_write_failed with the trimmed stderr in the message', (stderr) => {
    // Given
    const input = stderr;

    // When
    const error = transferError(input);

    // Then
    expect(error).toBeInstanceOf(VmSourceError);
    expect(error.code).toBe('mirror_write_failed');
    expect(error.message).toContain(input.trim());
  });
});

describe('gitUnavailable', () => {
  it('returns git_unavailable with a message saying git is required and the detail', () => {
    // Given
    const detail = 'spawn git ENOENT';

    // When
    const error = gitUnavailable(detail);

    // Then
    expect(error).toBeInstanceOf(VmSourceError);
    expect(error.code).toBe('git_unavailable');
    expect(error.message).toContain('git is required');
    expect(error.message).toContain('spawn git ENOENT');
  });
});
