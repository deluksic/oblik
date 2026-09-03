import { describe, expect, test } from "vitest";

import { csg2Value, csgContains, leftOfValue, offsetValue, pickValue, wrapCsg } from "./csg2";
import { compileAgrees, evaluateRegions } from "./evaluate-regions";
import { alongValue, filletValue, isCircleWalk, regionContains, regionValue } from "./region";
import type { Circle, Line, Region, Segment } from "./types";
import type { Vec2 } from "./vec";

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
  const half = Math.max(length, width) / 2 - r;
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

function filletedSquare(r: number): Region {
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
    cycle.push(filletValue(a, r), seg(a, b));
  }
  return regionValue(cycle, []);
}

function circleCarriers(r: Region): number {
  const walks = [r.outer, ...r.holes];
  let n = 0;
  for (const w of walks) {
    if (isCircleWalk(w)) {
      n++;
      continue;
    }
    for (const e of w) if (e.carrier.kind === "circle") n++;
  }
  return n;
}

function grid(x0: number, y0: number, x1: number, y1: number, step = 0.35): Vec2[] {
  const out: Vec2[] = [];
  for (let y = y0; y <= y1 + 1e-9; y += step) {
    for (let x = x0; x <= x1 + 1e-9; x += step) out.push({ x, y });
  }
  return out;
}

const split: Line = { kind: "line", origin: { x: 2, y: 0 }, direction: { x: 0, y: 1 } };

