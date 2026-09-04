import { evaluateRegions, islandsAabb, islandsSdf } from "./evaluate-regions";
import { signedDist } from "./ops";
import { isFiniteRegion, regionContains, signedDistToRegion, tessellateRegion } from "./region";
import type {
  Circle,
  Csg2,
  CsgOp,
  CsgOperand,
  HalfPlane,
  LineLike,
  Offset,
  Pick,
  Polygon,
  Region,
} from "./types";
import { dist, isFiniteVec, type Vec2 } from "./vec";

const { abs, max, min } = Math;
export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

export function isHalfPlane(v: unknown): v is HalfPlane {
  return !!v && typeof v === "object" && (v as { kind?: string }).kind === "halfPlane";
}

export function isOffset(v: unknown): v is Offset {
  return !!v && typeof v === "object" && (v as { kind?: string }).kind === "offset";
}

export function isCsg2(v: { kind: string }): v is Csg2 {
  return v.kind === "csg2";
}

export function isPick(v: { kind: string }): v is Pick {
  return v.kind === "pick";
}

/** Unary CSG wrapping an offset leaf — `roundOffset` result. */
export function isOffsetCsg(v: Csg2): boolean {
  return v.of.length === 1 && isOffset(v.of[0]);
}

export function offsetOfCsg(v: Csg2): Offset | undefined {
  const o = v.of[0];
  return v.of.length === 1 && isOffset(o) ? o : undefined;
}

export function isFillGeom(v: { kind: string }): v is Region | Csg2 | Pick | Polygon {
  return v.kind === "region" || v.kind === "polygon" || v.kind === "csg2" || v.kind === "pick";
}

export function leftOfValue(line: LineLike): HalfPlane {
  return { kind: "halfPlane", line, side: 1 };
}

export function rightOfValue(line: LineLike): HalfPlane {
  return { kind: "halfPlane", line, side: -1 };
}

export function nanCsg2(): Csg2 {
  return { kind: "csg2", op: "diff", of: [{ kind: "region", outer: [], holes: [] }] };
}

export function nanPick(): Pick {
  return { kind: "pick", of: nanCsg2(), at: { x: Number.NaN, y: Number.NaN } };
}

function isFiniteCircle(c: Circle): boolean {
  return isFiniteVec(c.center) && Number.isFinite(c.radius);
}

function isFiniteHalfPlane(h: HalfPlane): boolean {
  const g = h.line;
  if (!g || (h.side !== 1 && h.side !== -1)) return false;
  if (g.kind === "segment") return isFiniteVec(g.a) && isFiniteVec(g.b);
  if (g.kind === "line") return isFiniteVec(g.origin) && isFiniteVec(g.direction);
  return isFiniteVec(g.line.origin) && isFiniteVec(g.line.direction) && Number.isFinite(g.distance);
}

export function isFiniteOperand(op: CsgOperand): boolean {
  if (op.kind === "region") return isFiniteRegion(op);
  if (op.kind === "circle") return isFiniteCircle(op);
  if (op.kind === "halfPlane") return isFiniteHalfPlane(op);
  if (op.kind === "offset") return isFiniteOperand(op.of) && Number.isFinite(op.d);
  if (op.kind === "pick") return isFiniteOperand(op.of) && isFiniteVec(op.at);
  return isFiniteCsg2(op);
}

export function isFiniteCsg2(r: Csg2): boolean {
  return r.of.length >= 1 && r.of.every(isFiniteOperand);
}

export function isFinitePick(p: Pick): boolean {
  return isFiniteOperand(p.of) && isFiniteVec(p.at);
}

export function asOperand(v: unknown): CsgOperand | undefined {
  if (!v || typeof v !== "object") return undefined;
  const k = (v as { kind?: string }).kind;
  if (
    k === "region" ||
    k === "circle" ||
    k === "csg2" ||
    k === "halfPlane" ||
    k === "offset" ||
    k === "pick"
  )
    return v as CsgOperand;
  return undefined;
}

function asOperands(values: readonly unknown[]): CsgOperand[] | undefined {
  const out: CsgOperand[] = [];
  for (const item of values) {
    const op = asOperand(item);
    if (!op) return undefined;
    out.push(op);
  }
  return out;
}

export function offsetValue(of: CsgOperand, d: number): Offset {
  return { kind: "offset", of, d };
}

export function csg2Value(op: CsgOp, operands: readonly unknown[]): Csg2 {
  const of = asOperands(operands);
  if (!of || of.length < 1) return nanCsg2();
  const r: Csg2 = { kind: "csg2", op, of };
  return isFiniteCsg2(r) ? r : nanCsg2();
}

export function wrapCsg(operand: CsgOperand): Csg2 {
  if (operand.kind === "csg2") return operand;
  return { kind: "csg2", op: "union", of: [operand] };
}

export function pickValue(of: unknown, at: Vec2): Pick {
  const op = asOperand(of);
  if (!op || !isFiniteVec(at)) return nanPick();
  const p: Pick = { kind: "pick", of: op, at: { x: at.x, y: at.y } };
  return isFinitePick(p) ? p : nanPick();
}

export function operandSdf(op: CsgOperand, p: Vec2): number {
  if (op.kind === "region") return signedDistToRegion(op, p);
  if (op.kind === "circle") return dist(p, op.center) - abs(op.radius);
  if (op.kind === "halfPlane") {
    const s = signedDist(p, op.line);
    return op.side === 1 ? -s : s;
  }
  if (op.kind === "offset") return operandSdf(op.of, p) - op.d;
  if (op.kind === "pick") return islandsSdf(evaluateRegions(op), p);
  return csgSdf(op, p);
}

