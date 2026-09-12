import {
  classifyIslands,
  edgeMid,
  roundOffsetValue,
  splitWalks,
  walkFragments,
  walkTangentAt,
} from "./offset";
import { lineBasis, lineIntersectionValue, signedDist } from "./ops";
import {
  isCircleWalk,
  isFiniteRegion,
  regionContains,
  regionSvgPath,
  signedDistToRegion,
  tessellateRegion,
} from "./region";
import { foldIntoCopy, repeatStep, rotateRegion } from "./repeat";
import type {
  Circle,
  Csg2,
  CsgOp,
  CsgOperand,
  HalfPlane,
  LineLike,
  Loop,
  LoopEdge,
  Offset,
  Pick,
  PolarRepeat,
  Polygon,
  Region,
} from "./types";
import { add, dist, isFiniteVec, mul, norm, perp, type Vec2 } from "./vec";

const { abs, max, min } = Math;
/** Distance below which two seam endpoints are the same point. */
const EPS = 1e-9;
/** Below this a radius/length is treated as degenerate. */
const EDGE_MIN = 1e-6;

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

export function isHalfPlane(v: { kind: string }): v is HalfPlane {
  return v.kind === "halfPlane";
}

export function isOffset(v: { kind: string }): v is Offset {
  return v.kind === "offset";
}

export function isCsg2(v: { kind: string }): v is Csg2 {
  return v.kind === "csg2";
}

export function isPick(v: { kind: string }): v is Pick {
  return v.kind === "pick";
}

export function isPolarRepeat(v: { kind: string }): v is PolarRepeat {
  return v.kind === "polarRepeat";
}

/** Unary CSG wrapping an offset leaf — `roundOffset` result. */
export function isOffsetCsg(v: Csg2): boolean {
  return offsetOfCsg(v) !== undefined;
}

export function offsetOfCsg(v: Csg2): Offset | undefined {
  const o = v.of[0];
  return v.of.length === 1 && o !== undefined && isOffset(o) ? o : undefined;
}

