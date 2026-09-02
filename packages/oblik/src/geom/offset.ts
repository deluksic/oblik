import { circleUnitAt } from "./gliders";
import {
  circleCircleIntersectionValue,
  circleLineIntersectionValue,
  lineBasis,
  lineIntersectionValue,
  parallelLineValue,
} from "./ops";
import {
  alongK,
  isFiniteProfile,
  nanProfile,
  profileTopologyOk,
  projectOnCircle,
  projectOnLine,
  tessellateProfile,
} from "./profile";
import type { Branch, Circle, ClosedWalk, LineLike, Profile, ProfileEdge } from "./types";
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
/** World-space hair for ray inclusion; same order as the fillet radius compare. */
const HAIR = 1e-6;

function cloneEdge(e: ProfileEdge): ProfileEdge {
  return {
    a: { x: e.a.x, y: e.a.y },
    b: { x: e.b.x, y: e.b.y },
    carrier: e.carrier,
    ...(e.k === 1 || e.k === -1 ? { k: e.k } : {}),
  };
}

function cloneWalk(edges: ClosedWalk): ClosedWalk {
  return edges.map(cloneEdge);
}

function cloneProfile(p: Profile): Profile {
  return {
    kind: "profile",
    outer: cloneWalk(p.outer),
    holes: p.holes.map(cloneWalk),
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
    const c = e.carrier;
    const ua = unitRadial(c, e.a);
    const ub = unitRadial(c, e.b);
    const s = add(ua, ub);
    let dir: Vec2;
    if (len2(s) < 1e-12) {
      if (dot(ua, ub) > 0) return { x: e.a.x, y: e.a.y };
      dir = e.k === 1 ? perp(ua) : mul(perp(ua), -1);
    } else {
      dir = e.k * cross2(ua, ub) > 0 ? norm(s) : mul(norm(s), -1);
    }
    return add(c.center, mul(dir, Math.abs(c.radius)));
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
  if (a.kind === "circle" && b.kind !== "circle") {
    return [circleLineIntersectionValue(a, b, 1), circleLineIntersectionValue(a, b, -1)];
  }
  if (b.kind === "circle" && a.kind !== "circle") {
    return [circleLineIntersectionValue(b, a, 1), circleLineIntersectionValue(b, a, -1)];
  }
  if (a.kind !== "circle" && b.kind !== "circle") {
    return [lineIntersectionValue(a, b)];
  }
  return [];
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

/**
 * Line/line miter from the two offset constraints `n·(p−v) = d`.
 * When the vertex is flat (collinear radii, a 180° sector) the normals
 * agree and this is `v + n d` — intersecting the offset lines is singular.
 */
function lineMiter(
  prev: ProfileEdge,
  next: ProfileEdge,
  v: Vec2,
  d: number,
  w: 1 | -1,
): Vec2 | null {
  const nIn = inwardNormal(prev, prev.b, w);
  const nOut = inwardNormal(next, next.a, w);
  const denom = 1 + dot(nIn, nOut);
  if (Math.abs(denom) < 1e-12) return null;
  const p = add(v, mul(add(nIn, nOut), d / denom));
  return isFiniteVec(p) ? p : null;
}

function miterJoin(
  prev: ProfileEdge,
  next: ProfileEdge,
  v: Vec2,
  d: number,
  w: 1 | -1,
  offPrev: LineLike | Circle,
  offNext: LineLike | Circle,
): Vec2 | null {
  if (prev.carrier.kind !== "circle" && next.carrier.kind !== "circle") {
    return lineMiter(prev, next, v, d, w);
  }
  const hint = miterHint(prev, next, v, d, w);
  return closestHit(carrierHits(offPrev, offNext), hint);
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

/**
 * `p` in the CCW sector from `a` to `b` about `c`, with a world-space hair
 * at the rays. Minor (`cross(ua,ub) > 0`) needs both half-planes; major
 * needs either. A ~0° span is empty; a ~180° span is the left semicircle.
 */
function inCcwSector(c: Circle, a: Vec2, b: Vec2, p: Vec2): boolean {
  if (dist(c.center, a) < EPS || dist(c.center, b) < EPS || dist(c.center, p) < EPS) return false;
  const ua = unitRadial(c, a);
  const ub = unitRadial(c, b);
  const up = unitRadial(c, p);
  const s = HAIR / Math.min(dist(c.center, a), dist(c.center, b), dist(c.center, p));
  const ab = cross2(ua, ub);
  const ap = cross2(ua, up);
  const pb = cross2(up, ub);
  if (ab > s) return ap >= -s && pb >= -s;
  if (ab < -s) return ap >= -s || pb >= -s;
  if (dot(ua, ub) > 0) return false;
  return ap >= -s && pb >= -s;
}

function sameRay(c: Circle, a: Vec2, b: Vec2): boolean {
  if (dist(c.center, a) < EPS || dist(c.center, b) < EPS) return false;
  const ua = unitRadial(c, a);
  const ub = unitRadial(c, b);
  const s = HAIR / Math.min(dist(c.center, a), dist(c.center, b));
  return Math.abs(cross2(ua, ub)) <= s && dot(ua, ub) > 0;
}

function inWalkSector(c: Circle, a: Vec2, b: Vec2, p: Vec2, k: Branch): boolean {
  return k === 1 ? inCcwSector(c, a, b, p) : inCcwSector(c, b, a, p);
}

/** True when `a→b` walks the same way as `e`, and both points sit on `e`. */
function originalForward(e: ProfileEdge, a: Vec2, b: Vec2): boolean {
  if (e.carrier.kind !== "circle") {
    return dot(sub(b, a), sub(e.b, e.a)) > EPS;
  }
  if (e.k !== 1 && e.k !== -1) return false;
  const c = e.carrier;
  if (sameRay(c, e.a, e.b)) return false;
  if (!inWalkSector(c, e.a, e.b, a, e.k) || !inWalkSector(c, e.a, e.b, b, e.k)) return false;
  if (sameRay(c, a, b)) return false;
  return inWalkSector(c, a, e.b, b, e.k);
}

type Join =
  | { kind: "miter"; p: Vec2 }
  | { kind: "arc"; start: Vec2; end: Vec2; carrier: Circle; k: Branch };

function vertexJoin(
  prev: ProfileEdge,
  next: ProfileEdge,
  v: Vec2,
  inward: number,
  w: 1 | -1,
  offPrev: LineLike | Circle,
  offNext: LineLike | Circle,
): Join | null {
  const turn = cross2(walkTangentAt(prev, prev.b), walkTangentAt(next, next.a));
  const convex = w * turn > EPS;
  const concave = w * turn < -EPS;
  const gap = (convex && inward < 0) || (concave && inward > 0);
  if (gap) {
    const start = offsetPoint(prev, prev.b, inward, w);
    const end = offsetPoint(next, next.a, inward, w);
    if (!isFiniteVec(start) || !isFiniteVec(end) || dist(start, v) < EPS) return null;
    if (dist(start, end) < EPS) return { kind: "miter", p: start };
    const carrier: Circle = { kind: "circle", center: v, radius: Math.abs(inward) };
    return { kind: "arc", start, end, carrier, k: alongK(carrier, start, end) };
  }
  const hit = miterJoin(prev, next, v, inward, w, offPrev, offNext);
  if (!hit) return null;
  return { kind: "miter", p: hit };
}

/**
 * Local round offset. Positive `d` grows (outward from winding); negative
 * shrinks. Convex outset and concave inset take a join arc of radius `|d|`
 * about the original vertex; convex inset miters. A flat (180°) vertex
 * offsets along the shared normal. A carrier with `r' ≤ 0` is dropped and
 * the surviving offsets are joined at their hit (a filleted square inset
 * past `r` is a sharp inner square). Reverse, a missed hit, or fewer than
 * two surviving edges → `[]`. A profile with holes also returns `[]` (offset
 * is a set operation; topology can change). Does not split islands or clip
 * non-adjacent swallows.
 */
export function roundOffsetValue(p: Profile, d: number): Profile[] {
  if (!isFiniteProfile(p) || !Number.isFinite(d)) return [];
  if (Math.abs(d) < EPS) return [cloneProfile(p)];
  if (p.holes.length > 0) return [];
  const inward = -d;
  const w = winding(p);
  if (w === 0) return [];
  const edges = p.outer;
  const n = edges.length;
  const off: Array<LineLike | Circle | null> = [];
  for (const e of edges) off.push(offsetCarrier(e, inward, w));
  const kept: number[] = [];
  for (let i = 0; i < n; i++) if (off[i]) kept.push(i);
  const m = kept.length;
  if (m < 2) return [];
  const joins: Join[] = [];
  for (let ki = 0; ki < m; ki++) {
    const iPrev = kept[(ki + m - 1) % m]!;
    const i = kept[ki]!;
    const prev = edges[iPrev]!;
    const next = edges[i]!;
    const offPrev = off[iPrev]!;
    const offNext = off[i]!;
    const adjacent = i === (iPrev + 1) % n;
    if (adjacent) {
      const j = vertexJoin(prev, next, next.a, inward, w, offPrev, offNext);
      if (!j) return [];
      joins.push(j);
      continue;
    }
    // Dropped carriers between these two: do not miter from a G1 endpoint
    // (that is not the original corner). Intersect the surviving offsets.
    const hit = closestHit(carrierHits(offPrev, offNext), lerp(prev.b, next.a, 0.5));
    if (!hit) return [];
    joins.push({ kind: "miter", p: hit });
  }
  const outer: ProfileEdge[] = [];
  for (let ki = 0; ki < m; ki++) {
    const i = kept[ki]!;
    const j0 = joins[ki]!;
    const j1 = joins[(ki + 1) % m]!;
    const start = j0.kind === "miter" ? j0.p : j0.end;
    const end = j1.kind === "miter" ? j1.p : j1.start;
    const src = edges[i]!;
    if (!originalForward(src, start, end)) return [];
    const branch = src.carrier.kind === "circle" ? src.k : undefined;
    const e = edgeFrom(off[i]!, start, end, branch);
    if (!e) return [];
    outer.push(e);
    if (j1.kind === "arc") {
      const join = edgeFrom(j1.carrier, j1.start, j1.end, j1.k);
      if (!join) return [];
      outer.push(join);
    }
  }
  const out: Profile = { kind: "profile", outer, holes: [] };
  return isFiniteProfile(out) ? [out] : [];
}

type FilletJoin = { t0: Vec2; t1: Vec2; carrier: Circle; k: Branch };

function filletJoin(
  prev: ProfileEdge,
  next: ProfileEdge,
  v: Vec2,
  r: number,
  w: 1 | -1,
): FilletJoin | "sharp" | null {
  const turn = cross2(walkTangentAt(prev, prev.b), walkTangentAt(next, next.a));
  if (Math.abs(turn) <= EPS) return "sharp";
  const into = w * turn < -EPS ? -r : r;
  const offPrev = offsetCarrier(prev, into, w);
  const offNext = offsetCarrier(next, into, w);
  if (!offPrev || !offNext) return null;
  const c = miterJoin(prev, next, v, into, w, offPrev, offNext);
  if (!c) return null;
  const t0 = projectOnCarrier(prev.carrier, c);
  const t1 = projectOnCarrier(next.carrier, c);
  if (!isFiniteVec(t0) || !isFiniteVec(t1) || dist(t0, t1) < EPS) return null;
  if (!originalForward(prev, prev.a, t0) || !originalForward(prev, t0, v)) return null;
  if (!originalForward(next, v, t1) || !originalForward(next, t1, next.b)) return null;
  const radius = dist(c, t0);
  if (!(radius > EPS) || Math.abs(radius - dist(c, t1)) > 1e-6) return null;
  const carrier: Circle = { kind: "circle", center: c, radius };
  return { t0, t1, carrier, k: alongK(carrier, t0, t1) };
}

/**
 * Replace sharp vertices with tangent join arcs. `radii[i]` is the fillet at
 * `outer[i].a`. Zero / omitted / a flat (180°) vertex keeps the corner.
 * Too-large `r` → empty profile.
 */
export function filletVertices(p: Profile, radii: readonly number[]): Profile {
  if (!isFiniteProfile(p)) return nanProfile();
  const n = p.outer.length;
  if (radii.length !== n) return nanProfile();
  if (radii.every((r) => !(r > EPS))) return p;
  const w = winding(p);
  if (w === 0) return nanProfile();
  const joins: Array<FilletJoin | null> = [];
  for (let i = 0; i < n; i++) {
    const r = radii[i]!;
    if (!(r > EPS)) {
      joins.push(null);
      continue;
    }
    if (!Number.isFinite(r)) return nanProfile();
    const prev = p.outer[(i + n - 1) % n]!;
    const next = p.outer[i]!;
    const join = filletJoin(prev, next, next.a, r, w);
    if (join === "sharp") {
      joins.push(null);
      continue;
    }
    if (!join) return nanProfile();
    joins.push(join);
  }
  const outer: ProfileEdge[] = [];
  for (let i = 0; i < n; i++) {
    const src = p.outer[i]!;
    const j0 = joins[i];
    const j1 = joins[(i + 1) % n];
    const start = j0 ? j0.t1 : src.a;
    const end = j1 ? j1.t0 : src.b;
    if (!originalForward(src, start, end)) return nanProfile();
    const k = src.carrier.kind === "circle" ? src.k : undefined;
    const e = edgeFrom(src.carrier, start, end, k);
    if (!e) return nanProfile();
    outer.push(e);
    if (j1) {
      const arc = edgeFrom(j1.carrier, j1.t0, j1.t1, j1.k);
      if (!arc) return nanProfile();
      outer.push(arc);
    }
  }
  const out: Profile = { kind: "profile", outer, holes: p.holes.map(cloneWalk) };
  if (!isFiniteProfile(out)) return nanProfile();
  if (out.holes.length > 0 && !profileTopologyOk(out)) return nanProfile();
  return out;
}

/** Join circle G1 with both neighbors, whose original carriers still meet near the center. */
function isFilletJoin(edges: readonly ProfileEdge[], i: number): boolean {
  const e = edges[i]!;
  if (e.carrier.kind !== "circle") return false;
  const n = edges.length;
  const prev = edges[(i + n - 1) % n]!;
  const next = edges[(i + 1) % n]!;
  if (dist(prev.b, e.a) > EPS || dist(e.b, next.a) > EPS) return false;
  if (!tangentsG1(prev, e, e.a) || !tangentsG1(e, next, e.b)) return false;
  const c = e.carrier.center;
  const r = Math.abs(e.carrier.radius);
  if (!(r > EPS)) return false;
  const meet = closestHit(carrierHits(prev.carrier, next.carrier), c);
  if (!meet) return false;
  return dist(meet, c) <= 16 * r + EPS;
}

function tangentsG1(a: ProfileEdge, b: ProfileEdge, at: Vec2): boolean {
  const ta = walkTangentAt(a, at);
  const tb = walkTangentAt(b, at);
  return dot(ta, tb) > 0.999;
}

function originalEdgeIndices(p: Profile): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.outer.length; i++) {
    if (!isFilletJoin(p.outer, i)) out.push(i);
  }
  return out;
}

export type ProfileCorner = { at: Vec2; index: number; r: number };

/**
 * Logical vertices of a (possibly filleted) face. Join arcs are skipped so
 * indices match the source cycle; a stadium rim and a pie `along` stay.
 */
export function profileCorners(p: Profile): ProfileCorner[] {
  if (!isFiniteProfile(p)) return [];
  const orig = originalEdgeIndices(p);
  const n = orig.length;
  if (n < 2) return [];
  const corners: ProfileCorner[] = [];
  for (let i = 0; i < n; i++) {
    const iPrev = orig[(i + n - 1) % n]!;
    const iNext = orig[i]!;
    const prev = p.outer[iPrev]!;
    const next = p.outer[iNext]!;
    let r = 0;
    const m = p.outer.length;
    for (let j = (iPrev + 1) % m; j !== iNext; j = (j + 1) % m) {
      const e = p.outer[j]!;
      if (e.carrier.kind === "circle") r = Math.abs(e.carrier.radius);
    }
    let at: Vec2;
    if (dist(prev.b, next.a) < 1e-6) {
      at = { x: next.a.x, y: next.a.y };
    } else {
      const hint = lerp(prev.b, next.a, 0.5);
      at = closestHit(carrierHits(prev.carrier, next.carrier), hint) ?? hint;
    }
    corners.push({ at, index: i, r });
  }
  return corners;
}

/**
 * Rebuild the sharp cycle, then fillet `index` to `r` while keeping other
 * corners. `r === 0` leaves that vertex sharp. Too-large / negative `r` → empty.
 */
export function filletAtVertex(p: Profile, index: number, r: number): Profile {
  if (!Number.isFinite(r) || r < 0) return nanProfile();
  const corners = profileCorners(p);
  if (index < 0 || index >= corners.length) return nanProfile();
  const orig = originalEdgeIndices(p);
  if (orig.length !== corners.length) return nanProfile();
  const outer: ProfileEdge[] = [];
  for (let i = 0; i < orig.length; i++) {
    const src = p.outer[orig[i]!]!;
    const a = corners[i]!.at;
    const b = corners[(i + 1) % orig.length]!.at;
    const k = src.carrier.kind === "circle" ? src.k : undefined;
    const e = edgeFrom(src.carrier, a, b, k);
    if (!e) return nanProfile();
    outer.push(e);
  }
  const sharp: Profile = { kind: "profile", outer, holes: p.holes.map(cloneWalk) };
  if (!isFiniteProfile(sharp)) return nanProfile();
  const radii = corners.map((c, i) => (i === index ? r : c.r));
  return filletVertices(sharp, radii);
}
