import { describe, expect, test } from "vitest";

import { isUserSourcePath, normalizeStackFile, parseFrame } from "./stack";

describe("isUserSourcePath", () => {
  test("accepts scene typescript paths", () => {
    expect(isUserSourcePath("apps/demo/src/scenes/shelf.ts")).toBe(true);
  });

  test("rejects vite prebundles and node_modules", () => {
    expect(isUserSourcePath("node_modules/.vite/deps/dev-DEjxqSxT.js")).toBe(false);
    expect(isUserSourcePath("node_modules/oblik/src/index.ts")).toBe(false);
    expect(isUserSourcePath(".vite/deps/chunk.ts")).toBe(false);
  });

  test("rejects oblik internals and node builtins", () => {
    expect(isUserSourcePath("packages/oblik/src/eval/constructors.ts")).toBe(false);
    expect(isUserSourcePath("node:internal/modules/esm/loader")).toBe(false);
  });
});

describe("normalizeStackFile", () => {
  test("keeps Vite app-relative helper paths", () => {
    expect(normalizeStackFile("http://127.0.0.1:43127/src/layout/mounting-plate.ts")).toBe(
      "src/layout/mounting-plate.ts",
    );
    expect(normalizeStackFile("/@fs/workspace/apps/demo/src/layout/mounting-plate.ts")).toBe(
      "apps/demo/src/layout/mounting-plate.ts",
    );
  });
});

describe("parseFrame", () => {
  test("reads a Vite browser stack line", () => {
    const f = parseFrame(
      "    at mountingPlateLayout (http://127.0.0.1:43127/src/layout/mounting-plate.ts:19:14)",
    );
    expect(f).toMatchObject({
      file: "src/layout/mounting-plate.ts",
      line: 19,
      column: 14,
      name: "mountingPlateLayout",
    });
  });
});

describe("isUserSourcePath", () => {
  test("accepts scene typescript paths", () => {
    expect(isUserSourcePath("apps/demo/src/scenes/shelf.ts")).toBe(true);
  });

  test("rejects vite prebundles and node_modules", () => {
    expect(isUserSourcePath("node_modules/.vite/deps/dev-DEjxqSxT.js")).toBe(false);
    expect(isUserSourcePath("node_modules/oblik/src/index.ts")).toBe(false);
    expect(isUserSourcePath(".vite/deps/chunk.ts")).toBe(false);
  });

  test("rejects oblik internals and node builtins", () => {
    expect(isUserSourcePath("packages/oblik/src/eval/constructors.ts")).toBe(false);
    expect(isUserSourcePath("node:internal/modules/esm/loader")).toBe(false);
  });
});
