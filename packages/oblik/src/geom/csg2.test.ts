import { describe, expect, test } from "vitest";

import { csgPaint, fillPaint, paintSvgPath, REGION_MASK } from "./csg-draw";
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
  polarRepeatValue,
  rightOfValue,
  wrapCsg,
} from "./csg2";
import { stampRepeat } from "./evaluate-regions";
import { roundOffsetValue, compileOffsetBoundary } from "./offset";
import { alongValue, filletValue, regionContains, regionValue } from "./region";
import type { Circle, Line, LoopEdge, Region, Segment } from "./types";
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

describe("a polar repeat paints its stamped copies", () => {
  /** A ring of small boxes, the shape `gearTooth` hands `polarRepeat`. */
  function ring(count = 40) {
    return polarRepeatValue(
      regionValue(rectCycle(1.8, -0.3, 2.2, 0.3), []),
      count,
      { x: 0, y: 0 },
      0,
    );
  }

  /** A cell that tiles the disc: a sector with radial edges to the axis, which
   * is what makes the copies share seams. */
  function hubCell(count: number): Region {
    const step = (Math.PI * 2) / count;
    const half = step / 2;
    const radius = 2.2;
    const at = (ang: number): Vec2 => ({ x: radius * Math.cos(ang), y: radius * Math.sin(ang) });
    const edges: LoopEdge[] = [];
    for (let i = 0; i < 4; i++) {
      const a = -half + (2 * half * i) / 4;
      const b = -half + (2 * half * (i + 1)) / 4;
      edges.push({
        a: at(a),
        b: at(b),
        carrier: { kind: "circle", center: { x: 0, y: 0 }, radius },
        k: 1,
      });
    }
    edges.push({ a: at(half), b: { x: 0, y: 0 }, carrier: seg(at(half), { x: 0, y: 0 }) });
    edges.push({ a: { x: 0, y: 0 }, b: at(-half), carrier: seg({ x: 0, y: 0 }, at(-half)) });
    return { kind: "region", outer: edges, holes: [] };
  }

  test("the paint is the copies' paths plus the cut, and it does not compile", () => {
    const rep = ring();
    const face = csg2Value("diff", [rep, { kind: "circle", center: { x: 0, y: 0 }, radius: 0.5 }]);
    const started = performance.now();
    const paint = csgPaint(face);
    const elapsed = performance.now() - started;
    // The boolean islands for a 40-tooth ring take seconds and the paint is
    // rebuilt on every trace tick, so this path must never reach the compiler:
    // the copies are disjoint, and their paths concatenated under even-odd *are*
    // the union.
    expect(elapsed).toBeLessThan(50);
    expect(paint.empty).toBe(false);
    expect(paint.tree).toBeUndefined();
    // Holes ride in the stock path (see the hub case below), never beside it.
    expect(paint.holes).toHaveLength(0);
    expect(paint.stock.kind === "path").toBe(true);

    const d = paintSvgPath(paint);
    // One subpath per copy, plus the bore's hole path, all one path.
    expect(paint.holes).toHaveLength(0);
    expect(
      paint.stock.kind === "path" && paint.stock.d.split("Z").length - 1,
    ).toBeGreaterThanOrEqual(41);
    expect(d.split("Z").length - 1).toBeGreaterThanOrEqual(41);
    // Same path as stamping the copies by hand, and covering the whole ring.
    expect(d.length).toBeGreaterThan(2000);
    const islands = stampRepeat(rep);
    expect(islands).toHaveLength(40);
    expect(d.startsWith(paintSvgPath({ ...paint, holes: [] }))).toBe(true);
    expect(paint.box.maxX).toBeGreaterThan(2);
    expect(paint.box.minX).toBeLessThan(-2);
  });

  test("a hub union paints the copies' merged outline and drops the hub", () => {
    // The gear's shape: the cells running to the axis, plus the root disc they
    // stand on, minus the bore. The disc is inside the copies, so the paint is
    // the copies' *merged* outline — one loop for the whole ring, with the
    // seams between cells gone, so a stroke cannot draw them as spokes.
    const cell = polarRepeatValue(hubCell(40), 40, { x: 0, y: 0 }, 0);
    const hub = { kind: "circle" as const, center: { x: 0, y: 0 }, radius: 1.8 };
    const face = csg2Value("diff", [
      csg2Value("union", [hub, cell]),
      { kind: "circle", center: { x: 0, y: 0 }, radius: 0.5 },
    ]);
    const started = performance.now();
    const paint = csgPaint(face);
    expect(performance.now() - started).toBeLessThan(50);
    // The bore is *in* the stock path, not beside it: the SVG view masks the
    // stock alone, so a hole left in `holes` would not be punched at all.
    expect(paint.holes).toHaveLength(0);
    expect(paint.stock.kind === "path" && paint.stock.d.split("M").length - 1).toBe(2);
    // The stock is the ring's own loop, not 40 cell loops; the bore is its
    // second subpath, which is what makes the mask punch it.
    const stock = paint.stock.kind === "path" ? paint.stock.d : "";
    // The ring's loop plus the bore: two subpaths, one even-odd path.
    expect(stock.split("M").length - 1).toBe(2);
    expect(stock.split("Z").length - 1).toBe(2);
    const d = paintSvgPath(paint);
    expect(d.split("M").length - 1).toBe(2);
    expect(d.length).toBeGreaterThan(2000);
    // A hub that is *not* inside the copies is a real union: the fast path backs
    // off rather than painting a wrong outline.
    const bigger = csg2Value("union", [
      { kind: "circle", center: { x: 0, y: 0 }, radius: 9 },
      cell,
    ]);
    const slow = csgPaint(bigger);
    expect(slow.empty).toBe(false);
    expect(slow.tree ?? slow.stock).toBeDefined();
  });

  test("a bare repeat paints the same way, and a boolean around it falls back", () => {
    const rep = ring(12);
    expect(csgPaint(rep).stock.kind).toBe("path");
    // `union(repeat, circle)` is not a stamped shape: the compiler takes it.
    const unioned = csg2Value("union", [
      rep,
      { kind: "circle", center: { x: 0, y: 0 }, radius: 1 },
    ]);
    const paint = csgPaint(unioned);
    expect(paint.empty).toBe(false);
    expect(paintSvgPath(paint).length).toBeGreaterThan(0);
  });
});
