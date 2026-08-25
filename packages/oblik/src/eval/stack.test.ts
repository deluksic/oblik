import { describe, expect, test } from "vitest";

import { isUserSourcePath } from "./stack";

describe("isUserSourcePath", () => {
  test("accepts scene typescript paths", () => {
    expect(isUserSourcePath("apps/demo/src/scenes/shelf.ts")).toBe(true);
  });

  test("rejects vite prebundles and node_modules", () => {
    expect(isUserSourcePath("node_modules/.vite/deps/dev-DEjxqSxT.js")).toBe(false);
    expect(isUserSourcePath("node_modules/oblik/src/index.ts")).toBe(false);
  });

  test("rejects oblik internals and node builtins", () => {
    expect(isUserSourcePath("packages/oblik/src/eval/constructors.ts")).toBe(false);
    expect(isUserSourcePath("node:internal/modules/esm/loader")).toBe(false);
  });
});
