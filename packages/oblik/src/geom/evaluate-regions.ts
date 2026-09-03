import { isFiniteOperand, operandAabb, operandSdf, type Aabb } from "./csg2";
import {
  classifyIslands,
  edgeMid,
  roundOffsetValue,
  splitWalks,
  walkFragments,
  walkTangentAt,
} from "./offset";
import { lineBasis, lineIntersectionValue } from "./ops";
import {
  isCircleWalk,
  isFiniteRegion,
  regionContains,
  regionSvgPath,
  signedDistToRegion,
} from "./region";
import type { Circle, Csg2, CsgOp, CsgOperand, HalfPlane, Loop, LoopEdge, Region } from "./types";
import { add, dist, isFiniteVec, mul, norm, perp, type Vec2 } from "./vec";

const EDGE_MIN = 1e-6;
/** Cheap reject: |sdf(mid)| above this is not a boundary candidate. */
const COARSE = 1e-3;

function circleRegion(c: Circle): Region | null {
  if (!isFiniteVec(c.center) || !Number.isFinite(c.radius) || Math.abs(c.radius) < EDGE_MIN) {
    return null;
  }
  return {
    kind: "region",
    outer: { kind: "circle", center: { x: c.center.x, y: c.center.y }, radius: Math.abs(c.radius) },
    holes: [],
  };
}

/** Two semicircles so a full disk participates in splitWalks. */
function circleAsEdges(c: Circle): LoopEdge[] {
  const r = Math.abs(c.radius);
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
    d = Math.min(d, b);
  }
  return d;
}

export function islandsSvgPath(islands: readonly Region[]): string {
  return islands
    .map((r) => regionSvgPath(r))
    .filter((d) => d.length > 0)
    .join(" ");
}

export function islandsAabb(islands: readonly Region[]): Aabb | null {
  let box: Aabb | null = null;
  for (const r of islands) {
    const b = operandAabb(r);
    if (!b) continue;
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
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
      d = Math.min(d, b);
    }
    return d;
  }
  if (op === "intersect") {
    let d = islandsSdf(groups[0]!, p);
    if (!Number.isFinite(d)) return Number.NaN;
    for (let i = 1; i < groups.length; i++) {
      const b = islandsSdf(groups[i]!, p);
      if (!Number.isFinite(b)) return Number.NaN;
      d = Math.max(d, b);
    }
    return d;
  }
  let d = islandsSdf(groups[0]!, p);
  if (!Number.isFinite(d)) return Number.NaN;
  for (let i = 1; i < groups.length; i++) {
    const b = islandsSdf(groups[i]!, p);
    if (!Number.isFinite(b)) return Number.NaN;
    d = Math.max(d, -b);
  }
  return d;
}

function cheapMaybeBoundary(e: LoopEdge, sdf: (p: Vec2) => number): boolean {
  if (dist(e.a, e.b) < EDGE_MIN) return false;
  const mid = edgeMid(e);
  const dm = sdf(mid);
  if (!Number.isFinite(dm) || Math.abs(dm) > COARSE) return false;
  const da = sdf(e.a);
  const db = sdf(e.b);
  if (Number.isFinite(da) && Math.abs(da) > COARSE * 4) return false;
  if (Number.isFinite(db) && Math.abs(db) > COARSE * 4) return false;
  return true;
}

function transverseKeep(e: LoopEdge, sdf: (p: Vec2) => number): boolean {
  const mid = edgeMid(e);
  const t = walkTangentAt(e, mid);
  const n = perp(norm(t));
  if (!isFiniteVec(n)) return false;
  const span = dist(e.a, e.b);
  const hair = Math.max(1e-5, Math.min(span * 0.05, 1e-3));
  const left = sdf(add(mid, mul(n, hair)));
  const right = sdf(add(mid, mul(n, -hair)));
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return left * right < 0;
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
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function islandsBox(islands: readonly Region[]): Aabb | null {
  let box: Aabb | null = null;
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
function clipSpan(h: HalfPlane, box: Aabb): LoopEdge | null {
  const { origin, dir } = lineBasis(h.line);
  const n = norm(dir);
  if (!isFiniteVec(n) || !isFiniteVec(origin)) return null;
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1) * 0.08;
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
  if (hits.length < 2) return null;
  hits.sort((p, q) => {
    const tp = (p.x - origin.x) * n.x + (p.y - origin.y) * n.y;
    const tq = (q.x - origin.x) * n.x + (q.y - origin.y) * n.y;
    return tp - tq;
  });
  const a = hits[0]!;
  const b = hits[hits.length - 1]!;
  if (dist(a, b) < EDGE_MIN) return null;
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
      d = Math.max(d, b);
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
  return evaluateCsg(op);
}

/** True when every probe's CSG membership matches some compiled island. */
export function compileAgrees(op: CsgOperand, probes: readonly Vec2[]): boolean {
  const islands = evaluateRegions(op);
  for (const p of probes) {
    if (!isFiniteVec(p) || !isFiniteOperand(op)) continue;
    const d = operandSdf(op, p);
    if (!Number.isFinite(d) || Math.abs(d) < COARSE) continue;
    const field = d < 0;
    const compiled = islands.some((r) => regionContains(r, p));
    if (field !== compiled) return false;
  }
  return true;
}