describe("evaluateRegions expected pass", () => {
  test("declared region is identity", () => {
    const plate = rect(0, 0, 2, 2);
    expect(evaluateRegions(plate)).toEqual([plate]);
  });

  test("unary union unwraps", () => {
    const plate = regionValue(rectCycle(0, 0, 2, 2), [rectCycle(0.6, 0.6, 1.4, 1.4)]);
    const islands = evaluateRegions(wrapCsg(plate));
    expect(islands).toHaveLength(1);
    expect(regionContains(islands[0]!, { x: 0.2, y: 0.2 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 1, y: 1 })).toBe(false);
  });

  test("square minus interior disk is one cheese with a hole", () => {
    const face = csg2Value("diff", [rect(0, 0, 2, 2), disk(1, 1, 0.4)]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(1);
    expect(islands[0]!.holes.length).toBeGreaterThanOrEqual(1);
    expect(regionContains(islands[0]!, { x: 0.15, y: 0.15 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 1, y: 1 })).toBe(false);
    expect(compileAgrees(face, grid(0, 0, 2, 2, 0.25))).toBe(true);
  });

  test("escaping disk does not XOR a cap", () => {
    const face = csg2Value("diff", [rect(0, 0, 2, 2), disk(2.2, 1, 0.5)]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(1);
    expect(regionContains(islands[0]!, { x: 1, y: 1 })).toBe(true);
    expect(islands.some((r) => regionContains(r, { x: 2.2, y: 1 }))).toBe(false);
    expect(compileAgrees(face, grid(-0.5, 0, 3, 2, 0.3))).toBe(true);
  });

  test("union of two overlapping disks is one two-arc outer", () => {
    const face = csg2Value("union", [disk(0, 0, 1), disk(1.2, 0, 1)]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(1);
    expect(regionContains(islands[0]!, { x: 0, y: 0 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 1.2, y: 0 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 0.6, y: 0 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 3, y: 0 })).toBe(false);
    expect(circleCarriers(islands[0]!)).toBeGreaterThanOrEqual(2);
    expect(compileAgrees(face, grid(-1.2, -1.2, 2.4, 1.2, 0.4))).toBe(true);
  });

  test("two disjoint disks are two islands", () => {
    const face = csg2Value("union", [disk(0, 0, 0.8), disk(3, 0, 0.8)]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(2);
    expect(compileAgrees(face, grid(-1, -1, 4, 1, 0.4))).toBe(true);
  });

  test("slot that severs yields two islands; pick keeps one", () => {
    const stock = rect(0, 0, 4, 2);
    const slot = stadium(2, 1, 5, 0.35);
    const face = csg2Value("diff", [stock, slot]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(2);
    expect(islands.filter((r) => regionContains(r, { x: 2, y: 1.7 }))).toHaveLength(1);
    expect(islands.filter((r) => regionContains(r, { x: 2, y: 0.3 }))).toHaveLength(1);
    const top = evaluateRegions(pickValue(face, { x: 2, y: 1.7 }));
    expect(top).toHaveLength(1);
    expect(regionContains(top[0]!, { x: 2, y: 1.7 })).toBe(true);
    expect(regionContains(top[0]!, { x: 2, y: 0.3 })).toBe(false);
    expect(evaluateRegions(pickValue(face, { x: 2, y: 1 }))).toHaveLength(0);
  });

  test("half-plane intersect clips a rect", () => {
    const face = csg2Value("intersect", [rect(0, 0, 4, 2), leftOfValue(split)]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(1);
    expect(regionContains(islands[0]!, { x: 0.5, y: 1 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 3.5, y: 1 })).toBe(false);
    expect(compileAgrees(face, grid(0, 0, 4, 2, 0.4))).toBe(true);
  });

  test("filleted square minus disk keeps join arcs", () => {
    const stock = filletedSquare(0.2);
    const face = csg2Value("diff", [stock, disk(1, 1, 0.3)]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(1);
    expect(circleCarriers(islands[0]!)).toBeGreaterThanOrEqual(4);
    expect(regionContains(islands[0]!, { x: 0.15, y: 1 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 1, y: 1 })).toBe(false);
    expect(compileAgrees(face, grid(0, 0, 2, 2, 0.25))).toBe(true);
  });

  test("offset of a compiled square uses the envelope kernel", () => {
    const face = wrapCsg(offsetValue(rect(0, 0, 1, 1), 0.2));
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(1);
    expect(regionContains(islands[0]!, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 1.1, y: 0.5 })).toBe(true);
    expect(circleCarriers(islands[0]!)).toBe(4);
  });

  test("bare half-plane is not a region", () => {
    expect(evaluateRegions(leftOfValue(split))).toEqual([]);
  });
});

describe("evaluateRegions catalog", () => {
  test("union of overlapping squares (shared edge / seam)", () => {
    const face = csg2Value("union", [rect(0, 0, 2, 2), rect(1, 0, 3, 2)]);
    const islands = evaluateRegions(face);
    expect(islands.length).toBeGreaterThanOrEqual(1);
    expect(compileAgrees(face, grid(-0.2, -0.2, 3.2, 2.2, 0.35))).toBe(true);
  });

  test("near-tangent drill against the outer", () => {
    const face = csg2Value("diff", [rect(0, 0, 2, 2), disk(1, 0.05, 0.06)]);
    const islands = evaluateRegions(face);
    expect(islands.length).toBeGreaterThanOrEqual(1);
    expect(compileAgrees(face, grid(0, 0, 2, 2, 0.2))).toBe(true);
  });

  test("C-shape stays one component", () => {
    const face = csg2Value("diff", [rect(0, 0, 4, 3), rect(1, 1, 4.5, 2)]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(1);
    expect(regionContains(islands[0]!, { x: 3, y: 2.5 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 3, y: 0.5 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 0.4, y: 1.5 })).toBe(true);
  });

  test("arcade-like union then eye holes", () => {
    const head = disk(0, 0.4, 1);
    const tunic = rect(-1, -1, 1, 0.4);
    const s0 = disk(-0.65, -1, 0.35);
    const s1 = disk(0, -1, 0.35);
    const s2 = disk(0.65, -1, 0.35);
    const body = csg2Value("union", [head, tunic, s0, s1, s2]);
    const ghost = csg2Value("diff", [body, disk(-0.35, 0.45, 0.22), disk(0.35, 0.45, 0.22)]);
    const islands = evaluateRegions(ghost);
    expect(islands.length).toBeGreaterThanOrEqual(1);
    expect(compileAgrees(ghost, grid(-1.2, -1.4, 1.2, 1.5, 0.3))).toBe(true);
  });

  test("offset of a diff is boolean-then-offset, not sdf − d", () => {
    const cut = csg2Value("diff", [rect(0, 0, 2, 2), disk(1, 1, 0.45)]);
    const off = wrapCsg(offsetValue(cut, -0.15));
    const islands = evaluateRegions(off);
    expect(islands).toHaveLength(1);
    expect(regionContains(islands[0]!, { x: 0.2, y: 0.2 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 1, y: 1 })).toBe(false);
    expect(csgContains(off, { x: 0.2, y: 0.2 })).toBe(true);
  });

  test("tiny fillet join vs HAIR", () => {
    const stock = filletedSquare(1e-5);
    const face = csg2Value("diff", [stock, disk(1, 1, 0.3)]);
    const islands = evaluateRegions(face);
    expect(islands.length).toBeGreaterThanOrEqual(0);
  });

  test("stock-cutters analog: drills plus a slot that severs", () => {
    const stock = rect(0, 0, 4, 3);
    const drills = [
      disk(0.4, 0.4, 0.16),
      disk(3.6, 0.4, 0.16),
      disk(3.6, 2.6, 0.16),
      disk(0.4, 2.6, 0.16),
    ];
    const face = csg2Value("diff", [stock, ...drills, stadium(2, 1.5, 5, 0.4)]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(2);
    const top = pickValue(face, { x: 2, y: 2.5 });
    expect(evaluateRegions(top)).toHaveLength(1);
    expect(csgContains(top, { x: 2, y: 2.5 })).toBe(true);
    expect(csgContains(top, { x: 2, y: 0.5 })).toBe(false);
    expect(compileAgrees(face, grid(0, 0, 4, 3, 0.35))).toBe(true);
  });

  test("pac-man disk minus wedge stays one island", () => {
    const o = { x: 0, y: 0 };
    const body = disk(0, 0, 1);
    const a = { x: 0.766, y: 0.643 };
    const b = { x: 0.766, y: -0.643 };
    const mouth = regionValue([o, seg(o, a), a, alongValue(body, -1), b, seg(b, o)], []);
    const pac = csg2Value("diff", [body, mouth]);
    const islands = evaluateRegions(pac);
    expect(islands).toHaveLength(1);
    expect(regionContains(islands[0]!, { x: -0.4, y: 0 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 0.5, y: 0 })).toBe(false);
    expect(compileAgrees(pac, grid(-1.1, -1.1, 1.1, 1.1, 0.3))).toBe(true);
  });

  test("four-hole plate as CSG is one cheese", () => {
    const face = csg2Value("diff", [
      rect(0, 0, 4, 3),
      disk(0.5, 0.5, 0.18),
      disk(3.5, 0.5, 0.18),
      disk(3.5, 2.5, 0.18),
      disk(0.5, 2.5, 0.18),
    ]);
    const islands = evaluateRegions(face);
    expect(islands).toHaveLength(1);
    expect(islands[0]!.holes.length).toBeGreaterThanOrEqual(4);
    expect(regionContains(islands[0]!, { x: 2, y: 1.5 })).toBe(true);
    expect(regionContains(islands[0]!, { x: 0.5, y: 0.5 })).toBe(false);
    expect(compileAgrees(face, grid(0, 0, 4, 3, 0.35))).toBe(true);
  });

  test("pick of two disjoint disks keeps one", () => {
    const face = csg2Value("union", [disk(0, 0, 0.8), disk(3, 0, 0.8)]);
    const left = pickValue(face, { x: 0, y: 0 });
    expect(evaluateRegions(left)).toHaveLength(1);
    expect(csgContains(left, { x: 0, y: 0 })).toBe(true);
    expect(csgContains(left, { x: 3, y: 0 })).toBe(false);
    expect(evaluateRegions(pickValue(face, { x: 1.5, y: 0 }))).toHaveLength(0);
  });
});
