import { describe, expect, test } from "vitest";

import { dashPattern } from "@design-scenes/shell";

import {
  applyStyleAtSite,
  applyStyleOverlays,
  drawInkFromStyle,
  hasStoredStyle,
  parseHex,
  restInkFromDraw,
  siteKey,
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
    expect(styleChannelForKind("offset")).toBe("line");
    expect(styleChannelForKind("circle3")).toBe("line");
  });

  test("angle uses line ink like other measurement gizmos", () => {
    expect(styleChannelForKind("angle")).toBe("line");
  });

  test("number gizmos have no style channel", () => {
    expect(styleChannelForKind("number")).toBeNull();
  });
});

describe("drawInkFromStyle", () => {
  test("line style maps only the fields that were set", () => {
    expect(drawInkFromStyle({ line: { color: "#ff8844", width: 2.5, dash: "dashed" } }, "line")).toEqual({
      stroke: "#ff8844",
      width: 2.5,
      dash: dashPattern("dashed", 2.5),
    });
    expect(drawInkFromStyle({ line: { dash: "dashed" } }, "line")).toEqual({ dash: dashPattern("dashed") });
    expect(drawInkFromStyle({ line: { width: 3.5, dash: "dashed" } }, "line")).toEqual({
      width: 3.5,
      dash: dashPattern("dashed", 3.5),
    });
  });

  test("point style maps only the fields that were set", () => {
    expect(drawInkFromStyle({ point: { color: "#44aaff", size: 6 } }, "point")).toEqual({
      fill: "#44aaff",
      stroke: "#44aaff",
      pointSize: 6,
    });
    expect(drawInkFromStyle({ point: { size: 6 } }, "point")).toEqual({ pointSize: 6 });
  });

  test("missing style is undefined so the view default wins", () => {
    expect(drawInkFromStyle(undefined, "line")).toBeUndefined();
    expect(drawInkFromStyle({}, "line")).toBeUndefined();
  });

  test("line color is available for gizmo fills via stroke", () => {
    expect(drawInkFromStyle({ line: { color: "#e24b4b", width: 2 } }, "line")).toEqual({
      stroke: "#e24b4b",
      width: 2,
    });
  });
});

describe("siteKey / applyStyleAtSite", () => {
  const at = { file: "apps/paper/src/scenes/loop.ts", line: 4, column: 3 };

  test("siteKey is file:line:column", () => {
    expect(siteKey(at)).toBe("apps/paper/src/scenes/loop.ts:4:3");
    expect(siteKey(undefined)).toBeNull();
  });

  test("style applies to every drawable and gizmo at the site", () => {
    const a = { geom: { site: at, style: undefined as { line?: { color: string } } | undefined } };
    const b = { geom: { site: at } };
    const c = { geom: { site: { file: at.file, line: 9, column: 1 } } };
    const g1 = { at, style: undefined as { line?: { color: string } } | undefined };
    const g2 = { at: { file: at.file, line: 9, column: 1 } };
    const style = { line: { color: "#e8876a", width: 2, dash: "dashed" as const } };
    applyStyleAtSite(at, style, [a, b, c], [g1, g2]);
    expect(a.geom.style).toEqual(style);
    expect(b.geom.style).toEqual(style);
    expect(c.geom.style).toBeUndefined();
    expect(g1.style).toEqual(style);
    expect(g2.style).toBeUndefined();
    applyStyleAtSite(at, null, [a, b], [g1]);
    expect(a.geom.style).toBeUndefined();
    expect(b.geom.style).toBeUndefined();
    expect(g1.style).toBeUndefined();
  });

  test("overlays restamp style after a fresh evaluate", () => {
    const first = { geom: { site: at } };
    applyStyleAtSite(at, { line: { width: 3.5 } }, [first], []);
    const again = { geom: { site: at } };
    applyStyleOverlays([again], []);
    expect(again.geom.style).toEqual({ line: { width: 3.5 } });
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
    expect(rest?.dashSize).toBeCloseTo(0.035);
    expect(rest?.gapSize).toBeCloseTo(0.0667, 3);
  });

  test("wide dashed ink scales 3D dash and gap", () => {
    const ink = { stroke: "#112233", width: 3.5, dash: dashPattern("dashed", 3.5) };
    const rest = restInkFromDraw(ink);
    expect(rest?.dashSize).toBeGreaterThan(0.14);
    expect(rest?.gapSize).toBeGreaterThan(rest!.dashSize!);
  });
});
