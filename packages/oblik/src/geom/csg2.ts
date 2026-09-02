import { signedDist } from "./ops";
import { isFiniteRegion, signedDistToRegion, tessellateRegion } from "./region";
import type {
  Circle,
  Csg2,
  CsgOp,
  CsgOperand,
  HalfPlane,
  LineLike,
  Offset,
  Pick,
  Region,
} from "./types";
import { dist, isFiniteVec, type Vec2 } from "./vec";

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

export function offsetOfCsg(v: Csg2): Offset | null {
  const o = v.of[0];
  return v.of.length === 1 && isOffset(o) ? o : null;
}

export function isFillGeom(v: { kind: string }): v is Region | Csg2 | Pick {
  return v.kind === "region" || v.kind === "csg2" || v.kind === "pick";
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

export function asOperand(v: unknown): CsgOperand | null {
  if (!v || typeof v !== "object") return null;
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
  return null;
}

function asOperands(values: readonly unknown[]): CsgOperand[] | null {
  const out: CsgOperand[] = [];
  for (const item of values) {
    const op = asOperand(item);
    if (!op) return null;
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
  if (op.kind === "circle") return dist(p, op.center) - Math.abs(op.radius);
  if (op.kind === "halfPlane") {
    const s = signedDist(p, op.line);
    return op.side === 1 ? -s : s;
  }
  if (op.kind === "offset") return operandSdf(op.of, p) - op.d;
  if (op.kind === "pick") {
    const d = operandSdf(op.of, p);
    if (op.at && isFiniteVec(op.at) && !islandContains(op, p)) {
      return Number.isFinite(d) ? Math.max(Math.abs(d), 1e-6) : Number.NaN;
    }
    return d;
  }
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
      d = Math.min(d, b);
    }
    return d;
  }
  if (r.op === "intersect") {
    let d = operandSdf(r.of[0]!, p);
    if (!Number.isFinite(d)) return Number.NaN;
    for (let i = 1; i < r.of.length; i++) {
      const b = operandSdf(r.of[i]!, p);
      if (!Number.isFinite(b)) return Number.NaN;
      d = Math.max(d, b);
    }
    return d;
  }
  let d = operandSdf(r.of[0]!, p);
  if (!Number.isFinite(d)) return Number.NaN;
  for (let i = 1; i < r.of.length; i++) {
    const b = operandSdf(r.of[i]!, p);
    if (!Number.isFinite(b)) return Number.NaN;
    d = Math.max(d, -b);
  }
  return d;
}

