import { appendFileSync } from "node:fs";

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
  circleDelta,
  distToProfileBoundary,
  isFiniteProfile,
  nanProfile,
  profileTopologyOk,
  projectOnCircle,
  projectOnLine,
  tessellateWalk,
  walkContains,
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

// #region agent log
function dbg(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  appendFileSync(
    "/opt/cursor/logs/debug.log",
    JSON.stringify({ hypothesisId, location, message, data, timestamp: Date.now() }) + "\n",
  );
}
// #endregion

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

function windingOf(edges: ClosedWalk): 1 | -1 | 0 {
  const area = polyArea(tessellateWalk(edges));
  if (!Number.isFinite(area) || Math.abs(area) < EPS) return 0;
  return area > 0 ? 1 : -1;
}

function winding(p: Profile): 1 | -1 | 0 {
  return windingOf(p.outer);
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
 * Untrimmed parallel + vertex joins of one walk. Reverse spans are still
 * emitted (the envelope trim drops them). A missed join or fewer than two
 * surviving edges → `null`. `strict` aborts on reverse (the local remnant).
 */
function rawOffsetWalk(edges: ClosedWalk, distance: number, strict: boolean): ClosedWalk | null {
  const inward = -distance;
  const w = windingOf(edges);
  if (w === 0) return null;
  const n = edges.length;
  const off: Array<LineLike | Circle | null> = [];
  for (const e of edges) off.push(offsetCarrier(e, inward, w));
  const kept: number[] = [];
  for (let i = 0; i < n; i++) if (off[i]) kept.push(i);
  const m = kept.length;
  if (m < 2) return null;
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
      if (!j) return null;
      joins.push(j);
      continue;
    }
    const hit = closestHit(carrierHits(offPrev, offNext), lerp(prev.b, next.a, 0.5));
    if (!hit) return null;
    joins.push({ kind: "miter", p: hit });
  }
  const out: ProfileEdge[] = [];
  for (let ki = 0; ki < m; ki++) {
    const i = kept[ki]!;
    const j0 = joins[ki]!;
    const j1 = joins[(ki + 1) % m]!;
    const start = j0.kind === "miter" ? j0.p : j0.end;
    const end = j1.kind === "miter" ? j1.p : j1.start;
    const src = edges[i]!;
    const forward = originalForward(src, start, end);
    if (strict && !forward) return null;
    let branch = src.carrier.kind === "circle" ? src.k : undefined;
    if (!forward && off[i]!.kind === "circle") branch = alongK(off[i] as Circle, start, end);
    const e = edgeFrom(off[i]!, start, end, branch);
    if (!e) {
      if (strict) return null;
    } else {
      out.push(e);
    }
    if (j1.kind === "arc") {
      const join = edgeFrom(j1.carrier, j1.start, j1.end, j1.k);
      if (!join) {
        if (strict) return null;
      } else {
        out.push(join);
      }
    }
  }
  return out.length >= 2 ? out : null;
}

/**
 * Raw offset cycles of outer (by `d`) and holes (by `-d`). May self-intersect.
 * The outer walk missing → `[]`. Vanished holes are omitted.
 */
export function rawRoundOffset(p: Profile, d: number): ClosedWalk[] {
  if (!isFiniteProfile(p) || !Number.isFinite(d)) return [];
  if (Math.abs(d) < EPS) return [cloneWalk(p.outer), ...p.holes.map(cloneWalk)];
  const outer = rawOffsetWalk(p.outer, d, false);
  if (!outer) return [];
  const holes: ClosedWalk[] = [];
  for (const h of p.holes) {
    const off = rawOffsetWalk(h, -d, false);
    if (off) holes.push(off);
  }
  return [outer, ...holes];
}

function onSpanInterior(e: ProfileEdge, p: Vec2): boolean {
  if (!isFiniteVec(p)) return false;
  if (dist(p, e.a) < HAIR || dist(p, e.b) < HAIR) return false;
  if (e.carrier.kind === "circle") {
    if (e.k !== 1 && e.k !== -1) return false;
    return inWalkSector(e.carrier, e.a, e.b, p, e.k);
  }
  const ab = sub(e.b, e.a);
  const len = ab.x * ab.x + ab.y * ab.y;
  if (len < EPS) return false;
  const t = dot(sub(p, e.a), ab) / len;
  return t > 1e-6 && t < 1 - 1e-6;
}

