import { describe, expect, test } from "vitest";

import { patchPaintStyle, removePaintCall } from "./paint-edit";

const src = `import { defineScene, paint } from "oblik";
import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "figure",
  title: "t",
  build() {
    const plate = mountingPlateLayout();
    paint(plate.drill, { stroke: "#1c1917", width: 1.35 }, "o_p");
  },
});
`;

describe("patchPaintStyle", () => {
  test("replaces the look argument of a stamped paint", () => {
    const next = patchPaintStyle(src, "o_p", {
      kind: "props",
      props: {
        stroke: { kind: "str", value: "#1c1917" },
        width: { kind: "num", value: 2.2 },
      },
    });
    expect(next).toContain('paint(plate.drill, { stroke: "#1c1917", width: 2.2 }, "o_p")');
    expect(next).not.toContain("style(");
  });
});

describe("removePaintCall", () => {
  test("removes the paint statement and leaves the geom", () => {
    const next = removePaintCall(src, "o_p");
    expect(next).not.toContain("paint(");
    expect(next).toContain("const plate = mountingPlateLayout()");
    expect(next).toContain("build() {");
  });
});