function expand(a: Aabb, b: Aabb): Aabb {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function intersectAabb(a: Aabb, b: Aabb): Aabb | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

function circleAabb(c: Circle): Aabb {
  const r = Math.abs(c.radius);
  return {
    minX: c.center.x - r,
    minY: c.center.y - r,
    maxX: c.center.x + r,
    maxY: c.center.y + r,
  };
}

function regionAabb(p: Region): Aabb | null {
  const poly = tessellateRegion(p);
  if (poly.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of poly) {
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export function operandAabb(op: CsgOperand): Aabb | null {
  if (op.kind === "halfPlane") return null;
  if (op.kind === "circle") return isFiniteCircle(op) ? circleAabb(op) : null;
  if (op.kind === "region") return isFiniteRegion(op) ? regionAabb(op) : null;
  if (op.kind === "offset") {
    const inner = operandAabb(op.of);
    if (!inner) return null;
    const pad = Math.abs(op.d);
    return {
      minX: inner.minX - pad,
      minY: inner.minY - pad,
      maxX: inner.maxX + pad,
      maxY: inner.maxY + pad,
    };
  }
  if (op.kind === "pick") return operandAabb(op.of);
  return csgAabb(op);
}

export function csgAabb(r: Csg2): Aabb | null {
  if (r.op === "intersect") {
    let box: Aabb | null = null;
    for (const op of r.of) {
      const b = operandAabb(op);
      if (!b) continue;
      box = box ? intersectAabb(box, b) : b;
      if (!box) return null;
    }
    return box;
  }
  let box: Aabb | null = null;
  for (const op of r.of) {
    const b = operandAabb(op);
    if (!b) continue;
    box = box ? expand(box, b) : b;
  }
  return box;
}

export function fillAabb(v: Region | Csg2 | Pick): Aabb | null {
  if (v.kind === "region") return regionAabb(v);
  if (v.kind === "pick") return operandAabb(v);
  return csgAabb(v);
}

const ISLAND_GRID = 64;
const islands = new WeakMap<object, Island | null>();

type Island = {
  box: Aabb;
  nx: number;
  ny: number;
  minX: number;
  minY: number;
  cellX: number;
  cellY: number;
  occ: Uint8Array;
};

function islandOf(p: Pick): Island | null {
  if (!isFinitePick(p)) return null;
  if (islands.has(p)) return islands.get(p) ?? null;
  const found = floodIsland(p.of, p.at);
  islands.set(p, found);
  return found;
}

export function islandAabb(p: Pick): Aabb | null {
  return islandOf(p)?.box ?? null;
}

export function islandClipPath(p: Pick): string | null {
  const m = islandOf(p);
  if (!m) return null;
  return occupancyPath(m, 1);
}

function occupancyPath(m: Island, dilate: number): string {
  const { nx, ny, occ } = m;
  const on = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    if (occ[i + j * nx]) return true;
    if (dilate < 1) return false;
    return (
      (i > 0 && !!occ[i - 1 + j * nx]) ||
      (i + 1 < nx && !!occ[i + 1 + j * nx]) ||
      (j > 0 && !!occ[i + (j - 1) * nx]) ||
      (j + 1 < ny && !!occ[i + (j + 1) * nx])
    );
  };
  const parts: string[] = [];
  for (let j = 0; j < ny; j++) {
    let i = 0;
    while (i < nx) {
      while (i < nx && !on(i, j)) i++;
      if (i >= nx) break;
      const i0 = i;
      while (i < nx && on(i, j)) i++;
      const x0 = m.minX + (i0 - 0.5) * m.cellX;
      const x1 = m.minX + (i - 0.5) * m.cellX;
      const y0 = m.minY + (j - 0.5) * m.cellY;
      const y1 = m.minY + (j + 0.5) * m.cellY;
      parts.push(`M ${x0} ${y0} H ${x1} V ${y1} H ${x0} Z`);
    }
  }
  return parts.join(" ");
}

function fieldSdf(op: CsgOperand, q: Vec2): number {
  if (op.kind === "pick") return operandSdf(op.of, q);
  return operandSdf(op, q);
}

function floodIsland(op: CsgOperand, probe: Vec2): Island | null {
  if (!(fieldSdf(op, probe) < 0)) return null;
  const bounds = operandAabb(op);
  if (!bounds) return null;
  const padX = Math.max((bounds.maxX - bounds.minX) * 0.04, 1e-3);
  const padY = Math.max((bounds.maxY - bounds.minY) * 0.04, 1e-3);
  const minX = bounds.minX - padX;
  const minY = bounds.minY - padY;
  const maxX = bounds.maxX + padX;
  const maxY = bounds.maxY + padY;
  const w = maxX - minX;
  const h = maxY - minY;
  const nx = ISLAND_GRID;
  const ny = Math.max(8, Math.round((ISLAND_GRID * h) / (w || 1)));
  const cellX = w / (nx - 1);
  const cellY = h / (ny - 1);
  const gx = (x: number) => Math.min(nx - 1, Math.max(0, Math.round((x - minX) / cellX)));
  const gy = (y: number) => Math.min(ny - 1, Math.max(0, Math.round((y - minY) / cellY)));
  const at = (i: number, j: number) => fieldSdf(op, { x: minX + i * cellX, y: minY + j * cellY });
  const seen = new Uint8Array(nx * ny);
  const occ = new Uint8Array(nx * ny);
  const stack = [gx(probe.x) + gy(probe.y) * nx];
  seen[stack[0]!] = 1;
  let iMin = nx;
  let iMax = -1;
  let jMin = ny;
  let jMax = -1;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % nx;
    const j = (k / nx) | 0;
    if (!(at(i, j) < 0)) continue;
    occ[k] = 1;
    if (i < iMin) iMin = i;
    if (i > iMax) iMax = i;
    if (j < jMin) jMin = j;
    if (j > jMax) jMax = j;
    const push = (ii: number, jj: number) => {
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) return;
      const idx = ii + jj * nx;
      if (seen[idx]) return;
      seen[idx] = 1;
      stack.push(idx);
    };
    push(i - 1, j);
    push(i + 1, j);
    push(i, j - 1);
    push(i, j + 1);
  }
  if (iMax < iMin) return null;
  return {
    box: {
      minX: minX + iMin * cellX - cellX,
      minY: minY + jMin * cellY - cellY,
      maxX: minX + iMax * cellX + cellX,
      maxY: minY + jMax * cellY + cellY,
    },
    nx,
    ny,
    minX,
    minY,
    cellX,
    cellY,
    occ,
  };
}

function islandContains(p: Pick, q: Vec2): boolean {
  if (!(fieldSdf(p.of, q) < 0)) return false;
  const m = islandOf(p);
  if (!m) return false;
  const i = Math.min(m.nx - 1, Math.max(0, Math.round((q.x - m.minX) / m.cellX)));
  const j = Math.min(m.ny - 1, Math.max(0, Math.round((q.y - m.minY) / m.cellY)));
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= m.nx || jj >= m.ny) continue;
      if (m.occ[ii + jj * m.nx]) return true;
    }
  }
  return false;
}

function occupiedOperand(op: CsgOperand, q: Vec2): boolean {
  if (op.kind === "pick") return islandContains(op, q);
  return operandSdf(op, q) < 0;
}

export function signedDistToCsg(op: CsgOperand, q: Vec2): number {
  if (!isFiniteOperand(op) || !isFiniteVec(q)) return Number.NaN;
  const d = operandSdf(op, q);
  if (!occupiedOperand(op, q)) return Number.isFinite(d) ? Math.max(d, 0) : Number.NaN;
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
  return Number.isFinite(d) ? Math.max(0, d) : Infinity;
}