/** `p` sits on `e`'s carrier and strictly inside the span (T-junction / overlap). */
function onCarrierSpan(e: ProfileEdge, p: Vec2): boolean {
  if (!onSpanInterior(e, p)) return false;
  if (e.carrier.kind === "circle") {
    return Math.abs(dist(p, e.carrier.center) - Math.abs(e.carrier.radius)) <= 1e-6;
  }
  const { origin, dir } = lineBasis(e.carrier);
  const n = norm(dir);
  return Math.abs(cross2(n, sub(p, origin))) <= 1e-6;
}

function hitParam(e: ProfileEdge, p: Vec2): number {
  if (e.carrier.kind === "circle" && (e.k === 1 || e.k === -1)) {
    const full = Math.abs(circleDelta(e.carrier, e.a, e.b, e.k));
    if (full < EPS) return 0;
    return Math.abs(circleDelta(e.carrier, e.a, p, e.k)) / full;
  }
  const ab = sub(e.b, e.a);
  const len = ab.x * ab.x + ab.y * ab.y;
  if (len < EPS) return 0;
  return dot(sub(p, e.a), ab) / len;
}

function splitEdge(e: ProfileEdge, hits: readonly Vec2[]): ProfileEdge[] {
  const tagged: { t: number; p: Vec2 }[] = [];
  for (const p of hits) {
    if (!onSpanInterior(e, p)) continue;
    const t = hitParam(e, p);
    if (t > 1e-6 && t < 1 - 1e-6) tagged.push({ t, p });
  }
  tagged.sort((a, b) => a.t - b.t);
  const uniq: { t: number; p: Vec2 }[] = [];
  for (const h of tagged) {
    if (uniq.length === 0 || Math.abs(h.t - uniq[uniq.length - 1]!.t) > 1e-6) uniq.push(h);
  }
  if (uniq.length === 0) return [e];
  const pts = [e.a, ...uniq.map((h) => h.p), e.b];
  const out: ProfileEdge[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const frag = edgeFrom(e.carrier, pts[i]!, pts[i + 1]!, e.k);
    if (frag) out.push(frag);
  }
  return out.length > 0 ? out : [e];
}

function splitWalks(walks: readonly ClosedWalk[]): ProfileEdge[] {
  const edges: ProfileEdge[] = [];
  for (const w of walks) edges.push(...w);
  const hits: Vec2[][] = edges.map(() => []);
  let hitPairs = 0;
  let coinc = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const ei = edges[i]!;
      const ej = edges[j]!;
      // #region agent log
      if (ei.carrier.kind !== "circle" && ej.carrier.kind !== "circle") {
        const la = lineBasis(ei.carrier);
        const lb = lineBasis(ej.carrier);
        if (Math.abs(cross2(la.dir, lb.dir)) < 1e-8) {
          const off = Math.abs(cross2(la.dir, sub(ej.a, ei.a)));
          if (off < 1e-4) coinc++;
        }
      }
      // #endregion
      for (const p of carrierHits(ei.carrier, ej.carrier)) {
        if (!isFiniteVec(p)) continue;
        if (onSpanInterior(ei, p) && onSpanInterior(ej, p)) {
          hits[i]!.push(p);
          hits[j]!.push(p);
          hitPairs++;
        }
      }
    }
  }
  let tHits = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = 0; j < edges.length; j++) {
      if (i === j) continue;
      const e = edges[i]!;
      const o = edges[j]!;
      if (onCarrierSpan(e, o.a)) {
        hits[i]!.push(o.a);
        tHits++;
      }
      if (onCarrierSpan(e, o.b)) {
        hits[i]!.push(o.b);
        tHits++;
      }
    }
  }
  const out: ProfileEdge[] = [];
  for (let i = 0; i < edges.length; i++) out.push(...splitEdge(edges[i]!, hits[i]!));
  // #region agent log
  dbg("B", "offset.ts:splitWalks", "split hits vs coincident parallels", {
    nEdges: edges.length,
    hitPairs,
    coinc,
    nOut: out.length,
    nSplit: hits.filter((h) => h.length > 0).length,
  });
  dbg("F", "offset.ts:splitWalks", "T-junction endpoint splits", {
    tHits,
    nOut: out.length,
    runId: "post-fix",
  });
  // #endregion
  return out;
}

function clearanceOk(m: Vec2, src: Profile, absD: number): boolean {
  const d = distToProfileBoundary(src, m);
  if (!Number.isFinite(d)) return false;
  const tol = Math.max(1e-5, 1e-3 * absD);
  return Math.abs(d - absD) <= tol;
}

const VERT_SNAP = 1e6;

function vertKey(p: Vec2): string {
  return `${Math.round(p.x * VERT_SNAP)}_${Math.round(p.y * VERT_SNAP)}`;
}

