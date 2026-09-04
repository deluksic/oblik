import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

/**
 * Minimal Storage-shaped interface. Kept optional (`clear?`) so tests can pass
 * plain objects. Null-free: the DOM `localStorage` is adapted to it in
 * `defaultStorage` (its `getItem` returns `string | null` — mapped to
 * `undefined` there, per the no-null policy).
 */
export type StorageLike = {
  getItem(key: string): string | undefined;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear?(): void;
};

/** Plain setter shape (Solid 2's `Setter<T>` is an overloaded tuple type we don't need). */
export type StoredSignal<T> = {
  value: Accessor<T>;
  /** Write a value (persisted) or derive it from the current one. */
  set: (next: T | ((prev: T) => T)) => void;
};

export type StoredSignalOptions<T> = {
  /** Value used when nothing is stored yet; also what `resetAll` restores. */
  defaultValue: T;
  /** Where the value persists. Defaults to `globalThis.localStorage` when available. */
  storage?: StorageLike | undefined;
  /** Serialize a value for storage. Defaults to `JSON.stringify`. */
  stringify?: (value: T) => string;
  /** Parse a stored string. Defaults to `JSON.parse`. */
  parse?: (serialized: string) => T;
};

type Entry = StoredSignal<unknown> & { reset: () => void };

export function defaultStorage(): StorageLike | undefined {
  if (typeof globalThis === "undefined") return undefined;
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (!ls) return undefined;
  // DOM `localStorage.getItem` returns `string | null` at runtime; map the
  // platform null to undefined so our StorageLike stays null-free.
  return {
    getItem: (key) => ls.getItem(key) ?? undefined,
    setItem: (key, value) => ls.setItem(key, value),
    removeItem: (key) => ls.removeItem(key),
    clear: () => ls.clear(),
  };
}

function storageOf(opts: { storage?: StorageLike | undefined }): StorageLike | undefined {
  return opts.storage !== undefined ? opts.storage : defaultStorage();
}

export function readStored<T>(key: string, opts: StoredSignalOptions<T>): T {
  const storage = storageOf(opts);
  if (!storage) return opts.defaultValue;
  try {
    const raw = storage.getItem(key);
    if (raw === undefined) return opts.defaultValue;
    const parse = opts.parse ?? ((serialized: string) => JSON.parse(serialized) as T);
    return parse(raw);
  } catch {
    return opts.defaultValue;
  }
}

export function writeStored<T>(key: string, value: T, opts: StoredSignalOptions<T>): void {
  const storage = storageOf(opts);
  if (!storage) return;
  try {
    const stringify = opts.stringify ?? JSON.stringify;
    storage.setItem(key, stringify(value));
  } catch {
    /* Quota / privacy-mode errors are not worth crashing the app over. */
  }
}

export function removeStored(key: string, opts: { storage?: StorageLike | undefined }): void {
  const storage = storageOf(opts);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export type StoredRegistry = {
  /**
   * Signal for `id`, created once on first call and shared afterwards. The first
   * call's `defaultValue`/options win for that id.
   */
  getOrCreate<T>(id: string, opts: StoredSignalOptions<T>): StoredSignal<T>;
  /** Clear storage and restore every registered signal to its default. */
  resetAll(): void;
};

/**
 * Pure registry factory: one `Map` of id → signal, no Context. The Solid
 * Context layer (`StoredSignalsContext.tsx`) wraps one of these per app mount so
 * "same id ⇒ same signal" holds across the component tree.
 */
export function createStoredRegistry(storage?: StorageLike | undefined): StoredRegistry {
  const persistStorage = storage ?? defaultStorage();
  const entries = new Map<string, Entry>();

  function createEntry<T>(id: string, opts: StoredSignalOptions<T>): Entry {
    // An entry without its own `storage` persists through the registry's
    // storage (global localStorage in the app, injected fakes in tests).
    const resolved: StoredSignalOptions<T> =
      opts.storage === undefined ? { ...opts, storage: persistStorage } : opts;
    let latest = readStored(id, resolved);
    const [value, setRaw] = createSignal<T>(latest as Exclude<T, Function>);
    const write = (v: T): void => {
      setRaw(v as Exclude<T, Function>);
    };
    const set = (next: T | ((prev: T) => T)): void => {
      latest = typeof next === "function" ? (next as (prev: T) => T)(latest) : next;
      writeStored(id, latest, resolved);
      write(latest);
    };
    const reset = (): void => {
      removeStored(id, { storage: resolved.storage ?? undefined });
      latest = opts.defaultValue;
      write(opts.defaultValue);
    };
    return { value, set, reset } as unknown as Entry;
  }

  return {
    getOrCreate<T>(id: string, opts: StoredSignalOptions<T>): StoredSignal<T> {
      const existing = entries.get(id);
      if (existing) return existing as unknown as StoredSignal<T>;
      const entry = createEntry(id, opts);
      entries.set(id, entry);
      return entry as unknown as StoredSignal<T>;
    },
    resetAll() {
      persistStorage?.clear?.();
      for (const entry of entries.values()) entry.reset();
    },
  };
}
