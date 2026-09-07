import { describe, expect, test } from "vitest";

import { sceneLoaderKeys } from "./loader-keys";

describe("sceneLoaderKeys", () => {
  test("key set is order-independent", () => {
    expect(sceneLoaderKeys({ b: () => Promise.resolve() as never, a: () => Promise.resolve() as never })).toBe(
      sceneLoaderKeys({ a: () => Promise.resolve() as never, b: () => Promise.resolve() as never }),
    );
  });

  test("detects an added or removed loader", () => {
    const before = sceneLoaderKeys({ "a.ts": () => Promise.resolve() as never });
    const added = sceneLoaderKeys({
      "a.ts": () => Promise.resolve() as never,
      "b.ts": () => Promise.resolve() as never,
    });
    expect(added).not.toBe(before);
    expect(sceneLoaderKeys({ "a.ts": () => Promise.resolve() as never })).toBe(before);
  });

  test("differs from JSON.stringify of the map", () => {
    // The regression this guards: JSON.stringify drops function values, so
    // every loader map serialized to "{}" and the dedup never fired.
    const m = { "a.ts": () => Promise.resolve() as never };
    expect(sceneLoaderKeys(m)).not.toBe(JSON.stringify(m));
  });
});
