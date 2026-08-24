/**
 * Per-file write tail so widget and style POSTs never overlap.
 * Latest payload per slot wins — rapid style chips only hit disk once.
 */
const tails = new Map<string, Promise<unknown>>();
const latest = new Map<string, unknown>();

export function enqueueFileWrite<T>(file: string, work: () => Promise<T>): Promise<T> {
  const prev = tails.get(file) ?? Promise.resolve();
  const next = prev.then(work, work);
  tails.set(
    file,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export function enqueueLatest<T>(
  file: string,
  slot: string,
  payload: T,
  write: (payload: T) => Promise<string | null>,
): Promise<string | null> {
  latest.set(slot, payload);
  return enqueueFileWrite(file, async () => {
    if (!latest.has(slot)) return null;
    const next = latest.get(slot) as T;
    latest.delete(slot);
    return write(next);
  });
}

export function writeSlot(at: { file: string; line: number; column: number }, kind: string): string {
  return `${at.file}:${at.line}:${at.column}:${kind}`;
}

/** Test hook. */
export function resetWriteQueue(): void {
  tails.clear();
  latest.clear();
}
