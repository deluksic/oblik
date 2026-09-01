import type { Geom3 } from "./geom3";
import {
  makeBase,
  geomSiteFromOpts,
  geomEditableFromOpts,
  geomBindFromOpts,
  geomStyleFromOpts,
  geomLiveValues,
  constructGeom,
  takeFrameGeoms,
  type Base,
  type GeomSiteOpts,
} from "./identity";
import {
  add,
  cross2,
  dot,
  isFiniteVec,
  mul,
  norm,
  perp,
  signedDistToLine,
  sub,
  type Vec2,
} from "./vec";

export type Point = Base & { kind: "point"; x: number; y: number };
/** Finite stroke between two endpoints. */
export type Segment = Base & { kind: "segment"; a: Point; b: Point };
/** Infinite line through `origin` along unit `direction`. */
export type Line = Base & {
  kind: "line";
  origin: Point;
  direction: Vec2;
  /** Present when this line was produced by `offsetLine`. Stored literal, not mirrored. */
  offsetDistance?: number;
  /** Same |offsetDistance|, opposite side of the carrier. */
  offsetMirror?: boolean;
};
export type Circle = Base & { kind: "circle"; center: Point; radius: number };
export type Arc = Base & {
  kind: "arc";
  center: Point;
  radius: number;
  /** Start angle, radians, CCW from +X. */
  a0: number;
  /** End angle, radians, CCW from +X. Sweep is CCW from a0 to a1. */
  a1: number;
};
export type Polyline = Base & { kind: "polyline"; points: Point[] };

export type Geom2 = Point | Segment | Line | Circle | Arc | Polyline;
export type Geom = Geom2 | Geom3;

export type LineLike = Segment | Line;

/** Parallel construction: drawn line plus the signed distance that produced it. */
export type OffsetLine = { line: Line; distance: number };

export type Branch = 1 | -1;

function siteBase(kind: string, createdBy: string, opts?: GeomSiteOpts): Base {
  return makeBase(
    kind,
    createdBy,
    geomSiteFromOpts(opts),
    geomEditableFromOpts(opts),
    geomBindFromOpts(opts),
    geomStyleFromOpts(opts),
  );
}

function liveNums(opts?: GeomSiteOpts): number[] | undefined {
  if (!geomEditableFromOpts(opts)) return undefined;
  return geomLiveValues(geomSiteFromOpts(opts));
}

export function point(x: number, y: number, site?: GeomSiteOpts): Point {
  return constructGeom(() => {
    const o = liveNums(site);
    const px = o?.[0] ?? x;
    const py = o?.[1] ?? y;
    return { ...siteBase("point", "point", site), kind: "point", x: px, y: py } as Point;
  });
}

export function segment(a: Vec2, b: Vec2, site?: GeomSiteOpts): Segment {
  return constructGeom(() => ({
    ...siteBase("segment", "segment", site),
    kind: "segment",
    a: point(a.x, a.y),
    b: point(b.x, b.y),
  }));
}

/** Infinite line through `a` and `b`. */
export function line(a: Vec2, b: Vec2, site?: GeomSiteOpts): Line {
  return constructGeom(() => makeLine(a, b, site));
}

function makeLine(
  a: Vec2,
  b: Vec2,
  site?: GeomSiteOpts,
  offsetDistance?: number,
  offsetMirror?: boolean,
): Line {
  const dir = norm(sub(b, a));
  return {
    ...siteBase("line", "line", site),
    kind: "line",
    origin: point(a.x, a.y),
    direction: dir,
    offsetDistance,
    offsetMirror,
  };
}

export function circle(center: Vec2, radius: number, site?: GeomSiteOpts): Circle {
  return constructGeom(() => {
    const o = liveNums(site);
    const r = o?.[0] ?? radius;
    return {
      ...siteBase("circle", "circle", site),
      kind: "circle",
      center: point(center.x, center.y),
      radius: r,
    };
  });
}

export function arc(
  center: Vec2,
  radius: number,
  a0: number,
  a1: number,
  site?: GeomSiteOpts,
): Arc {
  return constructGeom(() => ({
    ...siteBase("arc", "arc", site),
    kind: "arc",
    center: point(center.x, center.y),
    radius,
    a0,
    a1,
  }));
}

