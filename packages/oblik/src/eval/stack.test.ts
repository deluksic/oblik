import { describe, expect, test } from "vitest";

import { isUserSourcePath, normalizeStackFile, parseFrame, userStackFrames } from "./stack";

describe("userStackFrames", () => {
  test("filters vite and oblik frames from a raw capture stack", () => {
    const frames = userStackFrames([
      { file: "packages/oblik/src/eval/constructors.ts", line: 82, column: 1, name: "traced" },
      { file: "node_modules/.vite/deps/dev-DEjxqSxT.js", line: 99, column: 1 },
      { file: "http://127.0.0.1:43127/src/scenes/shelf.ts", line: 12, column: 6, name: "build" },
    ]);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ line: 12, column: 6, name: "build" });
  });
});

describe("isUserSourcePath", () => {
  test("accepts scene typescript paths", () => {
    expect(isUserSourcePath("apps/demo/src/scenes/shelf.ts")).toBe(true);
    expect(isUserSourcePath("http://127.0.0.1:43127/src/scenes/shelf.ts")).toBe(true);
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

  test("keeps vite bundle paths from the string stack", () => {
    const f = parseFrame("    at traced node_modules/.vite/deps/dev-DEjxqSxT.js:99:1");
    expect(f).toMatchObject({
      file: "node_modules/.vite/deps/dev-DEjxqSxT.js",
      line: 99,
      column: 1,
      name: "traced",
    });
  });
});