export function isFillGeom(v: { kind: string }): v is Region | Csg2 | Pick | Polygon | PolarRepeat {
  return (
    v.kind === "region" ||
    v.kind === "polygon" ||
    v.kind === "csg2" ||
    v.kind === "pick" ||
    v.kind === "polarRepeat"
  );
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

export function nanPolarRepeat(): PolarRepeat {
  return {
    kind: "polarRepeat",
    of: { kind: "region", outer: [], holes: [] },
    count: Number.NaN,
    about: { x: Number.NaN, y: Number.NaN },
    rotation: 0,
  };
}

/** `count` copies of `of` about `about`, `2π/count` apart, spun by `rotation`. */
export function polarRepeatValue(
  of: CsgOperand,
  count: number,
  about: Vec2,
  rotation: number,
): PolarRepeat {
  const rep: PolarRepeat = {
    kind: "polarRepeat",
    of,
    count: Number.isFinite(count) ? Math.max(1, Math.round(count)) : Number.NaN,
    about: { x: about.x, y: about.y },
    rotation,
  };
  return isFinitePolarRepeat(rep) ? rep : nanPolarRepeat();
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
  if (op.kind === "polarRepeat") return isFinitePolarRepeat(op);
  return isFiniteCsg2(op);
}

export function isFinitePolarRepeat(r: PolarRepeat): boolean {
  return (
    Number.isFinite(r.count) &&
    r.count >= 1 &&
    Number.isFinite(r.rotation) &&
    isFiniteVec(r.about) &&
    isFiniteOperand(r.of)
  );
}

export function isFiniteCsg2(r: Csg2): boolean {
  return r.of.length >= 1 && r.of.every(isFiniteOperand);
}

export function isFinitePick(p: Pick): boolean {
  return isFiniteOperand(p.of) && isFiniteVec(p.at);
}

/** The seven operand kinds. */
const OPERAND_KINDS = new Set<CsgOperand["kind"]>([
  "region",
  "circle",
  "csg2",
  "halfPlane",
  "offset",
  "pick",
  "polarRepeat",
]);

/**
 * Gate for one operand. The type says what an authored scene promises; this says
 * what the tape actually holds — scene source is evaluated as printed text, so a
 * wrong kind arrives as a value, never as a compile error. A miss is NaN
 * geometry (which the views omit), not a thrown error.
 */
export function isCsgOperand(v: CsgOperand): boolean {
  return !!v && typeof v === "object" && OPERAND_KINDS.has(v.kind);
}

/** Same gate over a list: undefined unless every element is an operand. */
function asOperands(operands: readonly CsgOperand[]): CsgOperand[] | undefined {
  if (!Array.isArray(operands)) return undefined;
  const out: CsgOperand[] = [];
  for (const op of operands) {
    if (!isCsgOperand(op)) return undefined;
    out.push(op);
  }
  return out;
}

export function offsetValue(of: CsgOperand, d: number): Offset {
  return { kind: "offset", of, d };
}

export function csg2Value(op: CsgOp, operands: readonly CsgOperand[]): Csg2 {
  const of = asOperands(operands);
  if (!of || of.length < 1) return nanCsg2();
  const r: Csg2 = { kind: "csg2", op, of };
  return isFiniteCsg2(r) ? r : nanCsg2();
}

export function wrapCsg(operand: CsgOperand): Csg2 {
  if (operand.kind === "csg2") return operand;
  return { kind: "csg2", op: "union", of: [operand] };
}

export function pickValue(of: CsgOperand, at: Vec2): Pick {
  if (!isCsgOperand(of) || !at || typeof at !== "object") return nanPick();
  const p: Pick = { kind: "pick", of, at: { x: at.x, y: at.y } };
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
  // The nearest copy wins: a rotation is rigid, so folding `p` into that copy's
  // frame leaves the distance alone and only one copy is ever evaluated.
  if (op.kind === "polarRepeat") return operandSdf(op.of, foldIntoCopy(p, op));
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
  if (op.kind === "polarRepeat") return repeatAabb(op);
  return csgAabb(op);
}

/** A repeat's box: every rotated corner of the copy's box, unioned — exact for
 * the copies' *boxes* (the shapes inside them only get closer to the axis). A
 * huge count falls back to the disc through the farthest corner, which is a
 * superset and costs one `hypot` per corner. */
function rotateAabb(box: Aabb, about: Vec2, ang: number): Aabb {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ]) {
    const vx = corner.x - about.x;
    const vy = corner.y - about.y;
    const x = about.x + vx * c - vy * s;
    const y = about.y + vx * s + vy * c;
    minX = min(minX, x);
    minY = min(minY, y);
    maxX = max(maxX, x);
    maxY = max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function repeatAabb(rep: PolarRepeat): Aabb | undefined {
  if (!Number.isFinite(rep.count) || rep.count < 1) return undefined;
  const first = operandAabb(rep.of);
  if (!first) return undefined;
  if (rep.count > MAX_AABB_COPIES) {
    const r = max(
      dist({ x: first.minX, y: first.minY }, rep.about),
      dist({ x: first.maxX, y: first.minY }, rep.about),
      dist({ x: first.maxX, y: first.maxY }, rep.about),
      dist({ x: first.minX, y: first.maxY }, rep.about),
    );
    return {
      minX: rep.about.x - r,
      minY: rep.about.y - r,
      maxX: rep.about.x + r,
      maxY: rep.about.y + r,
    };
  }
  let box: Aabb | undefined;
  const step = repeatStep(rep.count);
  for (let k = 0; k < rep.count; k++) {
    const turned = rotateAabb(first, rep.about, rep.rotation + k * step);
    box = box ? expand(box, turned) : turned;
  }
  return box;
}

/** Above this many copies a repeat's box is taken as the disc through the
 * copy's corners instead of unioning rotated boxes. */
const MAX_AABB_COPIES = 64;

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

export function fillAabb(v: Region | Csg2 | Pick | PolarRepeat): Aabb | undefined {
  if (v.kind === "region") return regionAabb(v);
  if (v.kind === "pick" || v.kind === "polarRepeat") return operandAabb(v);
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

// ---- CSG evaluation ----
// Mutually recursive with the operand primitives above: a `pick` operand
// evaluates regions, and evaluating regions resolves leaves through them.
/** Cheap reject: |sdf(mid)| above this is not a boundary candidate. */
const COARSE = 1e-3;

function circleRegion(c: Circle): Region | undefined {
  if (!isFiniteVec(c.center) || !Number.isFinite(c.radius) || abs(c.radius) < EDGE_MIN) {
    return undefined;
  }
  return {
    kind: "region",
    outer: { kind: "circle", center: { x: c.center.x, y: c.center.y }, radius: abs(c.radius) },
    holes: [],
  };
}

/** Two semicircles so a full disk participates in splitWalks. */
function circleAsEdges(c: Circle): LoopEdge[] {
  const r = abs(c.radius);
  const e = { x: c.center.x + r, y: c.center.y };
  const w = { x: c.center.x - r, y: c.center.y };
  return [
    { a: e, b: w, carrier: c, k: 1 },
    { a: w, b: e, carrier: c, k: 1 },
  ];
}

function edgesOf(w: Loop): LoopEdge[] {
  return isCircleWalk(w) ? circleAsEdges(w) : w;
}

function loopsOf(r: Region): Loop[] {
  return [r.outer, ...r.holes];
}

export function islandsSdf(islands: readonly Region[], p: Vec2): number {
  if (islands.length === 0) return Infinity;
  let d = signedDistToRegion(islands[0]!, p);
  if (!Number.isFinite(d)) return Number.NaN;
  for (let i = 1; i < islands.length; i++) {
    const b = signedDistToRegion(islands[i]!, p);
    if (!Number.isFinite(b)) return Number.NaN;
    d = min(d, b);
  }
  return d;
}

export function islandsSvgPath(islands: readonly Region[]): string {
  return islands
    .map((r) => regionSvgPath(r))
    .filter((d) => d.length > 0)
    .join(" ");
}

export function islandsAabb(islands: readonly Region[]): Aabb | undefined {
  let box: Aabb | undefined = undefined;
  for (const r of islands) {
    const b = operandAabb(r);
    if (!b) continue;
    box = box
      ? {
          minX: min(box.minX, b.minX),
          minY: min(box.minY, b.minY),
          maxX: max(box.maxX, b.maxX),
          maxY: max(box.maxY, b.maxY),
        }
      : b;
  }
  return box;
}

function booleanSdf(op: CsgOp, groups: readonly (readonly Region[])[], p: Vec2): number {
  if (groups.length === 0) return Number.NaN;
  if (op === "union") {
    let d = islandsSdf(groups[0]!, p);
    if (!Number.isFinite(d)) return Number.NaN;
    for (let i = 1; i < groups.length; i++) {
      const b = islandsSdf(groups[i]!, p);
      if (!Number.isFinite(b)) return Number.NaN;
      d = min(d, b);
    }
    return d;
  }
  if (op === "intersect") {
    let d = islandsSdf(groups[0]!, p);
    if (!Number.isFinite(d)) return Number.NaN;
    for (let i = 1; i < groups.length; i++) {
      const b = islandsSdf(groups[i]!, p);
      if (!Number.isFinite(b)) return Number.NaN;
      d = max(d, b);
    }
    return d;
  }
  let d = islandsSdf(groups[0]!, p);
  if (!Number.isFinite(d)) return Number.NaN;
  for (let i = 1; i < groups.length; i++) {
    const b = islandsSdf(groups[i]!, p);
    if (!Number.isFinite(b)) return Number.NaN;
    d = max(d, -b);
  }
  return d;
}

function cheapMaybeBoundary(e: LoopEdge, sdf: (p: Vec2) => number): boolean {
  if (dist(e.a, e.b) < EDGE_MIN) return false;
  const mid = edgeMid(e);
  const dm = sdf(mid);
  if (!Number.isFinite(dm) || abs(dm) > COARSE) return false;
  const da = sdf(e.a);
  const db = sdf(e.b);
  if (Number.isFinite(da) && abs(da) > COARSE * 4) return false;
  if (Number.isFinite(db) && abs(db) > COARSE * 4) return false;
  return true;
}

function transverseHairs(e: LoopEdge): number[] {
  const span = dist(e.a, e.b);
  const base = max(1e-5, min(span * 0.05, 1e-3));
  const hairs = [base];
  if (e.carrier.kind !== "circle") return hairs;
  const r = abs(e.carrier.radius);
  // `signedDistToRegion` signs from a tessellated walk. sampleArc(24) sagittas
  // ~0.002 r, so a 1e-3 hair can land both samples outside the polygon even
  // when the true circle is a result boundary. Clear that band.
  const arc = min(r * 0.02, span * 0.25, 5e-2);
  if (arc > base * 1.05) hairs.push(max(base, arc));
  return hairs;
}

function transverseKeep(e: LoopEdge, sdf: (p: Vec2) => number): boolean {
  const mid = edgeMid(e);
  const t = walkTangentAt(e, mid);
  const n = perp(norm(t));
  if (!isFiniteVec(n)) return false;
  for (const hair of transverseHairs(e)) {
    const left = sdf(add(mid, mul(n, hair)));
    const right = sdf(add(mid, mul(n, -hair)));
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    if (left * right < 0) return true;
  }
  return false;
}

function keepBoundary(e: LoopEdge, sdf: (p: Vec2) => number): boolean {
  return cheapMaybeBoundary(e, sdf) && transverseKeep(e, sdf);
}

function sameEnds(a: LoopEdge, b: LoopEdge): boolean {
  const fwd = dist(a.a, b.a) < 1e-6 && dist(a.b, b.b) < 1e-6;
  const rev = dist(a.a, b.b) < 1e-6 && dist(a.b, b.a) < 1e-6;
  return fwd || rev;
}

function collapseSpans(frags: readonly LoopEdge[]): LoopEdge[] {
  const n = frags.length;
  const drop = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (drop[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (drop[j]) continue;
      if (!sameEnds(frags[i]!, frags[j]!)) continue;
      // Two semicircles of one disk share poles but not the arc; mids differ.
      if (dist(edgeMid(frags[i]!), edgeMid(frags[j]!)) > 1e-3) continue;
      const reversed = dist(frags[i]!.a, frags[j]!.b) < 1e-6;
      if (reversed) {
        drop[i] = 1;
        drop[j] = 1;
      } else {
        drop[j] = 1;
      }
      break;
    }
  }
  const out: LoopEdge[] = [];
  for (let i = 0; i < n; i++) if (!drop[i]) out.push(frags[i]!);
  return out;
}

function collectWalks(groups: readonly (readonly Region[])[]): LoopEdge[][] {
  const walks: LoopEdge[][] = [];
  for (const g of groups) {
    for (const r of g) {
      if (!isFiniteRegion(r)) continue;
      for (const w of loopsOf(r)) walks.push(edgesOf(w));
    }
  }
  return walks;
}

function booleanRegions(op: CsgOp, groups: readonly (readonly Region[])[]): Region[] {
  const nonempty = groups.filter((g) => g.some((r) => isFiniteRegion(r)));
  if (op === "intersect" && nonempty.length !== groups.length) return [];
  if (nonempty.length === 0) return [];
  if (nonempty.length === 1 && (op === "union" || op === "diff")) {
    return nonempty[0]!.filter((r) => isFiniteRegion(r));
  }
  const walks = collectWalks(op === "intersect" ? nonempty : groups);
  if (walks.length === 0) return [];
  const sdf = (p: Vec2) => booleanSdf(op, groups, p);
  const kept = splitWalks(walks).filter((e) => keepBoundary(e, sdf));
  const faces = collapseSpans(kept);
  if (faces.length < 2) return [];
  return classifyIslands(walkFragments(faces));
}

function expandBox(a: Aabb, b: Aabb): Aabb {
  return {
    minX: min(a.minX, b.minX),
    minY: min(a.minY, b.minY),
    maxX: max(a.maxX, b.maxX),
    maxY: max(a.maxY, b.maxY),
  };
}

function islandsBox(islands: readonly Region[]): Aabb | undefined {
  let box: Aabb | undefined = undefined;
  for (const r of islands) {
    const b = operandAabb(r);
    if (!b) continue;
    box = box ? expandBox(box, b) : b;
  }
  return box;
}

function planeSdf(h: HalfPlane, p: Vec2): number {
  return operandSdf(h, p);
}

function onSeg(a: Vec2, b: Vec2, p: Vec2): boolean {
  const ab = dist(a, b);
  if (ab < EDGE_MIN) return false;
  return dist(a, p) + dist(p, b) <= ab + 1e-7;
}

/** Line span covering a padded AABB so a half-plane can join the arrangement. */
function clipSpan(h: HalfPlane, box: Aabb): LoopEdge | undefined {
  const { origin, dir } = lineBasis(h.line);
  const n = norm(dir);
  if (!isFiniteVec(n) || !isFiniteVec(origin)) return undefined;
  const pad = max(box.maxX - box.minX, box.maxY - box.minY, 1) * 0.08;
  const minX = box.minX - pad;
  const minY = box.minY - pad;
  const maxX = box.maxX + pad;
  const maxY = box.maxY + pad;
  const sides: Array<[Vec2, Vec2]> = [
    [
      { x: minX, y: minY },
      { x: maxX, y: minY },
    ],
    [
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
    ],
    [
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    [
      { x: minX, y: maxY },
      { x: minX, y: minY },
    ],
  ];
  const hits: Vec2[] = [];
  for (const [a, b] of sides) {
    const p = lineIntersectionValue(h.line, { kind: "segment", a, b });
    if (!isFiniteVec(p) || !onSeg(a, b, p)) continue;
    if (hits.some((q) => dist(q, p) < 1e-8)) continue;
    hits.push(p);
  }
  if (hits.length < 2) return undefined;
  hits.sort((p, q) => {
    const tp = (p.x - origin.x) * n.x + (p.y - origin.y) * n.y;
    const tq = (q.x - origin.x) * n.x + (q.y - origin.y) * n.y;
    return tp - tq;
  });
  const a = hits[0]!;
  const b = hits[hits.length - 1]!;
  if (dist(a, b) < EDGE_MIN) return undefined;
  return { a, b, carrier: h.line };
}

function clipByPlanes(islands: Region[], planes: readonly HalfPlane[]): Region[] {
  if (islands.length === 0 || planes.length === 0) return islands;
  const box = islandsBox(islands);
  if (!box) return [];
  const extra: LoopEdge[][] = [];
  for (const h of planes) {
    const span = clipSpan(h, box);
    if (span) extra.push([span]);
  }
  const sdf = (p: Vec2) => {
    let d = islandsSdf(islands, p);
    if (!Number.isFinite(d)) return Number.NaN;
    for (const h of planes) {
      const b = planeSdf(h, p);
      if (!Number.isFinite(b)) return Number.NaN;
      d = max(d, b);
    }
    return d;
  };
  const walks = [...collectWalks([islands]), ...extra];
  if (walks.length === 0) return [];
  const kept = splitWalks(walks).filter((e) => keepBoundary(e, sdf));
  const faces = collapseSpans(kept);
  if (faces.length < 2) return [];
  return classifyIslands(walkFragments(faces));
}

function evaluateCsg(node: Csg2): Region[] {
  if (node.of.length === 1 && (node.op === "union" || node.op === "diff")) {
    return evaluateRegions(node.of[0]!);
  }
  if (node.op === "intersect") {
    const planes: HalfPlane[] = [];
    const groups: Region[][] = [];
    for (const child of node.of) {
      if (child.kind === "halfPlane") planes.push(child);
      else groups.push(evaluateRegions(child));
    }
    if (groups.length === 0) return [];
    const solids = groups.length === 1 ? groups[0]! : booleanRegions("intersect", groups);
    return planes.length === 0 ? solids : clipByPlanes(solids, planes);
  }
  return booleanRegions(
    node.op,
    node.of.map((child) => evaluateRegions(child)),
  );
}

const compileCache = new WeakMap<CsgOperand, Region[]>();

/**
 * Compile a CSG operand to declared cheese islands. Experimental: carriers
 * are split, cheap-filtered, then kept on a transverse SDF sign change.
 * Circular spans retry a longer hair so tessellated region SDF sagittas
 * do not drop true cap remnants.
 */
export function evaluateRegions(op: CsgOperand): Region[] {
  const hit = compileCache.get(op);
  if (hit) return hit;
  const out = compileOperand(op);
  compileCache.set(op, out);
  return out;
}

function compileOperand(op: CsgOperand): Region[] {
  if (!isFiniteOperand(op)) return [];
  if (op.kind === "region") return isFiniteRegion(op) ? [op] : [];
  if (op.kind === "circle") {
    const r = circleRegion(op);
    return r ? [r] : [];
  }
  if (op.kind === "halfPlane") return [];
  if (op.kind === "offset") {
    const out: Region[] = [];
    for (const island of evaluateRegions(op.of)) {
      out.push(...roundOffsetValue(island, op.d));
    }
    return out;
  }
  if (op.kind === "pick") {
    return evaluateRegions(op.of).filter((r) => regionContains(r, op.at));
  }
  if (op.kind === "polarRepeat") return stampRepeat(op);
  return evaluateCsg(op);
}

/**
 * The copies of a repeat, stamped out as real islands: the cell once, turned
 * `count` times about the axis. Cheap (no CSG compile) and exact — a rotation is
 * rigid, so the copies are the child's own spans turned, and disjoint because
 * the child fits its sector. This is what the SVG view paints (one even-odd
 * path, the union for disjoint copies, no boolean) and what island queries test.
 *
 * The *field* never comes through here: the fill shader folds one copy per pixel
 * (see `geom/repeat.ts`).
 */
export function stampRepeat(op: PolarRepeat): Region[] {
  const inner = evaluateRegions(op.of);
  if (inner.length === 0) return [];
  const out: Region[] = [];
  const step = repeatStep(op.count);
  for (let k = 0; k < op.count; k++) {
    const ang = op.rotation + k * step;
    for (const island of inner) out.push(rotateRegion(island, op.about, ang));
  }
  return out;
}

/**
 * The copies' *union outline*: the edges two copies share are the seams between
 * them — interior to the union, not boundary — so they drop out, and the edges
 * that survive chain across copies into the ring's own loop.
 *
 * This is what a painter needs, because a stroke follows every subpath: stamping
 * the cells verbatim would trace each seam and draw the repeat's joins as radial
 * spokes. The field does not need it — there the seams are covered by the hub
 * disc the fill unions in (see `layout/gear.ts`) — but the SVG view strokes its
 * path, so the merge has to happen in the geometry.
 *
 * Copies that share no edges (a ring of separated teeth) come back one island
 * per copy, which is what they are. So does a copy whose outer loop is a whole
 * circle, where there is no vertex to merge on.
 */
export function mergeRepeatOutline(op: PolarRepeat): Region[] {
  const islands = stampRepeat(op);
  if (islands.length <= 1) return islands;
  const loops = islands.map((island) => island.outer);
  if (loops.some((loop) => !Array.isArray(loop))) return islands;
  const seen = new Map<string, number>();
  for (const loop of loops) {
    for (const e of loop as LoopEdge[]) seen.set(edgeKey(e), (seen.get(edgeKey(e)) ?? 0) + 1);
  }
  const out: Region[] = [];
  let run: LoopEdge[] = [];
  const flush = () => {
    if (run.length > 0) out.push({ kind: "region", outer: run, holes: [] });
    run = [];
  };
  for (const loop of loops) {
    for (const e of loop as LoopEdge[]) {
      // Shared with a neighbouring copy: interior, so it is not boundary.
      if ((seen.get(edgeKey(e)) ?? 0) > 1) continue;
      // A run continues while the next surviving edge starts where the last
      // one ended: copies that tile chain into one loop, copies that do not
      // start a fresh one.
      const prev = run[run.length - 1];
      if (prev && dist(prev.b, e.a) > EPS) flush();
      run.push(e);
    }
  }
  flush();
  return out.length > 0 ? out : islands;
}

/** Undirected edge identity: two copies sharing a seam carry it in opposite
 * directions, so the key ignores direction. */
function edgeKey(e: LoopEdge): string {
  const a = `${e.a.x.toFixed(9)},${e.a.y.toFixed(9)}`;
  const b = `${e.b.x.toFixed(9)},${e.b.y.toFixed(9)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** True when every probe's CSG membership matches some compiled island. */
export function compileAgrees(op: CsgOperand, probes: readonly Vec2[]): boolean {
  const islands = evaluateRegions(op);
  for (const p of probes) {
    if (!isFiniteVec(p) || !isFiniteOperand(op)) continue;
    const d = operandSdf(op, p);
    if (!Number.isFinite(d) || abs(d) < COARSE) continue;
    const field = d < 0;
    const compiled = islands.some((r) => regionContains(r, p));
    if (field !== compiled) return false;
  }
  return true;
}
