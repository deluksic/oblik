import { circleUnitAt } from "./gliders";
import { filletVertices } from "./offset";
import { lineBasis } from "./ops";
import type { Along, Branch, Circle, Fillet, LineLike, Loop, LoopEdge, Region } from "./types";
import {
  add,
  cross2,
  dist,
  distToSegment,
  dot,
  isFiniteVec,
  mul,
  sub,
  vec,
  type Vec2,
} from "./vec";


const { PI, abs, atan2, ceil, cos, max, min, sin } = Math;
const EPS = 1e-9;

export function isAlong(v: unknown): v is Along {
  return !!v && typeof v === "object" && (v as { kind?: string }).kind === "along";
}

export function isFillet(v: unknown): v is Fillet {
  return !!v && typeof v === "object" && (v as { kind?: string }).kind === "fillet";
}

export function isRegion(v: { kind: string }): v is Region {
  return v.kind === "region";
}

export function alongValue(carrier: Circle, k: number): Along {
  return { kind: "along", carrier, k: k < 0 ? -1 : 1 };
}

export function filletValue(at: Vec2, r: number): Fillet {
  return { kind: "fillet", at: { x: at.x, y: at.y }, r };
}

export function nanRegion(): Region {
  return { kind: "region", outer: [], holes: [] };
}

export function isCircleWalk(w: Loop): w is Circle {
  return !Array.isArray(w);
}

/** Piecewise spans, or `[]` for a full-circle walk. */
export function walkEdges(w: Loop): LoopEdge[] {
  return Array.isArray(w) ? w : [];
}

export function isFiniteWalk(w: Loop): boolean {
  if (isCircleWalk(w)) {
    return isFiniteVec(w.center) && Number.isFinite(w.radius) && abs(w.radius) > EPS;
  }
  if (w.length < 2) return false;
  return w.every((e) => isFiniteEdge(e));
}

export function isFiniteRegion(p: Region): boolean {
  if (!isFiniteWalk(p.outer)) return false;
  return p.holes.every((h) => isFiniteWalk(h));
}

function isFiniteEdge(e: LoopEdge): boolean {
  if (!isFiniteVec(e.a) || !isFiniteVec(e.b)) return false;
  if (e.carrier.kind === "circle") {
    const c = e.carrier;
    if (!isFiniteVec(c.center) || !Number.isFinite(c.radius) || abs(c.radius) < EPS)
      return false;
    if (e.k !== 1 && e.k !== -1) return false;
    return dist(e.a, e.b) > EPS;
  }
  const { origin, dir } = lineBasis(e.carrier);
  return isFiniteVec(origin) && isFiniteVec(dir) && dist(e.a, e.b) > EPS;
}

function asVec2(v: unknown): Vec2 | null {
  if (!v || typeof v !== "object") return null;
  const p = v as { x?: unknown; y?: unknown; kind?: string };
  if (
    p.kind === "along" ||
    p.kind === "fillet" ||
    p.kind === "circle" ||
    p.kind === "line" ||
    p.kind === "segment" ||
    p.kind === "parallelLine"
  ) {
    return null;
  }
  if (typeof p.x === "number" && typeof p.y === "number") return { x: p.x, y: p.y };
  return null;
}

function asLineLike(v: unknown): LineLike | null {
  if (!v || typeof v !== "object") return null;
  const g = v as { kind?: string };
  if (g.kind === "line" || g.kind === "segment" || g.kind === "parallelLine") return v as LineLike;
  return null;
}

export function projectOnLine(geom: LineLike, p: Vec2): Vec2 {
  const { origin, dir } = lineBasis(geom);
  const s = dot(sub(p, origin), dir);
  return add(origin, mul(dir, s));
}

export function projectOnCircle(c: Circle, p: Vec2): Vec2 {
  const u = circleUnitAt(c, p);
  return add(c.center, mul({ x: u.ux, y: u.uy }, abs(c.radius)));
}

/** CCW from `from` through `through` is `1`. */
export function alongK(c: Circle, from: Vec2, through: Vec2): Branch {
  const cr = cross2(sub(from, c.center), sub(through, c.center));
  if (abs(cr) < 1e-12) return 1;
  return cr > 0 ? 1 : -1;
}

