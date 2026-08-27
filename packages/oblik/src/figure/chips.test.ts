import { describe, expect, test } from "vitest";

import {
  DEFAULT_BRUSH,
  figureStyleFromBrush,
  previewLook,
  styleExpr,
  takesFill,
} from "./chips";

describe("figureStyleFromBrush", () => {
  test("lines get stroke, width, and dash, not fill", () => {
    const look = figureStyleFromBrush({ ...DEFAULT_BRUSH, line: "dash", stroke: "#c23b22" }, false);
    expect(look).toMatchObject({ kind: "style", stroke: "#c23b22", width: 1.6, dash: [7, 5] });
    expect(look.fill).toBeUndefined();
  });

  test("profiles and circles take fill as well as the line look", () => {
    expect(takesFill("profile")).toBe(true);
    expect(takesFill("circle")).toBe(true);
    expect(takesFill("segment")).toBe(false);
    const look = figureStyleFromBrush({ ...DEFAULT_BRUSH, fill: "#cfe8d4", line: "dot" }, true);
    expect(look.fill).toBe("#cfe8d4");
    expect(look.dash).toEqual([1.4, 3.6]);
  });

  test("preview look always carries fill so a profile hover can show it", () => {
    expect(previewLook(DEFAULT_BRUSH).fill).toBe("none");
  });
});

describe("styleExpr", () => {
  test("prints fill and dash into style({ … })", () => {
    const expr = styleExpr(figureStyleFromBrush({ ...DEFAULT_BRUSH, fill: "none", line: "dash" }, true));
    expect(expr).toEqual({
      kind: "call",
      name: "style",
      args: [
        {
          kind: "props",
          props: {
            stroke: { kind: "str", value: "#1c1917" },
            fill: { kind: "str", value: "none" },
            width: { kind: "num", value: 1.6 },
            dash: {
              kind: "array",
              items: [
                { kind: "num", value: 7 },
                { kind: "num", value: 5 },
              ],
            },
          },
        },
      ],
    });
  });
});
