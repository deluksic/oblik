import { describe, expect, test } from "vitest";

import {
  drawInkFromStyle,
  parseHex,
  restInkFromDraw,
  styleChannelForKind,
} from "./style";

describe("styleChannelForKind", () => {
  test("points and gliders are point ink", () => {
    expect(styleChannelForKind("point")).toBe("point");
    expect(styleChannelForKind("glider")).toBe("point");
    expect(styleChannelForKind("lineGlider")).toBe("point");
    expect(styleChannelForKind("point3")).toBe("point");
  });

  test("strokes and circles are line ink", () => {
    expect(styleChannelForKind("segment")).toBe("line");
    expect(styleChannelForKind("circle")).toBe("line");
    expect(styleChannelForKind("distance")).toBe("line");
    expect(styleChannelForKind("circle3")).toBe("line");
  });

  test("number gizmos have no style channel", () => {
    expect(styleChannelForKind("number")).toBeNull();
  });
});

describe("drawInkFromStyle", () => {
  test("line style maps dash and width", () => {
    const ink = drawInkFromStyle(
      { line: { color: "#ff8844", width: 2.5, dash: "dashed" } },
      "line",
    );
    expect(ink).toEqual({ stroke: "#ff8844", width: 2.5, dash: [8, 6] });
  });

  test("point style maps fill and size", () => {
    const ink = drawInkFromStyle({ point: { color: "#44aaff", size: 6 } }, "point");
    expect(ink).toEqual({ fill: "#44aaff", stroke: "#44aaff", pointSize: 6 });
  });

  test("missing style is undefined so the view default wins", () => {
    expect(drawInkFromStyle(undefined, "line")).toBeUndefined();
    expect(drawInkFromStyle({}, "line")).toBeUndefined();
  });
});

describe("parseHex / restInkFromDraw", () => {
  test("parses 6-digit and 3-digit hex", () => {
    expect(parseHex("#d7d2c4")).toBe(0xd7d2c4);
    expect(parseHex("#f00")).toBe(0xff0000);
    expect(parseHex("not-a-color")).toBeUndefined();
  });

  test("rest ink carries dashed and point scale", () => {
    const rest = restInkFromDraw({ stroke: "#112233", pointSize: 7, dash: [2, 4] });
    expect(rest?.color).toBe(0x112233);
    expect(rest?.dashed).toBe(true);
    expect(rest?.pointScale).toBeCloseTo(2);
  });
});