/** Signed CCW delta from `a` to `b` on `c` (k=1) or CW (k=-1), in (0, 2π]. */
export function circleDelta(c: Circle, a: Vec2, b: Vec2, k: Branch): number {
  const ua = circleUnitAt(c, a);
  const ub = circleUnitAt(c, b);
  let delta = atan2(ub.uy, ub.ux) - atan2(ua.uy, ua.ux);
  if (k === 1) {
    while (delta <= 0) delta += 2 * PI;
    while (delta > 2 * PI) delta -= 2 * PI;
  } else {
    while (delta >= 0) delta -= 2 * PI;
    while (delta < -2 * PI) delta += 2 * PI;
  }
  return delta;
}

function asVertex(v: unknown): { at: Vec2; r: number } | null {
  if (isFillet(v)) {
    if (!Number.isFinite(v.r) || v.r < 0) return null;
    const at = asVec2(v.at);
    if (!at || !isFiniteVec(at)) return null;
    return { at, r: v.r };
  }
  const at = asVec2(v);
  if (!at || !isFiniteVec(at)) return null;
  return { at, r: 0 };
}

export type WalkInput = Circle | readonly unknown[];

function asCircleWalk(v: unknown): Circle | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const c = v as { kind?: string; center?: Vec2; radius?: unknown };
  if (c.kind !== "circle" || !c.center || !isFiniteVec(c.center)) return null;
  if (typeof c.radius !== "number" || !Number.isFinite(c.radius) || abs(c.radius) < EPS) {
    return null;
  }
  return {
    kind: "circle",
    center: { x: c.center.x, y: c.center.y },
    radius: abs(c.radius),
  };
}

function asWalk(v: unknown): Loop | null {
  const circle = asCircleWalk(v);
  if (circle) return circle;
  if (Array.isArray(v)) return walkFromCycle(v);
  return null;
}

function parseWalk(cycle: readonly unknown[]): { edges: LoopEdge[]; radii: number[] } | null {
  if (!Array.isArray(cycle) || cycle.length < 4 || cycle.length % 2 !== 0) return null;
  const n = cycle.length / 2;
  const points: Vec2[] = [];
  const radii: number[] = [];
  const carriers: Array<{ geom: LineLike | Circle; k?: Branch }> = [];
  for (let i = 0; i < n; i++) {
    const vtx = asVertex(cycle[i * 2]);
    if (!vtx) return null;
    points.push(vtx.at);
    radii.push(vtx.r);
    const item = cycle[i * 2 + 1];
    if (isAlong(item)) {
      if (item.carrier.kind !== "circle") return null;
      carriers.push({ geom: item.carrier, k: item.k < 0 ? -1 : 1 });
      continue;
    }
    const line = asLineLike(item);
    if (line) {
      carriers.push({ geom: line });
      continue;
    }
    return null;
  }
  const edges: LoopEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const c = carriers[i]!;
    if (c.geom.kind === "circle") {
      if (c.k !== 1 && c.k !== -1) return null;
      edges.push({
        a: projectOnCircle(c.geom, a),
        b: projectOnCircle(c.geom, b),
        carrier: c.geom,
        k: c.k,
      });
    } else {
      edges.push({
        a: projectOnLine(c.geom, a),
        b: projectOnLine(c.geom, b),
        carrier: c.geom,
      });
    }
  }
  return { edges, radii };
}

function walkFromCycle(cycle: readonly unknown[]): LoopEdge[] | null {
  const parsed = parseWalk(cycle);
  if (!parsed) return null;
  const sharp: Region = { kind: "region", outer: parsed.edges, holes: [] };
  if (!isFiniteRegion(sharp)) return null;
  const filleted = filletVertices(sharp, parsed.radii);
  if (!isFiniteRegion(filleted)) return null;
  const edges = walkEdges(filleted.outer);
  return edges.length >= 2 ? edges : null;
}

/**
 * Holes must sit strictly inside the outer walk, pairwise disjoint, and not
 * touch. Overlap, nesting, or a hole that exits the outer is invalid.
 */
export function regionTopologyOk(p: Region): boolean {
  if (!isFiniteRegion(p)) return false;
  if (p.holes.length === 0) return true;
  const outerPoly = tessellateWalk(p.outer);
  if (outerPoly.length < 3) return false;
  const holePolys: Vec2[][] = [];
  for (const hole of p.holes) {
    const poly = tessellateWalk(hole);
    if (poly.length < 3) return false;
    if (polysTouch(poly, outerPoly)) return false;
    for (const q of poly) {
      if (!polyContains(outerPoly, q)) return false;
    }
    holePolys.push(poly);
  }
  for (let i = 0; i < holePolys.length; i++) {
    for (let j = i + 1; j < holePolys.length; j++) {
      if (polysInterfere(holePolys[i]!, holePolys[j]!)) return false;
    }
  }
  return true;
}

