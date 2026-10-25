/**
 * Returns a signal aborted on SIGTERM/SIGINT/SIGHUP or stdin end.
 *
 * Installing a signal handler replaces Node's default behavior of exiting, so
 * on a termination signal we abort, then force `exit(0)` after `graceMs` to
 * let in-flight cleanup run. Stdin end only aborts and never exits.
 */
export function createShutdownSignal(
  proc: { once(event: string, listener: () => void): unknown },
  stdin: { once(event: string, listener: () => void): unknown },
  opts: { exit?: (code: number) => void; graceMs?: number } = {},
): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onSignal = () => {
    abort();
    setTimeout(() => (opts.exit ?? process.exit)(0), opts.graceMs ?? 2000);
  };
  for (const event of ['SIGTERM', 'SIGINT', 'SIGHUP']) proc.once(event, onSignal);
  stdin.once('end', abort);
  return controller.signal;
}

export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const defined = signals.filter((s): s is AbortSignal => s !== undefined);
  if (defined.length === 0) return new AbortController().signal;
  return AbortSignal.any(defined);
}
