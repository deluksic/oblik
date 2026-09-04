import { createContext, useContext } from "solid-js";
import type { ParentProps } from "solid-js";

import { createStoredRegistry } from "./stored-signals";
import type { StoredRegistry, StoredSignal, StoredSignalOptions } from "./stored-signals";

/**
 * App-wide registry of localStorage-backed signals. The provider owns a single
 * registry (one Map), so every `createStoredSignal(id, …)` call anywhere under
 * it resolves to the *same* signal for the same `id` — matching the
 * `StoredSignalsProvider` in `mountOblik`, which wraps the whole app above the
 * scene panes, so values survive scene switches and HMR remounts.
 */
const StoredSignalsContext = createContext<StoredRegistry>();

export function StoredSignalsProvider(props: ParentProps) {
  const registry = createStoredRegistry();
  return <StoredSignalsContext value={registry}>{props.children}</StoredSignalsContext>;
}

export function useStoredSignals(): StoredRegistry {
  const registry = useContext(StoredSignalsContext);
  if (!registry) throw new Error("useStoredSignals must be used within <StoredSignalsProvider>");
  return registry;
}

/**
 * LocalStorage-backed signal. Same `id` ⇒ same signal (created once, shared by
 * every caller). See `stored-signals.ts` for options.
 */
export function createStoredSignal<T>(id: string, opts: StoredSignalOptions<T>): StoredSignal<T> {
  return useStoredSignals().getOrCreate(id, opts);
}