export function regionValue(cycle: WalkInput, holes: readonly WalkInput[]): Region {
  const outer = asWalk(cycle);
  if (!outer) return nanRegion();
  const parsed: Loop[] = [];
  for (const holeCycle of holes) {
    const hole = asWalk(holeCycle);
    if (!hole) return nanRegion();
    parsed.push(hole);
  }
  const p: Region = { kind: "region", outer, holes: parsed };
  if (!regionTopologyOk(p)) return nanRegion();
  return p;
}

function sampleArc(e: LoopEdge, steps = 24): Vec2[] {
  if (e.carrier.kind !== "circle" || (e.k !== 1 && e.k !== -1)) return [e.a, e.b];
  const c = e.carrier;
  const delta = circleDelta(c, e.a, e.b, e.k);
  const ua = circleUnitAt(c, e.a);
  const a0 = atan2(ua.uy, ua.ux);
  const out: Vec2[] = [];
  const n = max(2, ceil((abs(delta) / PI) * steps));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ang = a0 + delta * t;
    out.push(add(c.center, mul(vec(cos(ang), sin(ang)), abs(c.radius))));
  }
  return out;
}

const tessellatedWalks = new WeakMap<Loop, Vec2[]>();
const tessellated = new WeakMap<Region, Vec2[]>();

export function tessellateWalk(w: Loop): Vec2[] {
  const hit = tessellatedWalks.get(w);
  if (hit) return hit;
  if (isCircleWalk(w)) {
    const r = abs(w.radius);
    const poly: Vec2[] = [];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = (2 * PI * i) / n;
      poly.push({ x: w.center.x + r * cos(a), y: w.center.y + r * sin(a) });
    }
    tessellatedWalks.set(w, poly);
    return poly;
  }
  const poly: Vec2[] = [];
  for (const e of w) {
    poly.push(e.a);
    if (e.carrier.kind === "circle") poly.push(...sampleArc(e));
  }
  tessellatedWalks.set(w, poly);
  return poly;
}

/** Outer walk only — AABB, winding, and offset. Holes are separate walks. */
export function tessellateRegion(p: Region): Vec2[] {
  const hit = tessellated.get(p);
  if (hit) return hit;
  const poly = tessellateWalk(p.outer);
  tessellated.set(p, poly);
  return poly;
}

function polyContains(poly: readonly Vec2[], q: Vec2): boolean {
  if (poly.length < 3 || !isFiniteVec(q)) return false;
  let n = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    if (a.y > q.y !== b.y > q.y) {
      const x = a.x + ((q.y - a.y) * (b.x - a.x)) / (b.y - a.y || EPS);
      if (q.x < x) n++;
    }
  }
  return n % 2 === 1;
}

function segmentsCross(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean {
  const d1 = cross2(sub(b1, b0), sub(a0, b0));
  const d2 = cross2(sub(b1, b0), sub(a1, b0));
  const d3 = cross2(sub(a1, a0), sub(b0, a0));
  const d4 = cross2(sub(a1, a0), sub(b1, a0));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function pointOnPolyBoundary(poly: readonly Vec2[], q: Vec2): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distToSegment(q, poly[j]!, poly[i]!) < 1e-7) return true;
  }
  return false;
}

function polysTouch(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0, i0 = a.length - 1; i < a.length; i0 = i++) {
    const a0 = a[i0]!;
    const a1 = a[i]!;
    for (let k = 0, k0 = b.length - 1; k < b.length; k0 = k++) {
      const b0 = b[k0]!;
      const b1 = b[k]!;
      if (segmentsCross(a0, a1, b0, b1)) return true;
      if (distToSegment(a0, b0, b1) < 1e-7) return true;
      if (distToSegment(a1, b0, b1) < 1e-7) return true;
      if (distToSegment(b0, a0, a1) < 1e-7) return true;
      if (distToSegment(b1, a0, a1) < 1e-7) return true;
    }
  }
  return false;
}

function polysInterfere(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (polysTouch(a, b)) return true;
  for (const q of a) {
    if (polyContains(b, q) || pointOnPolyBoundary(b, q)) return true;
  }
  for (const q of b) {
    if (polyContains(a, q) || pointOnPolyBoundary(a, q)) return true;
  }
  return false;
}

