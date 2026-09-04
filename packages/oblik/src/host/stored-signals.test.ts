import { describe, expect, test } from "vitest";

import {
  createStoredRegistry,
  readStored,
  removeStored,
  writeStored,
  type StorageLike,
} from "./stored-signals";

type FakeStorage = StorageLike & { data: Map<string, string> };

function fakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      return data.get(key) ?? undefined;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
  };
}

const num = { defaultValue: 0 };

describe("readStored / writeStored / removeStored", () => {
  test("readStored falls back to the default when nothing is stored", () => {
    const storage = fakeStorage();
    expect(readStored("missing", { ...num, storage })).toBe(0);
  });

  test("readStored falls back to the default on corrupt JSON", () => {
    const storage = fakeStorage({ n: "not-json{" });
    expect(readStored("n", { ...num, storage })).toBe(0);
  });

  test("round-trips through JSON by default", () => {
    const storage = fakeStorage();
    writeStored("n", 42, { ...num, storage });
    expect(storage.data.get("n")).toBe("42");
    expect(readStored("n", { ...num, storage })).toBe(42);
  });

  test("honors custom stringify/parse", () => {
    const storage = fakeStorage();
    const opts = {
      defaultValue: "n/a",
      storage,
      stringify: (v: string) => v.toUpperCase(),
      parse: (s: string) => s.toLowerCase(),
    };
    writeStored("s", "abc", opts);
    expect(storage.data.get("s")).toBe("ABC");
    expect(readStored("s", opts)).toBe("abc");
  });

  test("removeStored deletes the key", () => {
    const storage = fakeStorage({ n: "42" });
    removeStored("n", { storage });
    expect(storage.data.has("n")).toBe(false);
  });

  test("no storage (undefined) keeps signals in-memory without throwing", () => {
    writeStored("n", 1, { ...num, storage: undefined });
    expect(readStored("n", { ...num, storage: undefined })).toBe(0);
  });
});

describe("createStoredRegistry", () => {
  test("same id returns the same signal; distinct ids do not", () => {
    const registry = createStoredRegistry(fakeStorage());
    const a = registry.getOrCreate("x", { defaultValue: 1 });
    const b = registry.getOrCreate("x", { defaultValue: 2 });
    const c = registry.getOrCreate("y", { defaultValue: 3 });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  test("first registration's default wins for an id", () => {
    const registry = createStoredRegistry(fakeStorage());
    registry.getOrCreate("x", { defaultValue: 1 });
    const later = registry.getOrCreate("x", { defaultValue: 99 });
    expect(later.value()).toBe(1);
  });

  test("set persists to storage and drives the signal", () => {
    const storage = fakeStorage();
    const registry = createStoredRegistry(storage);
    const width = registry.getOrCreate("w", { defaultValue: 280 });
    width.set(420);
    expect(width.value()).toBe(420);
    expect(storage.data.get("w")).toBe("420");
  });

  test("resetAll clears storage and restores defaults", () => {
    const storage = fakeStorage();
    const registry = createStoredRegistry(storage);
    const width = registry.getOrCreate("w", { defaultValue: 280 });
    const mode = registry.getOrCreate("m", { defaultValue: "light" });
    width.set(500);
    mode.set("dark");
    registry.resetAll();
    expect(width.value()).toBe(280);
    expect(mode.value()).toBe("light");
    expect(storage.data.size).toBe(0);
  });

  test("set supports function updates", () => {
    const storage = fakeStorage();
    const registry = createStoredRegistry(storage);
    const width = registry.getOrCreate("w", { defaultValue: 280 });
    width.set((prev) => prev + 20);
    expect(width.value()).toBe(300);
    expect(storage.data.get("w")).toBe("300");
  });
});