export function polyline(points: Vec2[], site?: GeomSiteOpts): Polyline {
  return constructGeom(() => ({
    ...siteBase("polyline", "polyline", site),
    kind: "polyline",
    points: points.map((p) => point(p.x, p.y)),
  }));
}

function lineBasis(g: LineLike): { origin: Vec2; dir: Vec2 } {
  if (g.kind === "line") {
    return { origin: g.origin, dir: g.direction };
  }
  return { origin: g.a, dir: norm(sub(g.b, g.a)) };
}

/** Signed distance to the infinite carrier of `geom` (left normal). */
export function signedDist(p: Vec2, geom: LineLike): number {
  const { origin, dir } = lineBasis(geom);
  return signedDistToLine(p, origin, dir);
}

export type OffsetLineOpts = GeomSiteOpts & {
  /** Same |distance|, offset to the opposite side of the carrier. */
  mirror?: boolean;
};

/** Applied signed distance after optional mirror. */
export function offsetDisplayDist(d: number, mirror = false): number {
  return mirror ? -d : d;
}

/**
 * Parallel infinite line, offset by signed distance along the left normal.
 * Draws `.line`. Distance is the stored literal (field tools copy in a Length slot).
 */
export function offsetLine(geom: LineLike, signedD: number, site?: OffsetLineOpts): OffsetLine {
  const o = liveNums(site);
  const d = o?.[0] ?? signedD;
  const mirror = site?.mirror ?? false;
  const applied = offsetDisplayDist(d, mirror);
  const { origin, dir } = lineBasis(geom);
  const n = perp(dir);
  const p = add(origin, mul(n, applied));
  const offset = constructGeom(() => makeLine(p, add(p, dir), site, d, mirror));
  return { line: offset, distance: d };
}

/** Infinite line through `through`, perpendicular to the carrier of `geom`. */
export function perpendicularLine(geom: LineLike, through: Vec2, site?: GeomSiteOpts): Line {
  return constructGeom(() => {
    const { dir } = lineBasis(geom);
    const pd = perp(dir);
    return makeLine(through, add(through, pd), site);
  });
}

function nanPoint(site?: GeomSiteOpts): Point {
  return point(Number.NaN, Number.NaN, site);
}

/** Intersection of two infinite lines. Parallel → NaN coords. */
export function lineIntersection(a: LineLike, b: LineLike, site?: GeomSiteOpts): Point {
  return constructGeom(() => {
    const la = lineBasis(a);
    const lb = lineBasis(b);
    const denom = cross2(la.dir, lb.dir);
    if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return nanPoint(site);
    const t = cross2(sub(lb.origin, la.origin), lb.dir) / denom;
    const p = add(la.origin, mul(la.dir, t));
    if (!isFiniteVec(p)) return nanPoint(site);
    return point(p.x, p.y, site);
  });
}

/**
 * Line/circle hits. `k` is the ±sqrt branch, frozen at creation.
 * No hit → NaN coords (does not hop to the other root).
 */
export function circleLineIntersection(
  c: Circle,
  l: LineLike,
  k: Branch,
  site?: GeomSiteOpts,
): Point {
  return constructGeom(() => {
    if (!isFiniteVec(c.center) || !Number.isFinite(c.radius)) return nanPoint(site);
    const { origin, dir } = lineBasis(l);
    const w = sub(origin, c.center);
    const dw = dot(dir, w);
    const disc = dw * dw - (dot(w, w) - c.radius * c.radius);
    if (!(disc >= 0) || !Number.isFinite(disc)) return nanPoint(site);
    const t = -dw + k * Math.sqrt(disc);
    const p = add(origin, mul(dir, t));
    if (!isFiniteVec(p)) return nanPoint(site);
    return point(p.x, p.y, site);
  });
}