function endsMatch(a: Vec2, b: Vec2): boolean {
  return vertKey(a) === vertKey(b);
}

function sameLineCarrier(a: ProfileEdge, b: ProfileEdge): boolean {
  if (a.carrier.kind === "circle" || b.carrier.kind === "circle") return false;
  const la = lineBasis(a.carrier);
  const lb = lineBasis(b.carrier);
  const da = norm(la.dir);
  const db = norm(lb.dir);
  return Math.abs(cross2(da, db)) <= 1e-6 && Math.abs(cross2(da, sub(lb.origin, la.origin))) <= 1e-6;
}

function sameCircleCarrier(a: ProfileEdge, b: ProfileEdge): boolean {
  if (a.carrier.kind !== "circle" || b.carrier.kind !== "circle") return false;
  return (
    dist(a.carrier.center, b.carrier.center) <= 1e-6 &&
    Math.abs(Math.abs(a.carrier.radius) - Math.abs(b.carrier.radius)) <= 1e-6
  );
}

/** Same geometric span, either direction — a collapsed slit, not leftover boundary. */
function coincidentSpan(a: ProfileEdge, b: ProfileEdge): boolean {
  const fwd = endsMatch(a.a, b.a) && endsMatch(a.b, b.b);
  const rev = endsMatch(a.a, b.b) && endsMatch(a.b, b.a);
  if (!fwd && !rev) return false;
  if (sameLineCarrier(a, b)) return true;
  if (!sameCircleCarrier(a, b)) return false;
  if (fwd) return a.k === b.k;
  return a.k === 1 ? b.k === -1 : b.k === 1;
}

function cancelCoincidentSpans(frags: readonly ProfileEdge[]): ProfileEdge[] {
  const n = frags.length;
  const drop = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (drop[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (drop[j]) continue;
      if (coincidentSpan(frags[i]!, frags[j]!)) {
        drop[i] = 1;
        drop[j] = 1;
        break;
      }
    }
  }
  const out: ProfileEdge[] = [];
  for (let i = 0; i < n; i++) if (!drop[i]) out.push(frags[i]!);
  return out;
}

function leaveDir(e: ProfileEdge, atA: boolean): Vec2 {
  const t = walkTangentAt(e, atA ? e.a : e.b);
  return atA ? t : mul(t, -1);
}

function arriveDir(e: ProfileEdge, atB: boolean): Vec2 {
  const t = walkTangentAt(e, atB ? e.b : e.a);
  return atB ? t : mul(t, -1);
}

/** CCW angle from incoming-toward-vertex to outgoing; ~0 (through) ranks last. */
function leftTurn(inToward: Vec2, outAway: Vec2): number {
  const cr = cross2(inToward, outAway);
  const dt = dot(inToward, outAway);
  let ang = Math.atan2(cr, dt);
  if (ang < 1e-6) ang += 2 * Math.PI;
  return ang;
}

type Inc = { fi: number; atA: boolean };

function walkFragments(frags: readonly ProfileEdge[]): ClosedWalk[] {
  const at = new Map<string, Inc[]>();
  const addInc = (p: Vec2, fi: number, atA: boolean) => {
    const k = vertKey(p);
    let list = at.get(k);
    if (!list) {
      list = [];
      at.set(k, list);
    }
    list.push({ fi, atA });
  };
  for (let i = 0; i < frags.length; i++) {
    addInc(frags[i]!.a, i, true);
    addInc(frags[i]!.b, i, false);
  }
  const used = new Uint8Array(frags.length);
  const tried = new Uint8Array(frags.length);
  const pickNext = (fi: number, arrivingAtB: boolean, startFi: number): Inc | null => {
    const e = frags[fi]!;
    const v = arrivingAtB ? e.b : e.a;
    const opts = at.get(vertKey(v));
    if (!opts || opts.length < 2) return null;
    const incoming = arriveDir(e, arrivingAtB);
    let best: Inc | null = null;
    let bestAng = Infinity;
    for (const o of opts) {
      if (o.fi === fi) continue;
      if (used[o.fi] && o.fi !== startFi) continue;
      const ang = leftTurn(incoming, leaveDir(frags[o.fi]!, o.atA));
      if (ang < bestAng) {
        bestAng = ang;
        best = o;
      }
    }
    return best;
  };
  const loops: ClosedWalk[] = [];
  let failed = 0;
  let dangling = 0;
  for (const list of at.values()) if (list.length < 2) dangling++;
  for (let start = 0; start < frags.length; start++) {
    if (used[start] || tried[start]) continue;
    tried[start] = 1;
    const cycle: ProfileEdge[] = [];
    const consumed: number[] = [];
    let fi = start;
    let forward = true;
    let closed = false;
    for (let n = 0; n < frags.length + 2; n++) {
      if (used[fi] && cycle.length > 0) break;
      const src = frags[fi]!;
      cycle.push(forward ? src : reverseEdge(src));
      used[fi] = 1;
      consumed.push(fi);
      const nxt = pickNext(fi, forward, start);
      if (!nxt) break;
      if (nxt.fi === start) {
        closed = cycle.length >= 2 && dist(cycle[0]!.a, cycle[cycle.length - 1]!.b) < 1e-4;
        break;
      }
      fi = nxt.fi;
      forward = nxt.atA;
    }
    if (closed) {
      const area = polyArea(tessellateWalk(cycle));
      if (Math.abs(area) > 1e-6) loops.push(cycle);
    } else {
      failed++;
      for (const i of consumed) used[i] = 0;
    }
  }
  // #region agent log
  dbg("D", "offset.ts:walkFragments", "loops vs failed/dangling", {
    nFrags: frags.length,
    nLoops: loops.length,
    loopLens: loops.map((w) => w.length),
    failed,
    dangling,
    nVerts: at.size,
  });
  // #endregion
  return loops;
}

