import { signedDist } from "./ops";
import { isFiniteProfile, signedDistToProfile, tessellateProfile } from "./profile";
import type { Circle, HalfPlane, LineLike, Profile, Region, RegionOperand } from "./types";
import { dist, isFiniteVec, type Vec2 } from "./vec";

export type RegionOpts = {
  subtract?: RegionOperand | readonly RegionOperand[];
  keep?: RegionOperand | readonly RegionOperand[];
  contains?: Vec2;
};

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

const EPS = 1e-9;
const GRID = 96;
const compiled = new WeakMap<Region, Vec2[][]>();

export function isHalfPlane(v: unknown): v is HalfPlane {
  return !!v && typeof v === "object" && (v as { kind?: string }).kind === "halfPlane";
}

export function isRegion(v: { kind: string }): v is Region {
  return v.kind === "region";
}

export function isFillGeom(v: { kind: string }): v is Profile | Region {
  return v.kind === "profile" || v.kind === "region";
}

export function leftOfValue(line: LineLike): HalfPlane {
  return { kind: "halfPlane", line, side: 1 };
}

export function rightOfValue(line: LineLike): HalfPlane {
  return { kind: "halfPlane", line, side: -1 };
}

export function nanRegion(): Region {
  return { kind: "region", stock: { kind: "profile", outer: [] }, subtract: [], keep: [] };
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

export function isFiniteOperand(op: RegionOperand): boolean {
  if (op.kind === "profile") return isFiniteProfile(op);
  if (op.kind === "circle") return isFiniteCircle(op);
  if (op.kind === "halfPlane") return isFiniteHalfPlane(op);
  return isFiniteRegion(op);
}

export function isFiniteRegion(r: Region): boolean {
  if (!isFiniteOperand(r.stock)) return false;
  return r.subtract.every(isFiniteOperand) && r.keep.every(isFiniteOperand);
}

function asOperand(v: unknown): RegionOperand | null {
  if (!v || typeof v !== "object") return null;
  const k = (v as { kind?: string }).kind;
  if (k === "profile" || k === "circle" || k === "region" || k === "halfPlane")
    return v as RegionOperand;
  return null;
}

function asList(v: unknown): RegionOperand[] | null {
  if (v == null) return [];
  if (Array.isArray(v)) {
    const out: RegionOperand[] = [];
    for (const item of v) {
      const op = asOperand(item);
      if (!op) return null;
      out.push(op);
    }
    return out;
  }
  const one = asOperand(v);
  return one ? [one] : null;
}

export function regionValue(stock: unknown, opts?: RegionOpts): Region {
  const s = asOperand(stock);
  const subtract = asList(opts?.subtract);
  const keep = asList(opts?.keep);
  if (!s || !subtract || !keep) return nanRegion();
  const contains = opts?.contains;
  const r: Region = { kind: "region", stock: s, subtract, keep };
  if (contains && typeof contains === "object") r.contains = { x: contains.x, y: contains.y };
  return isFiniteRegion(r) ? r : nanRegion();
}

function operandSdf(op: RegionOperand, p: Vec2): number {
  if (op.kind === "profile") return signedDistToProfile(op, p);
  if (op.kind === "circle") return dist(p, op.center) - Math.abs(op.radius);
  if (op.kind === "halfPlane") {
    const s = signedDist(p, op.line);
    return op.side === 1 ? -s : s;
  }
  const d = formulaSdf(op, p);
  if (op.contains && isFiniteVec(op.contains) && !islandContains(op, p)) {
    return Number.isFinite(d) ? Math.max(Math.abs(d), 1e-6) : Number.NaN;
  }
  return d;
}

/** CSG field of the formula, ignoring this region's `contains` filter. */
export function formulaSdf(r: Region, p: Vec2): number {
  let d = operandSdf(r.stock, p);
  if (!Number.isFinite(d)) return Number.NaN;
  for (const s of r.subtract) {
    const b = operandSdf(s, p);
    if (!Number.isFinite(b)) return Number.NaN;
    d = Math.max(d, -b);
  }
  for (const k of r.keep) {
    const b = operandSdf(k, p);
    if (!Number.isFinite(b)) return Number.NaN;
    d = Math.max(d, b);
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

function circleAabb(c: Circle): Aabb {
  const r = Math.abs(c.radius);
  return {
    minX: c.center.x - r,
    minY: c.center.y - r,
    maxX: c.center.x + r,
    maxY: c.center.y + r,
  };
}

function profileAabb(p: Profile): Aabb | null {
  const poly = tessellateProfile(p);
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

function operandAabb(op: RegionOperand): Aabb | null {
  if (op.kind === "halfPlane") return null;
  if (op.kind === "circle") return isFiniteCircle(op) ? circleAabb(op) : null;
  if (op.kind === "profile") return isFiniteProfile(op) ? profileAabb(op) : null;
  return regionAabb(op);
}

export function regionAabb(r: Region): Aabb | null {
  let box: Aabb | null = operandAabb(r.stock);
  for (const op of [...r.subtract, ...r.keep]) {
    const b = operandAabb(op);
    if (!b) continue;
    box = box ? expand(box, b) : b;
  }
  return box;
}

function ringArea(ring: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j]!;
    const q = ring[i]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function ringCentroid(ring: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  const n = ring.length || 1;
  return { x: x / n, y: y / n };
}

function ringContains(ring: readonly Vec2[], q: Vec2): boolean {
  if (ring.length < 3) return false;
  let n = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    if (a.y > q.y !== b.y > q.y) {
      const x = a.x + ((q.y - a.y) * (b.x - a.x)) / (b.y - a.y || EPS);
      if (q.x < x) n++;
    }
  }
  return n % 2 === 1;
}

type Seg = { a: Vec2; b: Vec2 };

function lerpZero(a: Vec2, b: Vec2, va: number, vb: number): Vec2 {
  const t = va / (va - vb);
  if (!Number.isFinite(t)) return a;
  const u = Math.min(1, Math.max(0, t));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/** Edges: 0 bottom, 1 right, 2 top, 3 left. Corners: 0 bl, 1 br, 2 tr, 3 tl. */
const CASES: readonly (readonly number[])[] = [
  [],
  [0, 3],
  [0, 1],
  [1, 3],
  [1, 2],
  [0, 3, 1, 2],
  [0, 2],
  [2, 3],
  [2, 3],
  [0, 2],
  [0, 1, 2, 3],
  [1, 2],
  [1, 3],
  [0, 1],
  [0, 3],
  [],
];

function march(r: Region, box: Aabb): Vec2[][] {
  const padX = Math.max((box.maxX - box.minX) * 0.04, 1e-3);
  const padY = Math.max((box.maxY - box.minY) * 0.04, 1e-3);
  const minX = box.minX - padX;
  const minY = box.minY - padY;
  const maxX = box.maxX + padX;
  const maxY = box.maxY + padY;
  const w = maxX - minX;
  const h = maxY - minY;
  const cell = Math.max(w, h) / (GRID - 1);
  const nx = Math.max(8, Math.ceil(w / cell) + 1);
  const ny = Math.max(8, Math.ceil(h / cell) + 1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < nx; i++) xs.push(minX + (i / (nx - 1)) * w);
  for (let j = 0; j < ny; j++) ys.push(minY + (j / (ny - 1)) * h);
  const field = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      field[j * nx + i] = formulaSdf(r, { x: xs[i]!, y: ys[j]! });
    }
  }
  const segs: Seg[] = [];
  const corner = (i: number, j: number): Vec2 => ({ x: xs[i]!, y: ys[j]! });
  const at = (i: number, j: number) => field[j * nx + i]!;
  const edgePt = (i: number, j: number, e: number): Vec2 => {
    if (e === 0) return lerpZero(corner(i, j), corner(i + 1, j), at(i, j), at(i + 1, j));
    if (e === 1)
      return lerpZero(corner(i + 1, j), corner(i + 1, j + 1), at(i + 1, j), at(i + 1, j + 1));
    if (e === 2)
      return lerpZero(corner(i, j + 1), corner(i + 1, j + 1), at(i, j + 1), at(i + 1, j + 1));
    return lerpZero(corner(i, j), corner(i, j + 1), at(i, j), at(i, j + 1));
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v0 = at(i, j);
      const v1 = at(i + 1, j);
      const v2 = at(i + 1, j + 1);
      const v3 = at(i, j + 1);
      if (![v0, v1, v2, v3].every(Number.isFinite)) continue;
      let bits = 0;
      if (v0 < 0) bits |= 1;
      if (v1 < 0) bits |= 2;
      if (v2 < 0) bits |= 4;
      if (v3 < 0) bits |= 8;
      const edges = CASES[bits]!;
      for (let k = 0; k + 1 < edges.length; k += 2) {
        segs.push({ a: edgePt(i, j, edges[k]!), b: edgePt(i, j, edges[k + 1]!) });
      }
    }
  }
  return stitch(segs);
}

function ptKey(p: Vec2): string {
  return `${Math.round(p.x * 1e5)}_${Math.round(p.y * 1e5)}`;
}

function edgeId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function stitch(segs: readonly Seg[]): Vec2[][] {
  const adj = new Map<string, { p: Vec2; other: Vec2; otherKey: string }[]>();
  const add = (a: Vec2, b: Vec2) => {
    const ka = ptKey(a);
    const kb = ptKey(b);
    if (ka === kb) return;
    let list = adj.get(ka);
    if (!list) {
      list = [];
      adj.set(ka, list);
    }
    list.push({ p: a, other: b, otherKey: kb });
  };
  for (const s of segs) {
    add(s.a, s.b);
    add(s.b, s.a);
  }
  const used = new Set<string>();
  const loops: Vec2[][] = [];
  for (const [startKey, startList] of adj) {
    if (!startList[0]) continue;
    const firstEdge = edgeId(startKey, startList[0].otherKey);
    if (used.has(firstEdge)) continue;
    const ring: Vec2[] = [startList[0].p];
    let cur = startKey;
    let prev = "";
    for (let n = 0; n < segs.length + 2; n++) {
      const opts = adj.get(cur);
      if (!opts || opts.length === 0) break;
      const step =
        opts.find((o) => o.otherKey !== prev && !used.has(edgeId(cur, o.otherKey))) ??
        opts.find((o) => o.otherKey !== prev);
      if (!step) break;
      const id = edgeId(cur, step.otherKey);
      if (used.has(id) && ring.length > 2 && step.otherKey === startKey) break;
      used.add(id);
      if (step.otherKey === startKey) {
        if (ring.length >= 3) loops.push(ring);
        break;
      }
      ring.push(step.other);
      prev = cur;
      cur = step.otherKey;
    }
  }
  return loops;
}

function filterIsland(rings: Vec2[][], probe: Vec2): Vec2[][] {
  const containers = rings.filter((ring) => ringContains(ring, probe));
  if (containers.length === 0) return [];
  const outer = containers.reduce((a, b) =>
    Math.abs(ringArea(a)) <= Math.abs(ringArea(b)) ? a : b,
  );
  const holes = rings.filter(
    (ring) =>
      ring !== outer &&
      ringContains(outer, ringCentroid(ring)) &&
      Math.abs(ringArea(ring)) < Math.abs(ringArea(outer)),
  );
  return [outer, ...holes];
}

function compileUncached(r: Region): Vec2[][] {
  const box = regionAabb(r);
  if (!box) return [];
  const rings = march(r, box);
  const probe = r.contains;
  if (!probe || !isFiniteVec(probe)) return rings;
  if (!(formulaSdf(r, probe) < 0)) return [];
  return filterIsland(rings, probe);
}

/** Marching-squares outline. Tests and optional compile only — views use `regionPaint`. */
export function compileRegion(r: Region): Vec2[][] {
  if (!isFiniteRegion(r)) return [];
  let rings = compiled.get(r);
  if (!rings) {
    rings = compileUncached(r);
    compiled.set(r, rings);
  }
  return rings;
}

const ISLAND_GRID = 48;
const islandBoxes = new WeakMap<Region, Aabb | null>();

function inAabb(box: Aabb, q: Vec2, pad = 0): boolean {
  return (
    q.x >= box.minX - pad && q.x <= box.maxX + pad && q.y >= box.minY - pad && q.y <= box.maxY + pad
  );
}

export function aabbPath(box: Aabb): string {
  return `M ${box.minX} ${box.minY} H ${box.maxX} V ${box.maxY} H ${box.minX} Z`;
}

/** Bounding box of the material component that contains `r.contains`. */
export function islandAabb(r: Region): Aabb | null {
  if (!isFiniteRegion(r) || !r.contains || !isFiniteVec(r.contains)) return null;
  if (islandBoxes.has(r)) return islandBoxes.get(r) ?? null;
  const box = floodIslandAabb(r);
  islandBoxes.set(r, box);
  return box;
}

function floodIslandAabb(r: Region): Aabb | null {
  const probe = r.contains;
  if (!probe || !(formulaSdf(r, probe) < 0)) return null;
  const bounds = regionAabb(r);
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
  const at = (i: number, j: number) => formulaSdf(r, { x: minX + i * cellX, y: minY + j * cellY });
  const seen = new Uint8Array(nx * ny);
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
    minX: minX + iMin * cellX - cellX,
    minY: minY + jMin * cellY - cellY,
    maxX: minX + iMax * cellX + cellX,
    maxY: minY + jMax * cellY + cellY,
  };
}

