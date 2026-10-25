import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { combineSignals, createShutdownSignal } from './shutdownSignal.js';

describe('createShutdownSignal', () => {
  it('aborts on SIGTERM, SIGINT, SIGHUP or stdin end, and ignores unrelated events', () => {
    // Given a fresh proc/stdin pair
    const proc = new EventEmitter();
    const stdin = new EventEmitter();

    // When creating the shutdown signal
    const signal = createShutdownSignal(proc, stdin);

    // Then it is not aborted initially and ignores unrelated events
    expect(signal.aborted).toBe(false);
    proc.emit('SIGUSR1');
    stdin.emit('data');
    expect(signal.aborted).toBe(false);

    // And each termination signal on proc aborts it
    for (const event of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
      const p = new EventEmitter();
      const s = createShutdownSignal(p, new EventEmitter());
      p.emit(event);
      expect(s.aborted).toBe(true);
    }

    // And stdin end aborts it
    const stdinPair = new EventEmitter();
    const fromStdin = createShutdownSignal(new EventEmitter(), stdinPair);
    stdinPair.emit('end');
    expect(fromStdin.aborted).toBe(true);
  });

  it('exits with code 0 after graceMs on a termination signal, but never on stdin end', () => {
    vi.useFakeTimers();
    try {
      const graceMs = 500;

      for (const event of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
        // Given a shutdown signal with an injected exit and grace period
        const proc = new EventEmitter();
        const exit = vi.fn();
        const signal = createShutdownSignal(proc, new EventEmitter(), { exit, graceMs });

        // When the termination signal is emitted
        proc.emit(event);

        // Then it aborts immediately but does not exit yet
        expect(signal.aborted).toBe(true);
        vi.advanceTimersByTime(graceMs - 1);
        expect(exit).not.toHaveBeenCalled();

        // And exits once with code 0 after graceMs
        vi.advanceTimersByTime(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
      }

      // And stdin end aborts without ever calling exit
      const stdin = new EventEmitter();
      const exit = vi.fn();
      const fromStdin = createShutdownSignal(new EventEmitter(), stdin, { exit, graceMs });
      stdin.emit('end');
      vi.advanceTimersByTime(graceMs * 10);
      expect(fromStdin.aborted).toBe(true);
      expect(exit).not.toHaveBeenCalled();

      // And with no opts nothing throws
      const p = new EventEmitter();
      expect(() => createShutdownSignal(p, new EventEmitter())).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('combineSignals', () => {
  it('aborts when any input aborts, propagates the reason, ignores undefined, and never aborts without inputs', () => {
    // Given two fresh controllers
    const a = new AbortController();
    const b = new AbortController();

    // When combining them
    const combined = combineSignals(a.signal, b.signal);

    // Then it is not aborted until one input aborts, and carries the same reason
    expect(combined.aborted).toBe(false);
    const reason = new Error('shutdown');
    b.abort(reason);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);

    // And an already-aborted input yields an already-aborted result
    const done = new AbortController();
    done.abort();
    expect(combineSignals(new AbortController().signal, done.signal).aborted).toBe(true);

    // And undefined entries are ignored
    const c = new AbortController();
    const withUndefined = combineSignals(undefined, c.signal);
    expect(withUndefined.aborted).toBe(false);
    c.abort();
    expect(withUndefined.aborted).toBe(true);

    // And with no usable signals the result never aborts
    expect(combineSignals().aborted).toBe(false);
    expect(combineSignals(undefined, undefined).aborted).toBe(false);
  });
});
