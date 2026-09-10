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

/**
 * What a stored signal can hold: options persist through JSON, so anything
 * outside this union would not survive a round trip. Declaring it moves that
 * mistake from a silent `undefined` after reload to a compile error.
 *
 * Note that a constrained type parameter keeps a literal's type (`{ defaultValue:
 * 280 }` infers `280`, not `number`), so name the value type explicitly:
 * `createStoredSignal<number>(id, { defaultValue: 280 })`.
 */
export type StoredValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly StoredValue[]
  | { readonly [key: string]: StoredValue };

/** Plain setter shape (Solid 2's `Setter<T>` is an overloaded tuple type we don't need). */
export type StoredSignal<T extends StoredValue = StoredValue> = {
  value: Accessor<T>;
  /** Write a value (persisted) or derive it from the current one. */
  set(next: T | ((prev: T) => T)): void;
};

export type StoredSignalOptions<T extends StoredValue = StoredValue> = {
  /** Value used when nothing is stored yet; also what `resetAll` restores. */
  defaultValue: T;
  /** Where the value persists. Defaults to `globalThis.localStorage` when available. */
  storage?: StorageLike | undefined;
  /** Serialize a value for storage. Defaults to `JSON.stringify`. */
  stringify?: (value: T) => string;
  /** Parse a stored string. Defaults to `JSON.parse`. */
  parse?: (serialized: string) => T;
};

/**
 * What the registry keeps per id: the one shared value cell, at the top of the
 * stored-value space, plus its own reset. A `Map` of signals of different value
 * types can only be typed by erasing `T`, and an erased *signal* cannot be cast
 * back to `StoredSignal<T>` (`T` is not comparable to the erasure) — so callers
 * get a caller-typed view over this cell instead.
 */
type Entry = {
  read: () => StoredValue;
  write: (next: StoredValue) => void;
  reset: () => void;
};

/** The caller's view of an entry's shared cell, at the caller's own `T`. */
function viewOf<T extends StoredValue>(entry: Entry): StoredSignal<T> {
  const readAt = () => entry.read() as T;
  return {
    value: readAt,
    set: (next) =>
      entry.write(typeof next === "function" ? (next as (prev: T) => T)(readAt()) : next),
  };
}

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

/**
 * Default parse. The stored string was written by `stringify` for this same `T`,
 * so the asserted result is the registry's own contract rather than a guess about
 * foreign data — and it is asserted here once, deliberately, instead of letting
 * `JSON.parse`'s `any` flow into the caller. `opts.parse` overrides it for
 * anything that genuinely needs validating.
 */
function parseStored<T extends StoredValue>(serialized: string): T {
  return JSON.parse(serialized) as T;
}

export function readStored<T extends StoredValue>(key: string, opts: StoredSignalOptions<T>): T {
  const storage = storageOf(opts);
  if (!storage) return opts.defaultValue;
  try {
    const raw = storage.getItem(key);
    if (raw === undefined) return opts.defaultValue;
    const parse = opts.parse ?? parseStored<T>;
    return parse(raw);
  } catch {
    return opts.defaultValue;
  }
}

export function writeStored<T extends StoredValue>(
  key: string,
  value: T,
  opts: StoredSignalOptions<T>,
): void {
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
   * The signal for `id`, over the value cell created on the first call and
   * shared afterwards. The first call's `defaultValue`/options win for that id.
   */
  getOrCreate<T extends StoredValue>(id: string, opts: StoredSignalOptions<T>): StoredSignal<T>;
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

  function createEntry<T extends StoredValue>(id: string, opts: StoredSignalOptions<T>): Entry {
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
    return {
      read: () => value(),
      // Writes arrive through a view, which checked the value against its own
      // `T`; the cell itself is only ever the top type.
      write: (next) => set(next as T),
      reset,
    };
  }

  return {
    getOrCreate<T extends StoredValue>(id: string, opts: StoredSignalOptions<T>): StoredSignal<T> {
      let entry = entries.get(id);
      if (!entry) {
        entry = createEntry(id, opts);
        entries.set(id, entry);
      }
      return viewOf<T>(entry);
    },
    resetAll() {
      persistStorage?.clear?.();
      for (const entry of entries.values()) entry.reset();
    },
  };
}
