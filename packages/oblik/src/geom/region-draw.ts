import { signedDist } from "./ops";
import { profileSvgPath } from "./profile";
import { islandClipPath, isFiniteRegion, regionAabb, type Aabb } from "./region";
import type { Circle, HalfPlane, Profile, Region, RegionOperand } from "./types";
import { isFiniteVec, lerp, type Vec2 } from "./vec";

export type DrawOp =
  | { kind: "profile"; d: string }
  | { kind: "circle"; cx: number; cy: number; r: number };

export type FlattenedRegion = {
  stock: Profile | Circle;
  subtract: (Profile | Circle)[];
  keep: HalfPlane[];
  contains?: Vec2;
};

export type RegionPaint = {
  empty: boolean;
  box: Aabb;
  stock: DrawOp;
  holes: DrawOp[];
  keepClip?: string;
  islandClip?: string;
};

/** Luminance polarity. White is visible in the mask. */
export const REGION_MASK = {
  fill: { canvas: "#000", stock: "#fff", hole: "#000" },
  /** Outside the stock profile — outward halo on the outer edge. */
  outsideStock: { canvas: "#fff", stock: "#000" },
  /** Interior of the stock profile, so hole halos cannot escape the plate. */
  stock: { canvas: "#000", stock: "#fff" },
  /** Complement of the CSG fill (void and holes). */
  outside: { canvas: "#fff", stock: "#000", hole: "#fff" },
} as const;

const emptyPaint = (): RegionPaint => ({
  empty: true,
  box: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  stock: { kind: "profile", d: "" },
  holes: [],
});

function padAabb(box: Aabb, pad: number): Aabb {
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
}

function asSolid(op: RegionOperand): Profile | Circle | null {
  return op.kind === "profile" || op.kind === "circle" ? op : null;
}

export function flattenRegion(r: Region): FlattenedRegion | null {
  const subtract: (Profile | Circle)[] = [];
  const keep: HalfPlane[] = [];
  let contains = r.contains;
  let node: RegionOperand = r;
  while (node.kind === "region") {
    if (node.contains && isFiniteVec(node.contains) && !(contains && isFiniteVec(contains))) {
      contains = node.contains;
    }
    for (const s of node.subtract) {
      const solid = asSolid(s);
      if (solid) subtract.push(solid);
    }
    for (const k of node.keep) {
      if (k.kind === "halfPlane") keep.push(k);
    }
    node = node.stock;
  }
  if (node.kind !== "profile" && node.kind !== "circle") return null;
  const out: FlattenedRegion = { stock: node, subtract, keep };
  if (contains && isFiniteVec(contains)) out.contains = contains;
  return out;
}

function drawOp(op: Profile | Circle): DrawOp {
  if (op.kind === "circle") {
    return { kind: "circle", cx: op.center.x, cy: op.center.y, r: Math.abs(op.radius) };
  }
  return { kind: "profile", d: profileSvgPath(op) };
}

function halfSdf(h: HalfPlane, p: Vec2): number {
  const s = signedDist(p, h.line);
  return h.side === 1 ? -s : s;
}

function aabbPoly(box: Aabb): Vec2[] {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}

function clipByHalfPlane(poly: readonly Vec2[], h: HalfPlane): Vec2[] {
  const out: Vec2[] = [];
  if (poly.length === 0) return out;
  const inside = (p: Vec2) => halfSdf(h, p) < 1e-9;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ia = inside(a);
    const ib = inside(b);
    if (ia && ib) out.push(b);
    else if (ia && !ib) {
      const da = halfSdf(h, a);
      const db = halfSdf(h, b);
      out.push(lerp(a, b, da / (da - db)));
    } else if (!ia && ib) {
      const da = halfSdf(h, a);
      const db = halfSdf(h, b);
      out.push(lerp(a, b, da / (da - db)));
      out.push(b);
    }
  }
  return out;
}

function polyPath(poly: readonly Vec2[]): string {
  if (poly.length < 3) return "";
  const s = poly[0]!;
  const parts = [`M ${s.x} ${s.y}`];
  for (let i = 1; i < poly.length; i++) parts.push(`L ${poly[i]!.x} ${poly[i]!.y}`);
  parts.push("Z");
  return parts.join(" ");
}

function keepClipPath(keeps: readonly HalfPlane[], box: Aabb): string | undefined {
  if (keeps.length === 0) return undefined;
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  let poly = aabbPoly(padAabb(box, span * 4));
  for (const h of keeps) poly = clipByHalfPlane(poly, h);
  return polyPath(poly);
}

/**
 * Exact operand paths plus a luminance mask (white stock, black subtracts) and
 * optional keep / island clips. Escaping cutters stay black-on-black — not XOR.
 * Nested region subtracts are not expanded; the stock-cutters scene does not need that.
 */
export function regionPaint(r: Region): RegionPaint {
  if (!isFiniteRegion(r)) return emptyPaint();
  const flat = flattenRegion(r);
  if (!flat) return emptyPaint();
  const box = regionAabb(r);
  if (!box) return emptyPaint();
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-3);
  const padded = padAabb(box, span * 0.08);
  let islandClip: string | undefined;
  if (flat.contains && isFiniteVec(flat.contains)) {
    const clip = islandClipPath(r);
    if (!clip) return emptyPaint();
    islandClip = clip;
  }
  const keepClip = keepClipPath(flat.keep, padded);
  if (keepClip === "") return emptyPaint();
  return {
    empty: false,
    box: padded,
    stock: drawOp(flat.stock),
    holes: flat.subtract
      .map(drawOp)
      .filter((op) => (op.kind === "profile" ? op.d.length > 0 : op.r > 0)),
    keepClip,
    islandClip,
  };
}