/** Signed distance to the un-offset operand (before subtracting `d`). */
export function offsetSourceSdf(op: Offset, p: Vec2): number {
  return operandSdf(op.of, p);
}

export function csgSdf(r: Csg2, p: Vec2): number {
  if (r.of.length === 0) return Number.NaN;
  if (r.op === "union") {
    let d = operandSdf(r.of[0]!, p);
    if (!Number.isFinite(d)) return Number.NaN;
    for (let i = 1; i < r.of.length; i++) {
      const b = operandSdf(r.of[i]!, p);
      if (!Number.isFinite(b)) return Number.NaN;
      d = min(d, b);
    }
    return d;
  }
  if (r.op === "intersect") {
    let d = operandSdf(r.of[0]!, p);
    if (!Number.isFinite(d)) return Number.NaN;
    for (let i = 1; i < r.of.length; i++) {
      const b = operandSdf(r.of[i]!, p);
      if (!Number.isFinite(b)) return Number.NaN;
      d = max(d, b);
    }
    return d;
  }
  let d = operandSdf(r.of[0]!, p);
  if (!Number.isFinite(d)) return Number.NaN;
  for (let i = 1; i < r.of.length; i++) {
    const b = operandSdf(r.of[i]!, p);
    if (!Number.isFinite(b)) return Number.NaN;
    d = max(d, -b);
  }
  return d;
}

function expand(a: Aabb, b: Aabb): Aabb {
  return {
    minX: min(a.minX, b.minX),
    minY: min(a.minY, b.minY),
    maxX: max(a.maxX, b.maxX),
    maxY: max(a.maxY, b.maxY),
  };
}

function intersectAabb(a: Aabb, b: Aabb): Aabb | undefined {
  const minX = max(a.minX, b.minX);
  const minY = max(a.minY, b.minY);
  const maxX = min(a.maxX, b.maxX);
  const maxY = min(a.maxY, b.maxY);
  if (maxX < minX || maxY < minY) return undefined;
  return { minX, minY, maxX, maxY };
}

function circleAabb(c: Circle): Aabb {
  const r = abs(c.radius);
  return {
    minX: c.center.x - r,
    minY: c.center.y - r,
    maxX: c.center.x + r,
    maxY: c.center.y + r,
  };
}

function regionAabb(p: Region): Aabb | undefined {
  const poly = tessellateRegion(p);
  if (poly.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of poly) {
    minX = min(minX, q.x);
    minY = min(minY, q.y);
    maxX = max(maxX, q.x);
    maxY = max(maxY, q.y);
  }
  if (!Number.isFinite(minX)) return undefined;
  return { minX, minY, maxX, maxY };
}

export function operandAabb(op: CsgOperand): Aabb | undefined {
  if (op.kind === "halfPlane") return undefined;
  if (op.kind === "circle") return isFiniteCircle(op) ? circleAabb(op) : undefined;
  if (op.kind === "region") return isFiniteRegion(op) ? regionAabb(op) : undefined;
  if (op.kind === "offset") {
    const inner = operandAabb(op.of);
    if (!inner) return undefined;
    const pad = abs(op.d);
    return {
      minX: inner.minX - pad,
      minY: inner.minY - pad,
      maxX: inner.maxX + pad,
      maxY: inner.maxY + pad,
    };
  }
  if (op.kind === "pick") return islandsAabb(evaluateRegions(op));
  return csgAabb(op);
}

export function csgAabb(r: Csg2): Aabb | undefined {
  if (r.op === "intersect") {
    let box: Aabb | undefined = undefined;
    for (const op of r.of) {
      const b = operandAabb(op);
      if (!b) continue;
      box = box ? intersectAabb(box, b) : b;
      if (!box) return undefined;
    }
    return box;
  }
  let box: Aabb | undefined = undefined;
  for (const op of r.of) {
    const b = operandAabb(op);
    if (!b) continue;
    box = box ? expand(box, b) : b;
  }
  return box;
}

export function fillAabb(v: Region | Csg2 | Pick): Aabb | undefined {
  if (v.kind === "region") return regionAabb(v);
  if (v.kind === "pick") return operandAabb(v);
  return csgAabb(v);
}

export function islandAabb(p: Pick): Aabb | undefined {
  return islandsAabb(evaluateRegions(p));
}

function occupiedOperand(op: CsgOperand, q: Vec2): boolean {
  if (op.kind === "pick") return evaluateRegions(op).some((r) => regionContains(r, q));
  return operandSdf(op, q) < 0;
}

export function signedDistToCsg(op: CsgOperand, q: Vec2): number {
  if (!isFiniteOperand(op) || !isFiniteVec(q)) return Number.NaN;
  const d = operandSdf(op, q);
  if (!occupiedOperand(op, q)) return Number.isFinite(d) ? max(d, 0) : Number.NaN;
  return d;
}

export function csgContains(op: CsgOperand, q: Vec2): boolean {
  if (!isFiniteOperand(op) || !isFiniteVec(q)) return false;
  return occupiedOperand(op, q);
}

export function distToCsg(op: CsgOperand, q: Vec2): number {
  if (!isFiniteOperand(op) || !isFiniteVec(q)) return Infinity;
  if (occupiedOperand(op, q)) return 0;
  const d = operandSdf(op, q);
  return Number.isFinite(d) ? max(0, d) : Infinity;
}
