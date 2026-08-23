import { expect, test } from "vitest";

import { captureCallSite, captureUserStack, normalizeFile } from "./provenance";

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
      name: "scene",
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
      name: "mountingPlate",
    });
  } finally {
    globalThis.Error = orig;
  }
});

test("Firefox frames and Vite @fs URLs still yield a user site", () => {
  const orig = Error;
  const stack = `Error
doorLeaf@http://127.0.0.1:43117/@fs/workspace/apps/paper/src/demo/floor-plan.ts:120:10
drawFloorPlan@http://127.0.0.1:43117/@fs/workspace/apps/paper/src/demo/floor-plan.ts:324:8`;
  globalThis.Error = class extends orig {
    override stack = stack;
  } as typeof Error;
  try {
    expect(captureCallSite()).toEqual({
      file: "apps/paper/src/demo/floor-plan.ts",
      line: 120,
      column: 10,
      name: "doorLeaf",
    });
  } finally {
    globalThis.Error = orig;
  }
});

test("user stack keeps nested demo helpers, innermost first", () => {
  const orig = Error;
  const stack = `Error
    at captureUserStack (packages/geom/src/provenance.ts:80:16)
    at makeBase (packages/geom/src/identity.ts:157:17)
    at segment (packages/geom/src/geom.ts:79:10)
    at doorLeaf (apps/paper/src/demo/floor-plan.ts:120:10)
    at drawFloorPlan (apps/paper/src/demo/floor-plan.ts:324:8)
    at scene (apps/paper/src/scenes/floor-plan.scene.ts:11:10)`;
  globalThis.Error = class extends orig {
    override stack = stack;
  } as typeof Error;
  try {
    expect(captureUserStack()).toEqual([
      { file: "apps/paper/src/demo/floor-plan.ts", line: 120, column: 10, name: "doorLeaf" },
      { file: "apps/paper/src/demo/floor-plan.ts", line: 324, column: 8, name: "drawFloorPlan" },
      { file: "apps/paper/src/scenes/floor-plan.scene.ts", line: 11, column: 10, name: "scene" },
    ]);
  } finally {
    globalThis.Error = orig;
  }
});
