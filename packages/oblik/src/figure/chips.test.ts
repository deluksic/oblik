import { describe, expect, test } from "vitest";

import {
  DEFAULT_BRUSH,
  figureStyleFromBrush,
  lookExpr,
  lookFromBrush,
  takesFill,
} from "./chips";

describe("figureStyleFromBrush", () => {
  test("lines get stroke, width, and dash, not fill", () => {
    const look = figureStyleFromBrush({ ...DEFAULT_BRUSH, line: "dash", stroke: "#c23b22" }, false);
    expect(look).toMatchObject({ kind: "style", stroke: "#c23b22", width: 2.8, dash: [19.6, 14] });
    expect(look.fill).toBeUndefined();
  });

  test("profiles and circles take fill as well as the line look", () => {
    expect(takesFill("profile")).toBe(true);
    expect(takesFill("circle")).toBe(true);
    expect(takesFill("segment")).toBe(false);
    expect(takesFill("point")).toBe(false);
    const look = figureStyleFromBrush({ ...DEFAULT_BRUSH, fill: "#cfe8d4", line: "dot" }, true);
    expect(look.fill).toBe("#cfe8d4");
    expect(look.dash).toEqual([3.92, 10.08]);
  });

  test("thicker strokes stretch dash and dot", () => {
    const thin = figureStyleFromBrush({ ...DEFAULT_BRUSH, width: 1, line: "dash" }, false);
    const thick = figureStyleFromBrush({ ...DEFAULT_BRUSH, width: 5.6, line: "dash" }, false);
    expect(thin.dash).toEqual([7, 5]);
    expect(thick.dash).toEqual([39.2, 28]);
    expect(thick.width).toBe(5.6);
  });

  test("preview look matches paint: fill only on profiles and circles", () => {
    const washed = { ...DEFAULT_BRUSH, fill: "#f3c5bc" };
    expect(lookFromBrush(washed, "point").fill).toBeUndefined();
    expect(lookFromBrush(washed, "segment").fill).toBeUndefined();
    expect(lookFromBrush(washed, "line").fill).toBeUndefined();
    expect(lookFromBrush(washed, "profile").fill).toBe("#f3c5bc");
    expect(lookFromBrush(washed, "circle").fill).toBe("#f3c5bc");
    expect(lookFromBrush(washed, "point").stroke).toBe(DEFAULT_BRUSH.stroke);
  });
});

describe("lookExpr", () => {
  test("prints a plain look object, not style({ … })", () => {
    const expr = lookExpr(figureStyleFromBrush({ ...DEFAULT_BRUSH, fill: "none", line: "dash" }, true));
    expect(expr).toEqual({
      kind: "props",
      props: {
        stroke: { kind: "str", value: "#1c1917" },
        fill: { kind: "str", value: "none" },
        width: { kind: "num", value: 2.8 },
        dash: {
          kind: "array",
          items: [
            { kind: "num", value: 19.6 },
            { kind: "num", value: 14 },
          ],
        },
      },
    });
  });
});