function reverseEdge(e: ProfileEdge): ProfileEdge {
  if (e.carrier.kind === "circle" && (e.k === 1 || e.k === -1)) {
    return { a: e.b, b: e.a, carrier: e.carrier, k: e.k === 1 ? -1 : 1 };
  }
  return { a: e.b, b: e.a, carrier: e.carrier };
}

function reverseWalk(edges: ClosedWalk): ClosedWalk {
  return edges.toReversed().map(reverseEdge);
}

function classifyIslands(walks: ClosedWalk[]): Profile[] {
  if (walks.length === 0) return [];
  const mids = walks.map((w) => edgeMid(w[0]!));
  const areas = walks.map((w) => polyArea(tessellateWalk(w)));
  const inside = (i: number, j: number) => i !== j && walkContains(walks[i]!, mids[j]!);
  const depth = walks.map((_, j) => {
    let n = 0;
    for (let i = 0; i < walks.length; i++) if (inside(i, j)) n++;
    return n;
  });
  const islands: Profile[] = [];
  for (let i = 0; i < walks.length; i++) {
    if (depth[i] !== 0) continue;
    if (Math.abs(areas[i] ?? 0) < 1e-6) continue;
    let outer = walks[i]!;
    if ((areas[i] ?? 0) < 0) outer = reverseWalk(outer);
    const holes: ClosedWalk[] = [];
    for (let j = 0; j < walks.length; j++) {
      if (depth[j] !== 1 || !inside(i, j)) continue;
      if (Math.abs(areas[j] ?? 0) < 1e-6) continue;
      let hole = walks[j]!;
      if ((areas[j] ?? 0) > 0) hole = reverseWalk(hole);
      holes.push(hole);
    }
    const p: Profile = { kind: "profile", outer, holes };
    if (!isFiniteProfile(p)) continue;
    const topo = holes.length === 0 || profileTopologyOk(p);
    // #region agent log
    dbg("A", "offset.ts:classifyIslands", "island candidate", {
      outerI: i,
      nHoles: holes.length,
      topo,
      area: areas[i],
      holeAreas: holes.map((_, hi) => {
        const j = walks.findIndex((w) => w === (hi === 0 ? holes[0] : holes[hi]));
        return j >= 0 ? areas[j] : null;
      }),
    });
    // #endregion
    if (holes.length > 0 && !topo) {
      islands.push({ kind: "profile", outer, holes: [] });
      continue;
    }
    islands.push(p);
  }
  // #region agent log
  const qA = { x: 1.2, y: 1 };
  const qWeb = { x: 2.1, y: 1 };
  const qMeat = { x: 0.2, y: 1 };
  dbg("E", "offset.ts:classifyIslands", "nesting depths", {
    nWalks: walks.length,
    depths: depth,
    areas: areas.map((a) => Math.round(a * 1e4) / 1e4),
    nIslands: islands.length,
    holeCounts: islands.map((p) => p.holes.length),
    containsA: walks.map((w) => walkContains(w, qA)),
    containsWeb: walks.map((w) => walkContains(w, qWeb)),
    containsMeat: walks.map((w) => walkContains(w, qMeat)),
  });
  // #endregion
  return islands;
}

/**
 * Split raw offset spans at pairwise hits, keep fragments whose midpoint is
 * at distance `|d|` from the original boundary, walk left-face cycles, nest
 * into islands. Generic `d` only — coincidences may yield `[]`.
 */
