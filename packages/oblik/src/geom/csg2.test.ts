import { describe, expect, test } from "vitest";

import { csgPaint, fillPaint, REGION_MASK } from "./csg-draw";
import {
  csg2Value,
  csgContains,
  csgSdf,
  distToCsg,
  isFiniteCsg2,
  leftOfValue,
  offsetSourceSdf,
  offsetValue,
  pickValue,
  rightOfValue,
  wrapCsg,
} from "./csg2";
import { roundOffsetValue, compileOffsetBoundary } from "./offset";
import { alongValue, filletValue, regionContains, regionValue } from "./region";
import type { Circle, Line, Region, Segment } from "./types";
import type { Vec2 } from "./vec";


const { max } = Math;
function seg(a: Vec2, b: Vec2): Segment {
  return { kind: "segment", a, b };
}

function rectCycle(x0: number, y0: number, x1: number, y1: number): unknown[] {
  const bl = { x: x0, y: y0 };
  const br = { x: x1, y: y0 };
  const tr = { x: x1, y: y1 };
  const tl = { x: x0, y: y1 };
  return [bl, seg(bl, br), br, seg(br, tr), tr, seg(tr, tl), tl, seg(tl, bl)];
}

function rect(x0: number, y0: number, x1: number, y1: number): Region {
  return regionValue(rectCycle(x0, y0, x1, y1), []);
}

function disk(cx: number, cy: number, r: number): Circle {
  return { kind: "circle", center: { x: cx, y: cy }, radius: r };
}

function stadium(cx: number, cy: number, length: number, width: number): Region {
  const r = width / 2;
  const half = max(length, width) / 2 - r;
  const L = { x: cx - half, y: cy };
  const R = { x: cx + half, y: cy };
  const leftC: Circle = { kind: "circle", center: L, radius: r };
  const rightC: Circle = { kind: "circle", center: R, radius: r };
  const P = { x: L.x, y: L.y + r };
  const Q = { x: R.x, y: R.y + r };
  const botR = { x: R.x, y: R.y - r };
  const T = { x: L.x, y: L.y - r };
  return regionValue(
    [P, seg(P, Q), Q, alongValue(rightC, -1), botR, seg(botR, T), T, alongValue(leftC, -1)],
    [],
  );
}

const split: Line = { kind: "line", origin: { x: 2, y: 0 }, direction: { x: 0, y: 1 } };

describe("stadium region", () => {
  test("outer caps with along(-1) wind as a filled slot", () => {
    const slot = stadium(0, 0, 2, 0.8);
    expect(slot.outer).toHaveLength(4);
    expect(regionContains(slot, { x: 0, y: 0 })).toBe(true);
    expect(regionContains(slot, { x: 0.9, y: 0 })).toBe(true);
    expect(regionContains(slot, { x: 0, y: 0.5 })).toBe(false);
  });
});