/** Circle/circle hits. `k` is the side of the center line. No hit → NaN. */
export function circleCircleIntersection(
  a: Circle,
  b: Circle,
  k: Branch,
  site?: GeomSiteOpts,
): Point {
  return constructGeom(() => {
    if (!isFiniteVec(a.center) || !isFiniteVec(b.center)) return nanPoint(site);
    if (!Number.isFinite(a.radius) || !Number.isFinite(b.radius)) return nanPoint(site);
    const dvec = sub(b.center, a.center);
    const d = Math.hypot(dvec.x, dvec.y);
    if (d < 1e-12) return nanPoint(site);
    const aa = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d);
    const h2 = a.radius * a.radius - aa * aa;
    if (!(h2 >= 0) || !Number.isFinite(h2)) return nanPoint(site);
    const h = Math.sqrt(h2);
    const mid = add(a.center, mul(dvec, aa / d));
    const n = perp({ x: dvec.x / d, y: dvec.y / d });
    const p = add(mid, mul(n, k * h));
    if (!isFiniteVec(p)) return nanPoint(site);
    return point(p.x, p.y, site);
  });
}

function geom2IsFinite(s: Geom2): boolean {
  switch (s.kind) {
    case "point":
      return isFiniteVec(s);
    case "segment":
      return isFiniteVec(s.a) && isFiniteVec(s.b);
    case "line":
      return isFiniteVec(s.origin) && isFiniteVec(s.direction);
    case "circle":
      return isFiniteVec(s.center) && Number.isFinite(s.radius);
    case "arc":
      return (
        isFiniteVec(s.center) &&
        Number.isFinite(s.radius) &&
        Number.isFinite(s.a0) &&
        Number.isFinite(s.a1)
      );
    case "polyline":
      return s.points.every(isFiniteVec);
    default:
      return false;
  }
}

export type Drawable =
  | { geom: Point }
  | { geom: Segment }
  | { geom: Line }
  | { geom: Circle }
  | { geom: Arc }
  | { geom: Polyline };

export type Drawable3 = { geom: Geom3 };

function walk(g: Geom, visit2: (s: Geom2) => void, visit3: (s: Geom3) => void) {
  if (
    g.kind === "point3" ||
    g.kind === "segment3" ||
    g.kind === "circle3" ||
    g.kind === "box3" ||
    g.kind === "cylinder3" ||
    g.kind === "mesh3"
  ) {
    visit3(g);
    return;
  }
  visit2(g);
}

export function flatten(geom: Geom | Geom[]): Drawable[] {
  const out: Drawable[] = [];
  const visit = (g: Geom | Geom[]) => {
    if (Array.isArray(g)) {
      for (const x of g) visit(x);
      return;
    }
    walk(
      g,
      (s) => {
        if (!geom2IsFinite(s)) return;
        switch (s.kind) {
          case "point":
            out.push({ geom: s });
            break;
          case "segment":
            out.push({ geom: s });
            break;
          case "line":
            out.push({ geom: s });
            break;
          case "circle":
            out.push({ geom: s });
            break;
          case "arc":
            out.push({ geom: s });
            break;
          case "polyline":
            out.push({ geom: s });
            break;
        }
      },
      () => {},
    );
  };
  visit(geom);
  return out;
}

function asDrawable(g: unknown): Drawable | null {
  if (!g || typeof g !== "object" || !("kind" in g)) return null;
  const s = g as Geom2;
  switch (s.kind) {
    case "point":
    case "segment":
    case "line":
    case "circle":
    case "arc":
    case "polyline":
      if (!geom2IsFinite(s)) return null;
      return { geom: s } as Drawable;
    default:
      return null;
  }
}

export function getDrawn(): Drawable[] {
  const out: Drawable[] = [];
  for (const g of takeFrameGeoms()) {
    const d = asDrawable(g);
    if (d) out.push(d);
  }
  return out;
}

/** Emitted constructors plus optional `scene()` return, de-duplicated by `id`. */
export function collectDrawables(returned?: Geom | Geom[] | void | null): Drawable[] {
  const out: Drawable[] = [];
  const seen = new Set<string>();
  const track = (d: Drawable) => {
    if (seen.has(d.geom.id)) return;
    seen.add(d.geom.id);
    out.push(d);
  };
  for (const d of getDrawn()) track(d);
  if (returned != null) {
    for (const d of flatten(returned)) track(d);
  }
  return out;
}

export function flatten3(geom: Geom | Geom[]): Drawable3[] {
  const out: Drawable3[] = [];
  const visit = (g: Geom | Geom[]) => {
    if (Array.isArray(g)) {
      for (const x of g) visit(x);
      return;
    }
    walk(
      g,
      () => {},
      (s) => {
        out.push({ geom: s });
      },
    );
  };
  visit(geom);
  return out;
}