function islandContains(r: Region, q: Vec2): boolean {
  if (!(formulaSdf(r, q) < 0)) return false;
  const box = islandAabb(r);
  return box != null && inAabb(box, q);
}

function occupied(r: Region, q: Vec2): boolean {
  if (!(formulaSdf(r, q) < 0)) return false;
  if (!r.contains || !isFiniteVec(r.contains)) return true;
  return islandContains(r, q);
}

export function signedDistToRegion(r: Region, q: Vec2): number {
  if (!isFiniteRegion(r) || !isFiniteVec(q)) return Number.NaN;
  const d = formulaSdf(r, q);
  if (!occupied(r, q)) return Number.isFinite(d) ? Math.max(d, 0) : Number.NaN;
  return d;
}

export function regionContains(r: Region, q: Vec2): boolean {
  if (!isFiniteRegion(r) || !isFiniteVec(q)) return false;
  return occupied(r, q);
}

export function distToRegion(r: Region, q: Vec2): number {
  if (!isFiniteRegion(r) || !isFiniteVec(q)) return Infinity;
  if (occupied(r, q)) return 0;
  const d = formulaSdf(r, q);
  return Number.isFinite(d) ? Math.max(0, d) : Infinity;
}

/** Polyline path of `compileRegion`. Not the view; prefer `regionPaint` for exact operands. */
export function regionSvgPath(r: Region): string {
  const rings = compileRegion(r);
  if (rings.length === 0) return "";
  const parts: string[] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const start = ring[0]!;
    const cmds = [`M ${start.x} ${start.y}`];
    for (let i = 1; i < ring.length; i++) cmds.push(`L ${ring[i]!.x} ${ring[i]!.y}`);
    cmds.push("Z");
    parts.push(cmds.join(" "));
  }
  return parts.join(" ");
}
