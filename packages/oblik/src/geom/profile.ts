import type { Along, Branch, Circle, LineLike, Profile, ProfileEdge } from "./types";
import { lineBasis } from "./ops";
import { circleUnitAt } from "./gliders";
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

const EPS = 1e-9;

export function isAlong(v: unknown): v is Along {
  return !!v && typeof v === "object" && (v as { kind?: string }).kind === "along";
}

export function isProfile(v: { kind: string }): v is Profile {
  return v.kind === "profile";
}

export function alongValue(carrier: Circle, k: number): Along {
  return { kind: "along", carrier, k: k < 0 ? -1 : 1 };
}

export function nanProfile(): Profile {
  return { kind: "profile", outer: [] };
}

export function isFiniteProfile(p: Profile): boolean {
  if (p.outer.length < 2) return false;
  return p.outer.every((e) => isFiniteEdge(e));
}

function isFiniteEdge(e: ProfileEdge): boolean {
  if (!isFiniteVec(e.a) || !isFiniteVec(e.b)) return false;
  if (e.carrier.kind === "circle") {
    const c = e.carrier;
    if (!isFiniteVec(c.center) || !Number.isFinite(c.radius) || Math.abs(c.radius) < EPS) return false;
    if (e.k !== 1 && e.k !== -1) return false;
    return dist(e.a, e.b) > EPS;
  }
  const { origin, dir } = lineBasis(e.carrier);
  return isFiniteVec(origin) && isFiniteVec(dir) && dist(e.a, e.b) > EPS;
}

function asVec2(v: unknown): Vec2 | null {
  if (!v || typeof v !== "object") return null;
  const p = v as { x?: unknown; y?: unknown; kind?: string };
  if (p.kind === "along" || p.kind === "circle" || p.kind === "line" || p.kind === "segment" || p.kind === "parallelLine") {
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
  return add(c.center, mul({ x: u.ux, y: u.uy }, Math.abs(c.radius)));
}

/** CCW from `from` through `through` is `1`. */
export function alongK(c: Circle, from: Vec2, through: Vec2): Branch {
  const cr = cross2(sub(from, c.center), sub(through, c.center));
  if (Math.abs(cr) < 1e-12) return 1;
  return cr > 0 ? 1 : -1;
}

/** Signed CCW delta from `a` to `b` on `c` (k=1) or CW (k=-1), in (0, 2π]. */
export function circleDelta(c: Circle, a: Vec2, b: Vec2, k: Branch): number {
  const ua = circleUnitAt(c, a);
  const ub = circleUnitAt(c, b);
  let delta = Math.atan2(ub.uy, ub.ux) - Math.atan2(ua.uy, ua.ux);
  if (k === 1) {
    while (delta <= 0) delta += 2 * Math.PI;
    while (delta > 2 * Math.PI) delta -= 2 * Math.PI;
  } else {
    while (delta >= 0) delta -= 2 * Math.PI;
    while (delta < -2 * Math.PI) delta += 2 * Math.PI;
  }
  return delta;
}

export function profileValue(cycle: readonly unknown[]): Profile {
  if (!Array.isArray(cycle) || cycle.length < 4 || cycle.length % 2 !== 0) return nanProfile();
  const n = cycle.length / 2;
  const points: Vec2[] = [];
  const carriers: Array<{ geom: LineLike | Circle; k?: Branch }> = [];
  for (let i = 0; i < n; i++) {
    const p = asVec2(cycle[i * 2]);
    if (!p || !isFiniteVec(p)) return nanProfile();
    points.push(p);
    const item = cycle[i * 2 + 1];
    if (isAlong(item)) {
      if (item.carrier.kind !== "circle") return nanProfile();
      carriers.push({ geom: item.carrier, k: item.k < 0 ? -1 : 1 });
      continue;
    }
    const line = asLineLike(item);
    if (line) {
      carriers.push({ geom: line });
      continue;
    }
    return nanProfile();
  }
  const outer: ProfileEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const c = carriers[i]!;
    if (c.geom.kind === "circle") {
      if (c.k !== 1 && c.k !== -1) return nanProfile();
      outer.push({
        a: projectOnCircle(c.geom, a),
        b: projectOnCircle(c.geom, b),
        carrier: c.geom,
        k: c.k,
      });
    } else {
      outer.push({
        a: projectOnLine(c.geom, a),
        b: projectOnLine(c.geom, b),
        carrier: c.geom,
      });
    }
  }
  const profile: Profile = { kind: "profile", outer };
  return isFiniteProfile(profile) ? profile : nanProfile();
}

