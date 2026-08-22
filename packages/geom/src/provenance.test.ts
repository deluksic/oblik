import { expect, test } from "vitest";

import { captureCallSite, normalizeFile } from "./provenance";

test("skips geom frames whose path has no leading slash", () => {
  const orig = Error;
  const stack = `Error
    at captureCallSite (packages/geom/src/provenance.ts:48:17)
    at parseFrame (packages/geom/src/provenance.ts:37:13)
    at makeBase (packages/geom/src/identity.ts:160:18)
    at polyline (packages/geom/src/geom.ts:128:8)
    at scene (apps/paper/src/demo/gear.ts:133:22)`;
  globalThis.Error = class extends orig {
    override stack = stack;
  } as typeof Error;
  try {
    expect(captureCallSite()).toEqual({
      file: "apps/paper/src/demo/gear.ts",
      line: 133,
      column: 22,
    });
  } finally {
    globalThis.Error = orig;
  }
});

test("Vite app-root src/ paths become apps/paper/src/", () => {
  expect(normalizeFile("src/demo/plate.ts")).toBe("apps/paper/src/demo/plate.ts");
  expect(normalizeFile("/src/demo/plate.ts")).toBe("apps/paper/src/demo/plate.ts");
});

test("rewrites a Vite stack URL through the app root", () => {
  const orig = Error;
  const stack = `Error
    at polyline (http://127.0.0.1:43117/packages/geom/src/geom.ts:128:8)
    at mountingPlate (http://127.0.0.1:43117/src/demo/plate.ts:119:10)`;
  globalThis.Error = class extends orig {
    override stack = stack;
  } as typeof Error;
  try {
    expect(captureCallSite()).toEqual({
      file: "apps/paper/src/demo/plate.ts",
      line: 119,
      column: 10,
    });
  } finally {
    globalThis.Error = orig;
  }
});
