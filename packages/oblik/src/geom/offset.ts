import {
  circleCircleIntersectionValue,
  circleLineIntersectionValue,
  lineBasis,
  lineIntersectionValue,
  parallelLineValue,
} from "./ops";
import {
  alongK,
  circleDelta,
  isFiniteProfile,
  projectOnCircle,
  projectOnLine,
  tessellateProfile,
} from "./profile";
import type { Branch, Circle, LineLike, Profile, ProfileEdge } from "./types";
import { circleUnitAt } from "./gliders";
import {
  add,
  cross2,
  dist,
  dot,
  isFiniteVec,
  lerp,
  mul,
  norm,
  perp,
  sub,
  vec,
  type Vec2,
} from "./vec";

const EPS = 1e-9;

function cloneProfile(p: Profile): Profile {
  return {
    kind: "profile",
    outer: p.outer.map((e) => ({
      a: { x: e.a.x, y: e.a.y },
      b: { x: e.b.x, y: e.b.y },
      carrier: e.carrier,
      ...(e.k === 1 || e.k === -1 ? { k: e.k } : {}),
    })),
  };
}

function polyArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  }
  return a / 2;
}

function winding(p: Profile): 1 | -1 | 0 {
  const area = polyArea(tessellateProfile(p));
  if (!Number.isFinite(area) || Math.abs(area) < EPS) return 0;
  return area > 0 ? 1 : -1;
}

function unitRadial(c: Circle, p: Vec2): Vec2 {
  const u = circleUnitAt(c, p);
  return vec(u.ux, u.uy);
}

function edgeMid(e: ProfileEdge): Vec2 {
  if (e.carrier.kind === "circle" && (e.k === 1 || e.k === -1)) {
    const delta = circleDelta(e.carrier, e.a, e.b, e.k);
    const ua = circleUnitAt(e.carrier, e.a);
    const a0 = Math.atan2(ua.uy, ua.ux);
    const ang = a0 + 0.5 * delta;
    return add(e.carrier.center, mul(vec(Math.cos(ang), Math.sin(ang)), Math.abs(e.carrier.radius)));
  }
  return lerp(e.a, e.b, 0.5);
}

/** Unit walk tangent at `p` on `e`. */
function walkTangentAt(e: ProfileEdge, p: Vec2): Vec2 {
  if (e.carrier.kind === "circle") {
    const ccw = perp(unitRadial(e.carrier, p));
    return e.k === -1 ? mul(ccw, -1) : ccw;
  }
  return norm(sub(e.b, e.a));
}

function inwardNormal(e: ProfileEdge, p: Vec2, w: 1 | -1): Vec2 {
  return mul(perp(walkTangentAt(e, p)), w);
}

function offsetCarrier(e: ProfileEdge, d: number, w: 1 | -1): LineLike | Circle | null {
  const mid = edgeMid(e);
  const n = inwardNormal(e, mid, w);
  if (e.carrier.kind === "circle") {
    const u = unitRadial(e.carrier, mid);
    const r2 = Math.abs(e.carrier.radius) + d * dot(n, u);
    if (!(r2 > EPS)) return null;
    return { kind: "circle", center: e.carrier.center, radius: r2 };
  }
  const { dir } = lineBasis(e.carrier);
  return parallelLineValue(e.carrier, d * dot(n, perp(dir)));
}

function offsetPoint(e: ProfileEdge, p: Vec2, d: number, w: 1 | -1): Vec2 {
  if (e.carrier.kind === "circle") {
    const u = unitRadial(e.carrier, p);
    const n = inwardNormal(e, p, w);
    const r2 = Math.abs(e.carrier.radius) + d * dot(n, u);
    if (!(r2 > EPS) || !isFiniteVec(u)) return vec(Number.NaN, Number.NaN);
    return add(e.carrier.center, mul(u, r2));
  }
  return add(p, mul(inwardNormal(e, p, w), d));
}

function projectOnCarrier(carrier: LineLike | Circle, p: Vec2): Vec2 {
  return carrier.kind === "circle" ? projectOnCircle(carrier, p) : projectOnLine(carrier, p);
}

function carrierHits(a: LineLike | Circle, b: LineLike | Circle): Vec2[] {
  if (a.kind === "circle" && b.kind === "circle") {
    return [circleCircleIntersectionValue(a, b, 1), circleCircleIntersectionValue(a, b, -1)];
  }
  if (a.kind === "circle") {
    return [circleLineIntersectionValue(a, b, 1), circleLineIntersectionValue(a, b, -1)];
  }
  if (b.kind === "circle") {
    return [circleLineIntersectionValue(b, a, 1), circleLineIntersectionValue(b, a, -1)];
  }
  return [lineIntersectionValue(a, b)];
}