describe("region as CSG leaf", () => {
  test("swiss-cheese stock keeps the hole in the CSG field", () => {
    const plate = regionValue(rectCycle(0, 0, 2, 2), [rectCycle(0.6, 0.6, 1.4, 1.4)]);
    const face = wrapCsg(plate);
    expect(csgContains(face, { x: 0.2, y: 0.2 })).toBe(true);
    expect(csgContains(face, { x: 1, y: 1 })).toBe(false);
    expect(csgSdf(face, { x: 1, y: 1 })).toBeGreaterThan(0);
    const paint = csgPaint(face);
    const d = paint.stock.kind === "path" ? paint.stock.d : "";
    expect(paint.stock.kind).toBe("path");
    expect(d.match(/Z/g)?.length).toBe(2);
    expect(paint.holes).toHaveLength(0);
  });

  test("compiled paint uses one even-odd path for stock and holes", () => {
    const face = csg2Value("diff", [rect(0, 0, 2, 2), disk(1, 1, 0.4)]);
    const paint = csgPaint(face);
    expect(paint.holes).toHaveLength(0);
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.stock.d).toMatch(/A /);
    expect(paint.stock.d.match(/Z/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Csg2 field", () => {
  test("square minus interior disk has a hole", () => {
    const face = csg2Value("diff", [rect(0, 0, 2, 2), disk(1, 1, 0.4)]);
    expect(csgSdf(face, { x: 0.15, y: 0.15 })).toBeLessThan(0);
    expect(csgSdf(face, { x: 1, y: 1 })).toBeGreaterThan(0);
    expect(csgContains(face, { x: 0.15, y: 0.15 })).toBe(true);
    expect(csgContains(face, { x: 1, y: 1 })).toBe(false);
    expect(distToCsg(face, { x: 0.15, y: 0.15 })).toBe(0);
  });

  test("union of two disks covers the lens", () => {
    const face = csg2Value("union", [disk(0, 0, 1), disk(1.2, 0, 1)]);
    expect(csgContains(face, { x: 0, y: 0 })).toBe(true);
    expect(csgContains(face, { x: 1.2, y: 0 })).toBe(true);
    expect(csgContains(face, { x: 0.6, y: 0 })).toBe(true);
    expect(csgContains(face, { x: 3, y: 0 })).toBe(false);
    const paint = csgPaint(face);
    expect(paint.tree).toBeUndefined();
    expect(paint.holes).toEqual([]);
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.stock.d).toMatch(/A /);
    expect(paint.stock.d.match(/Z/g)?.length).toBe(1);
  });

  test("escaping disk does not XOR a cap outside the stock", () => {
    const face = csg2Value("diff", [rect(0, 0, 2, 2), disk(2.2, 1, 0.5)]);
    expect(csgContains(face, { x: 1, y: 1 })).toBe(true);
    expect(csgContains(face, { x: 2.2, y: 1 })).toBe(false);
    expect(csgSdf(face, { x: 2.2, y: 1 })).toBeGreaterThan(0);
  });

  test("slot that severs yields two islands; pick keeps one", () => {
    const stock = rect(0, 0, 4, 2);
    const slot = stadium(2, 1, 5, 0.35);
    const face = csg2Value("diff", [stock, slot]);
    expect(csgContains(face, { x: 2, y: 1.7 })).toBe(true);
    expect(csgContains(face, { x: 2, y: 0.3 })).toBe(true);
    expect(csgContains(face, { x: 2, y: 1 })).toBe(false);

    const top = pickValue(face, { x: 2, y: 1.7 });
    expect(csgContains(top, { x: 2, y: 1.7 })).toBe(true);
    expect(csgContains(top, { x: 2, y: 0.3 })).toBe(false);

    const miss = pickValue(face, { x: 2, y: 1 });
    expect(csgContains(miss, { x: 2, y: 1.7 })).toBe(false);
  });

  test("pick keeps a C-shape as one component through the spine", () => {
    const face = csg2Value("diff", [rect(0, 0, 4, 3), rect(1, 1, 4.5, 2)]);
    const top = pickValue(face, { x: 3, y: 2.5 });
    expect(csgContains(top, { x: 3, y: 2.5 })).toBe(true);
    expect(csgContains(top, { x: 3, y: 0.5 })).toBe(true);
    expect(csgContains(top, { x: 0.4, y: 1.5 })).toBe(true);
  });

  test("half-plane intersect splits without trimming stock identity", () => {
    const face = wrapCsg(rect(0, 0, 4, 2));
    const left = csg2Value("intersect", [face, leftOfValue(split)]);
    const right = csg2Value("intersect", [face, rightOfValue(split)]);
    expect(csgContains(left, { x: 0.5, y: 1 })).toBe(true);
    expect(csgContains(left, { x: 3.5, y: 1 })).toBe(false);
    expect(csgContains(right, { x: 3.5, y: 1 })).toBe(true);
    expect(csgContains(right, { x: 0.5, y: 1 })).toBe(false);
    expect(csgContains(face, { x: 3.5, y: 1 })).toBe(true);
  });

  test("csgPaint keeps stadium arcs instead of polylines", () => {
    const stock = rect(0, 0, 4, 2);
    const slot = stadium(2, 1, 2, 0.8);
    const face = csg2Value("diff", [stock, slot]);
    const paint = csgPaint(face);
    expect(paint.empty).toBe(false);
    expect(paint.tree).toBeUndefined();
    expect(paint.holes).toHaveLength(0);
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.stock.d).toMatch(/A /);
    expect(paint.stock.d.match(/Z/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("filleted stock keeps arc commands in the mask stock path", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const cycle: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      cycle.push(filletValue(a, 0.2), seg(a, b));
    }
    const stock = regionValue(cycle, []);
    const paint = csgPaint(csg2Value("diff", [stock, disk(1, 1, 0.3)]));
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.stock.d).toContain("A ");
    expect(paint.holes).toHaveLength(0);
    expect(paint.stock.d.match(/Z/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("overlay halo masks invert the fill so the ring sits outside", () => {
    expect(REGION_MASK.fill.canvas).toBe("#000");
    expect(REGION_MASK.fill.stock).toBe("#fff");
    expect(REGION_MASK.fill.hole).toBe("#000");
    expect(REGION_MASK.outsideStock.canvas).toBe("#fff");
    expect(REGION_MASK.outsideStock.stock).toBe("#000");
    expect(REGION_MASK.outside.hole).toBe("#fff");
    expect(REGION_MASK.outside.stock).toBe("#000");
  });

  test("pick paints a compiled island outline, not an occupancy clip", () => {
    const face = csg2Value("diff", [rect(0, 0, 4, 2), stadium(2, 1, 5, 0.35)]);
    const top = pickValue(face, { x: 2, y: 1.7 });
    const paint = csgPaint(top);
    expect(paint.empty).toBe(false);
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.stock.d).toMatch(/^M /);
    expect(paint.stock.d).toMatch(/ Z/);
    expect(paint.stock.d).not.toMatch(/ H /);
    expect(paint.stock.d).not.toMatch(/ V /);
    expect(csgContains(top, { x: 2, y: 1.7 })).toBe(true);
    expect(csgContains(top, { x: 2, y: 0.3 })).toBe(false);
    expect(csgPaint(pickValue(face, { x: 2, y: 1 })).empty).toBe(true);
  });

  test("pick of cheese with a round hole keeps arc commands", () => {
    const face = csg2Value("diff", [rect(0, 0, 2, 2), disk(1, 1, 0.4)]);
    const hold = pickValue(face, { x: 0.15, y: 0.15 });
    const paint = csgPaint(hold);
    expect(paint.empty).toBe(false);
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.holes).toHaveLength(0);
    expect(paint.stock.d).toMatch(/A /);
    expect(paint.stock.d.match(/Z/g)?.length).toBeGreaterThanOrEqual(2);
    expect(csgContains(hold, { x: 0.15, y: 0.15 })).toBe(true);
    expect(csgContains(hold, { x: 1, y: 1 })).toBe(false);
  });

  test("pick of a disk paints the circle as arcs", () => {
    const hold = pickValue(disk(0, 0, 1), { x: 0, y: 0 });
    const paint = csgPaint(hold);
    expect(paint.empty).toBe(false);
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.stock.d).toMatch(/A /);
    expect(paint.stock.d.match(/A /g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("half-plane intersect paints the clipped island", () => {
    const paint = csgPaint(csg2Value("intersect", [rect(0, 0, 4, 2), leftOfValue(split)]));
    expect(paint.empty).toBe(false);
    expect(paint.tree).toBeUndefined();
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.stock.d).toMatch(/^M /);
    expect(paint.keepClip).toBeUndefined();
  });

  test("NaN intersect operand NaNs the derived CSG, not the stock", () => {
    const face = wrapCsg(rect(0, 0, 2, 2));
    const bad: Line = { kind: "line", origin: { x: Number.NaN, y: 0 }, direction: { x: 0, y: 1 } };
    const left = csg2Value("intersect", [face, leftOfValue(bad)]);
    expect(isFiniteCsg2(left)).toBe(false);
    expect(csgContains(face, { x: 1, y: 1 })).toBe(true);
    expect(csgContains(left, { x: 1, y: 1 })).toBe(false);
  });
});

describe("offset operand", () => {
  test("offsetSourceSdf is the un-offset operand field", () => {
    const off = offsetValue(rect(0, 0, 1, 1), -0.2);
    expect(offsetSourceSdf(off, { x: 0.5, y: 0.2 })).toBeCloseTo(-0.2);
    expect(offsetSourceSdf(off, { x: 0.5, y: 0.5 })).toBeCloseTo(-0.5);
    expect(offsetSourceSdf(off, { x: 0.5, y: -0.1 })).toBeCloseTo(0.1);
  });

  test("membership is sdf − d, paint is the compiled walk", () => {
    const stock = rect(0, 0, 1, 1);
    const face = wrapCsg(offsetValue(stock, 0.2));
    expect(face.of[0]?.kind).toBe("offset");
    expect(csgContains(face, { x: 0.5, y: 0.5 })).toBe(true);
    expect(csgContains(face, { x: 1.1, y: 0.5 })).toBe(true);
    expect(csgContains(face, { x: 1.25, y: 1.25 })).toBe(false);
    const paint = csgPaint(face);
    expect(paint.empty).toBe(false);
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.stock.d).toMatch(/A /);
    expect(paint.stock.d.match(/Z/g)?.length).toBe(1);
    expect(
      (roundOffsetValue(stock, 0.2)[0]?.outer &&
        Array.isArray(roundOffsetValue(stock, 0.2)[0]?.outer) &&
        (roundOffsetValue(stock, 0.2)[0]!.outer as { carrier: { kind: string } }[]).filter(
          (e) => e.carrier.kind === "circle",
        ).length) ??
        0,
    ).toBe(4);
  });

  test("punched circular hole paints two leftover islands, not the grown disk", () => {
    const center = { x: 13.7, y: 4.8 };
    const hole: Circle = { kind: "circle", center, radius: 0.52 };
    const plate = regionValue(rectCycle(12.2, 3.5, 15.2, 6.1), [hole]);
    const face = wrapCsg(offsetValue(plate, -0.42));
    const paint = csgPaint(face);
    expect(paint.empty).toBe(false);
    expect(paint.tree).toBeUndefined();
    expect(paint.holes).toEqual([]);
    expect(paint.stock.kind).toBe("path");
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect(paint.stock.d.match(/Z/g)?.length).toBe(2);
    expect(paint.stock.d).toMatch(/A /);
    expect(compileOffsetBoundary(offsetValue(plate, -0.42))).toHaveLength(2);
  });

  test("fillPaint and offset compile are identity-cached on the operand", () => {
    const face = wrapCsg(offsetValue(rect(0, 0, 1, 1), 0.2));
    const off = face.of[0]!;
    expect(off.kind).toBe("offset");
    const first = fillPaint(face);
    const second = fillPaint(face);
    expect(second).toBe(first);
    if (off.kind !== "offset") throw new Error("expected offset");
    expect(compileOffsetBoundary(off)).toBe(compileOffsetBoundary(off));
  });

  test("a split leftover is still one formula", () => {
    const bone = regionValue(
      [
        { x: 0, y: 0 },
        seg({ x: 0, y: 0 }, { x: 2, y: 0 }),
        { x: 2, y: 0 },
        seg({ x: 2, y: 0 }, { x: 2, y: 0.8 }),
        { x: 2, y: 0.8 },
        seg({ x: 2, y: 0.8 }, { x: 3, y: 0.8 }),
        { x: 3, y: 0.8 },
        seg({ x: 3, y: 0.8 }, { x: 3, y: 0 }),
        { x: 3, y: 0 },
        seg({ x: 3, y: 0 }, { x: 5, y: 0 }),
        { x: 5, y: 0 },
        seg({ x: 5, y: 0 }, { x: 5, y: 2 }),
        { x: 5, y: 2 },
        seg({ x: 5, y: 2 }, { x: 3, y: 2 }),
        { x: 3, y: 2 },
        seg({ x: 3, y: 2 }, { x: 3, y: 1.2 }),
        { x: 3, y: 1.2 },
        seg({ x: 3, y: 1.2 }, { x: 2, y: 1.2 }),
        { x: 2, y: 1.2 },
        seg({ x: 2, y: 1.2 }, { x: 2, y: 2 }),
        { x: 2, y: 2 },
        seg({ x: 2, y: 2 }, { x: 0, y: 2 }),
        { x: 0, y: 2 },
        seg({ x: 0, y: 2 }, { x: 0, y: 0 }),
      ],
      [],
    );
    const face = wrapCsg(offsetValue(bone, -0.3));
    expect(csgContains(face, { x: 1, y: 1 })).toBe(true);
    expect(csgContains(face, { x: 4, y: 1 })).toBe(true);
    expect(csgContains(face, { x: 2.5, y: 1 })).toBe(false);
    const paint = csgPaint(face);
    expect(paint.empty).toBe(false);
    if (paint.stock.kind !== "path") throw new Error("expected path stock");
    expect((paint.stock.d.match(/Z/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