export function trimOffsetEnvelope(src: Profile, d: number, raw: ClosedWalk[]): Profile[] {
  if (raw.length === 0 || !Number.isFinite(d)) return [];
  const absD = Math.abs(d);
  if (absD < EPS) return [cloneProfile(src)];
  // #region agent log
  dbg("C", "offset.ts:trimOffsetEnvelope:entry", "raw walks", {
    d,
    absD,
    rawWalks: raw.length,
    rawEdges: raw.map((w) => w.length),
    srcHoles: src.holes.length,
  });
  // #endregion
  const split = splitWalks(raw);
  const kept: ProfileEdge[] = [];
  let dropped = 0;
  let webKept = 0;
  let webDrop = 0;
  for (const e of split) {
    if (dist(e.a, e.b) < HAIR) continue;
    const m = edgeMid(e);
    const ok = clearanceOk(m, src, absD);
    const webish = m.x > 1.7 && m.x < 2.5 && m.y > 0.2 && m.y < 1.8;
    if (ok) {
      kept.push(e);
      if (webish) webKept++;
    } else {
      dropped++;
      if (webish) webDrop++;
    }
  }
  // #region agent log
  dbg("C", "offset.ts:trimOffsetEnvelope:clearance", "kept vs dropped", {
    d,
    nSplit: split.length,
    nKept: kept.length,
    dropped,
    webKept,
    webDrop,
  });
  // #endregion
  if (kept.length < 2) return [];
  const faces = cancelCoincidentSpans(kept);
  // #region agent log
  dbg("G", "offset.ts:trimOffsetEnvelope:cancel", "coincident spans dropped", {
    nKept: kept.length,
    nFaces: faces.length,
    nCancel: kept.length - faces.length,
    runId: "post-fix",
  });
  // #endregion
  if (faces.length < 2) return [];
  const loops = walkFragments(faces);
  const out = classifyIslands(loops);
  // #region agent log
  dbg("A", "offset.ts:trimOffsetEnvelope:exit", "islands", {
    d,
    nLoops: loops.length,
    nIslands: out.length,
    holes: out.map((p) => p.holes.length),
  });
  // #endregion
  return out;
}

/** `(src, d) → islands`. Pass a different kernel to `roundOffsetValue`. */
export type OffsetKernel = (src: Profile, d: number) => Profile[];

export function composeOffset(
  raw: (src: Profile, d: number) => ClosedWalk[],
  trim: (src: Profile, d: number, raw: ClosedWalk[]) => Profile[] = trimOffsetEnvelope,
): OffsetKernel {
  return (src, d) => {
    if (!isFiniteProfile(src) || !Number.isFinite(d)) return [];
    if (Math.abs(d) < EPS) return [cloneProfile(src)];
    return trim(src, d, raw(src, d));
  };
}

/**
 * Join-only offset: reverse, a missed hit, or holes → `[]`. No split/merge.
 * Kept so a later kernel can be compared against the local remnant.
 */
export function localOffset(p: Profile, d: number): Profile[] {
  if (!isFiniteProfile(p) || !Number.isFinite(d)) return [];
  if (Math.abs(d) < EPS) return [cloneProfile(p)];
  if (p.holes.length > 0) return [];
  const outer = rawOffsetWalk(p.outer, d, true);
  if (!outer) return [];
  const out: Profile = { kind: "profile", outer, holes: [] };
  return isFiniteProfile(out) ? [out] : [];
}

/** Disk envelope of the raw offset. Default `roundOffsetValue` kernel. */
export const envelopeOffset: OffsetKernel = composeOffset(rawRoundOffset);

/**
 * Round offset boundary as islands of closed walks. Positive `d` grows.
 * Compiled geometry is not a declared profile — the constructor wraps a
 * region whose stock is an `offset` operand. Optional `kernel` is for tests
 * and later swaps; production uses `envelopeOffset`.
 */
export function roundOffsetValue(
  p: Profile,
  d: number,
  kernel: OffsetKernel = envelopeOffset,
): Profile[] {
  return kernel(p, d);
}

/** Flatten nested offsets to a profile source + net distance, then compile. */
export function compileOffsetBoundary(op: { kind: "offset"; of: unknown; d: number }): Profile[] {
  let d = op.d;
  let node: unknown = op.of;
  while (node && typeof node === "object" && (node as { kind?: string }).kind === "offset") {
    const inner = node as { of: unknown; d: number };
    d += inner.d;
    node = inner.of;
  }
  if (!node || typeof node !== "object" || (node as { kind?: string }).kind !== "profile")
    return [];
  return roundOffsetValue(node as Profile, d);
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