function closestHit(hits: readonly Vec2[], hint: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const p of hits) {
    if (!isFiniteVec(p)) continue;
    const d = dist(p, hint);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function miterHint(prev: ProfileEdge, next: ProfileEdge, v: Vec2, d: number, w: 1 | -1): Vec2 {
  const nIn = inwardNormal(prev, prev.b, w);
  const nOut = inwardNormal(next, next.a, w);
  const s = add(nIn, nOut);
  if (len2(s) < 1e-12) return add(v, mul(nIn, d));
  return add(v, mul(norm(s), d));
}

function len2(p: Vec2): number {
  return p.x * p.x + p.y * p.y;
}

function edgeFrom(carrier: LineLike | Circle, a: Vec2, b: Vec2, k?: Branch): ProfileEdge | null {
  const aa = projectOnCarrier(carrier, a);
  const bb = projectOnCarrier(carrier, b);
  if (!isFiniteVec(aa) || !isFiniteVec(bb) || dist(aa, bb) < EPS) return null;
  if (carrier.kind === "circle") {
    if (k !== 1 && k !== -1) return null;
    return { a: aa, b: bb, carrier, k };
  }
  return { a: aa, b: bb, carrier };
}

function originalForward(e: ProfileEdge, a: Vec2, b: Vec2): boolean {
  return dot(sub(b, a), sub(e.b, e.a)) > EPS;
}

type Join =
  | { kind: "miter"; p: Vec2 }
  | { kind: "arc"; start: Vec2; end: Vec2; carrier: Circle; k: Branch };

/**
 * Local round offset. Positive `d` grows (outward from winding); negative
 * shrinks. Convex outset and concave inset take a join arc of radius `|d|`
 * about the original vertex; convex inset miters. Reverse, `r' ≤ 0`, or a
 * missed hit → `[]`. Does not split islands or clip non-adjacent swallows.
 */
export function roundOffsetValue(p: Profile, d: number): Profile[] {
  if (!isFiniteProfile(p) || !Number.isFinite(d)) return [];
  if (Math.abs(d) < EPS) return [cloneProfile(p)];
  const inward = -d;
  const w = winding(p);
  if (w === 0) return [];
  const edges = p.outer;
  const n = edges.length;
  const off: Array<LineLike | Circle> = [];
  for (const e of edges) {
    const c = offsetCarrier(e, inward, w);
    if (!c) return [];
    off.push(c);
  }
  const joins: Join[] = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i + n - 1) % n]!;
    const next = edges[i]!;
    const v = next.a;
    const turn = cross2(walkTangentAt(prev, prev.b), walkTangentAt(next, next.a));
    const convex = w * turn > EPS;
    const concave = w * turn < -EPS;
    const gap = (convex && inward < 0) || (concave && inward > 0);
    if (gap) {
      const start = offsetPoint(prev, prev.b, inward, w);
      const end = offsetPoint(next, next.a, inward, w);
      if (!isFiniteVec(start) || !isFiniteVec(end) || dist(start, v) < EPS) return [];
      if (dist(start, end) < EPS) {
        joins.push({ kind: "miter", p: start });
        continue;
      }
      const carrier: Circle = { kind: "circle", center: v, radius: Math.abs(inward) };
      joins.push({ kind: "arc", start, end, carrier, k: alongK(carrier, start, end) });
      continue;
    }
    const hint = miterHint(prev, next, v, inward, w);
    const hit = closestHit(carrierHits(off[(i + n - 1) % n]!, off[i]!), hint);
    if (!hit) return [];
    joins.push({ kind: "miter", p: hit });
  }
  const outer: ProfileEdge[] = [];
  for (let i = 0; i < n; i++) {
    const j0 = joins[i]!;
    const j1 = joins[(i + 1) % n]!;
    const start = j0.kind === "miter" ? j0.p : j0.end;
    const end = j1.kind === "miter" ? j1.p : j1.start;
    const src = edges[i]!;
    if (!originalForward(src, start, end)) return [];
    const k = src.carrier.kind === "circle" ? src.k : undefined;
    const e = edgeFrom(off[i]!, start, end, k);
    if (!e) return [];
    outer.push(e);
    if (j1.kind === "arc") {
      const join = edgeFrom(j1.carrier, j1.start, j1.end, j1.k);
      if (!join) return [];
      outer.push(join);
    }
  }
  const out: Profile = { kind: "profile", outer };
  return isFiniteProfile(out) ? [out] : [];
}
