import { describe, expect, test } from "vitest";

import { patchFrame } from "./frame-edit";

describe("patchFrame", () => {
  test("overwrites width/height and inserts missing x/y", () => {
    const src = [
      `import { defineScene, paint } from "oblik";`,
      `export default defineScene({`,
      `  kind: "figure",`,
      `  title: "Plate figure",`,
      `  camera: { x: 2, y: 1.6, scale: 72 },`,
      `  frame: { width: 5.2, height: 4.2 },`,
      `  build() {},`,
      `});`,
    ].join("\n");
    const out = patchFrame(src, { x: 1, y: -0.5, width: 6, height: 5 });
    expect(out).not.toBeNull();
    expect(out).toContain("frame: { width: 6, height: 5, x: 1, y: -0.5 }");
    // camera untouched
    expect(out).toContain("camera: { x: 2, y: 1.6, scale: 72 }");
  });

  test("overwrites existing x/y/width/height in place", () => {
    const src = `export default defineScene({ kind: "figure", title: "t", frame: { x: 0, y: 0, width: 4, height: 4 }, build() {} });`;
    const out = patchFrame(src, { x: 2.25, y: 3, width: 8, height: 6.5 });
    expect(out).toContain("frame: { x: 2.25, y: 3, width: 8, height: 6.5 }");
  });

  test("works on a bare object default export (no defineScene wrapper)", () => {
    const src = `export default { kind: "figure", title: "t", frame: { width: 3, height: 2 }, build() {} };`;
    const out = patchFrame(src, { x: 1, y: 1, width: 3, height: 2 });
    expect(out).toContain("frame: { width: 3, height: 2, x: 1, y: 1 }");
  });

  test("rounds values to 2 decimals like other literal patches", () => {
    const src = `export default defineScene({ kind: "figure", title: "t", frame: { width: 5, height: 5 }, build() {} });`;
    const out = patchFrame(src, { x: 1.23456, y: 0, width: 5, height: 5 });
    expect(out).toContain("x: 1.23");
  });

  test("returns null when there is no frame property", () => {
    const src = `export default defineScene({ kind: "figure", title: "t", build() {} });`;
    expect(patchFrame(src, { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });
});