export function walkContains(w: Loop, q: Vec2): boolean {
  if (!isFiniteWalk(w) || !isFiniteVec(q)) return false;
  if (isCircleWalk(w)) return dist(q, w.center) < abs(w.radius) - EPS;
  return polyContains(tessellateWalk(w), q);
}

export function regionContains(p: Region, q: Vec2): boolean {
  if (!isFiniteRegion(p) || !isFiniteVec(q)) return false;
  if (!walkContains(p.outer, q)) return false;
  for (const hole of p.holes) {
    if (walkContains(hole, q)) return false;
  }
  return true;
}

function distToArc(e: LoopEdge, q: Vec2): number {
  if (e.carrier.kind !== "circle" || (e.k !== 1 && e.k !== -1)) return distToSegment(q, e.a, e.b);
  const c = e.carrier;
  const closest = projectOnCircle(c, q);
  const cr = alongK(c, e.a, closest);
  const onArc = cr === e.k || dist(closest, e.a) < EPS || dist(closest, e.b) < EPS;
  if (onArc) {
    const delta = abs(circleDelta(c, e.a, closest, e.k));
    const full = abs(circleDelta(c, e.a, e.b, e.k));
    if (delta <= full + 1e-6) return dist(q, closest);
  }
  return min(dist(q, e.a), dist(q, e.b));
}

function distToWalkBoundary(w: Loop, q: Vec2): number {
  if (isCircleWalk(w)) return abs(dist(q, w.center) - abs(w.radius));
  let best = Infinity;
  for (const e of w) {
    const d = e.carrier.kind === "circle" ? distToArc(e, q) : distToSegment(q, e.a, e.b);
    if (d < best) best = d;
  }
  return best;
}

/** Unsigned distance to outer and hole edges — not dist-to-set (0 inside). */
export function distToRegionBoundary(p: Region, q: Vec2): number {
  let best = distToWalkBoundary(p.outer, q);
  for (const hole of p.holes) {
    const d = distToWalkBoundary(hole, q);
    if (d < best) best = d;
  }
  return best;
}

export function distToRegion(p: Region, q: Vec2): number {
  if (!isFiniteRegion(p)) return Infinity;
  if (regionContains(p, q)) return 0;
  return distToRegionBoundary(p, q);
}

/** Positive is outside (grows a round offset); negative is inside. */
export function signedDistToRegion(p: Region, q: Vec2): number {
  if (!isFiniteRegion(p) || !isFiniteVec(q)) return Number.NaN;
  const d = distToRegionBoundary(p, q);
  if (!Number.isFinite(d)) return Number.NaN;
  return regionContains(p, q) ? -d : d;
}

/** SVG path in world (y-up) user space. Arc sweep 1 is CCW. */
export function edgesSvgPath(edges: readonly LoopEdge[], close = false): string {
  if (edges.length === 0) return "";
  const start = edges[0]!.a;
  const parts = [`M ${start.x} ${start.y}`];
  for (const e of edges) {
    if (e.carrier.kind === "circle" && (e.k === 1 || e.k === -1)) {
      const r = abs(e.carrier.radius);
      const delta = circleDelta(e.carrier, e.a, e.b, e.k);
      const large = abs(delta) > PI ? 1 : 0;
      const sweep = e.k === 1 ? 1 : 0;
      parts.push(`A ${r} ${r} 0 ${large} ${sweep} ${e.b.x} ${e.b.y}`);
    } else {
      parts.push(`L ${e.b.x} ${e.b.y}`);
    }
  }
  if (close) parts.push("Z");
  return parts.join(" ");
}

export function walkSvgPath(w: Loop, close = false): string {
  if (isCircleWalk(w)) {
    const r = abs(w.radius);
    const { x, y } = w.center;
    const d = `M ${x + r} ${y} A ${r} ${r} 0 1 1 ${x - r} ${y} A ${r} ${r} 0 1 1 ${x + r} ${y}`;
    return close ? `${d} Z` : d;
  }
  return edgesSvgPath(w, close);
}

export function regionSvgPath(p: Region): string {
  if (!isFiniteRegion(p)) return "";
  const parts = [walkSvgPath(p.outer, true)];
  for (const hole of p.holes) parts.push(walkSvgPath(hole, true));
  return parts.filter((d) => d.length > 0).join(" ");
}