function sampleArc(e: ProfileEdge, steps = 24): Vec2[] {
  if (e.carrier.kind !== "circle" || (e.k !== 1 && e.k !== -1)) return [e.a, e.b];
  const c = e.carrier;
  const delta = circleDelta(c, e.a, e.b, e.k);
  const ua = circleUnitAt(c, e.a);
  const a0 = Math.atan2(ua.uy, ua.ux);
  const out: Vec2[] = [];
  const n = Math.max(2, Math.ceil((Math.abs(delta) / Math.PI) * steps));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ang = a0 + delta * t;
    out.push(add(c.center, mul(vec(Math.cos(ang), Math.sin(ang)), Math.abs(c.radius))));
  }
  return out;
}

export function tessellateProfile(p: Profile): Vec2[] {
  const poly: Vec2[] = [];
  for (const e of p.outer) {
    poly.push(e.a);
    if (e.carrier.kind === "circle") poly.push(...sampleArc(e));
  }
  return poly;
}

export function profileContains(p: Profile, q: Vec2): boolean {
  if (!isFiniteProfile(p) || !isFiniteVec(q)) return false;
  const poly = tessellateProfile(p);
  if (poly.length < 3) return false;
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

function distToArc(e: ProfileEdge, q: Vec2): number {
  if (e.carrier.kind !== "circle" || (e.k !== 1 && e.k !== -1)) return distToSegment(q, e.a, e.b);
  const c = e.carrier;
  const closest = projectOnCircle(c, q);
  const cr = alongK(c, e.a, closest);
  const onArc = cr === e.k || dist(closest, e.a) < EPS || dist(closest, e.b) < EPS;
  if (onArc) {
    const delta = Math.abs(circleDelta(c, e.a, closest, e.k));
    const full = Math.abs(circleDelta(c, e.a, e.b, e.k));
    if (delta <= full + 1e-6) return dist(q, closest);
  }
  return Math.min(dist(q, e.a), dist(q, e.b));
}

export function distToProfile(p: Profile, q: Vec2): number {
  if (!isFiniteProfile(p)) return Infinity;
  if (profileContains(p, q)) return 0;
  let best = Infinity;
  for (const e of p.outer) {
    const d = e.carrier.kind === "circle" ? distToArc(e, q) : distToSegment(q, e.a, e.b);
    if (d < best) best = d;
  }
  return best;
}

/** SVG path in world (y-up) user space. Arc sweep 1 is CCW. */
export function edgesSvgPath(edges: readonly ProfileEdge[], close = false): string {
  if (edges.length === 0) return "";
  const start = edges[0]!.a;
  const parts = [`M ${start.x} ${start.y}`];
  for (const e of edges) {
    if (e.carrier.kind === "circle" && (e.k === 1 || e.k === -1)) {
      const r = Math.abs(e.carrier.radius);
      const delta = circleDelta(e.carrier, e.a, e.b, e.k);
      const large = Math.abs(delta) > Math.PI ? 1 : 0;
      const sweep = e.k === 1 ? 1 : 0;
      parts.push(`A ${r} ${r} 0 ${large} ${sweep} ${e.b.x} ${e.b.y}`);
    } else {
      parts.push(`L ${e.b.x} ${e.b.y}`);
    }
  }
  if (close) parts.push("Z");
  return parts.join(" ");
}

export function profileSvgPath(p: Profile): string {
  if (!isFiniteProfile(p)) return "";
  return edgesSvgPath(p.outer, true);
}
