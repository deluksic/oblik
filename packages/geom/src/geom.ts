import type { Geom3 } from "./geom3";
import {
  makeBase,
  geomSiteFromOpts,
  constructGeom,
  withoutDraw,
  takeFrameGeoms,
  type Base,
  type GeomSiteOpts,
  type Group,
} from "./identity";
import { add, cross2, mul, norm, perp, sub, type Vec2 } from "./vec";

export type Point = Base & { kind: "point"; x: number; y: number };
/** Finite stroke between two endpoints. */
export type Segment = Base & { kind: "segment"; a: Point; b: Point };
/** Infinite line through `origin` along unit `direction`. */
export type Line = Base & {
  kind: "line";
  origin: Point;
  direction: Vec2;
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
export type Geom = Geom2 | Geom3 | Group;

export type LineLike = Segment | Line;

export function point(x: number, y: number, site?: GeomSiteOpts): Point {
  return constructGeom(
    () => ({ ...makeBase("point", "point", geomSiteFromOpts(site)), kind: "point", x, y }) as Point,
  );
}

export function segment(a: Vec2, b: Vec2, site?: GeomSiteOpts): Segment {
  return constructGeom(() => ({
    ...makeBase("segment", "segment", geomSiteFromOpts(site)),
    kind: "segment",
    a: point(a.x, a.y),
    b: point(b.x, b.y),
  }));
}

/** Infinite line through `a` and `b`. */
export function line(a: Vec2, b: Vec2, site?: GeomSiteOpts): Line {
  return constructGeom(() => makeLine(a, b, site));
}

function makeLine(a: Vec2, b: Vec2, site?: GeomSiteOpts): Line {
  const dir = norm(sub(b, a));
  return {
    ...makeBase("line", "line", geomSiteFromOpts(site)),
    kind: "line",
    origin: point(a.x, a.y),
    direction: dir,
  };
}

export function circle(center: Vec2, radius: number, site?: GeomSiteOpts): Circle {
  return constructGeom(() => ({
    ...makeBase("circle", "circle", geomSiteFromOpts(site)),
    kind: "circle",
    center: point(center.x, center.y),
    radius,
  }));
}

export function arc(center: Vec2, radius: number, a0: number, a1: number): Arc {
  return constructGeom(() => ({
    ...makeBase("arc", "arc"),
    kind: "arc",
    center: point(center.x, center.y),
    radius,
    a0,
    a1,
  }));
}

export function polyline(points: Vec2[]): Polyline {
  return constructGeom(() => ({
    ...makeBase("polyline", "polyline"),
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

/** Parallel infinite line, offset by signed distance along the left normal. Derived — not drawn. */
export function offsetLine(geom: LineLike, signedD: number, site?: GeomSiteOpts): Line {
  return withoutDraw(() => {
    const { origin, dir } = lineBasis(geom);
    const n = perp(dir);
    const o = add(origin, mul(n, signedD));
    return makeLine(o, add(o, dir), site);
  });
}

/** Intersection of two infinite lines; `null` when parallel. */
export function lineIntersection(a: LineLike, b: LineLike): Point | null {
  return constructGeom(() => {
    const la = lineBasis(a);
    const lb = lineBasis(b);
    const denom = cross2(la.dir, lb.dir);
    if (Math.abs(denom) < 1e-12) return null;
    const t = cross2(sub(lb.origin, la.origin), lb.dir) / denom;
    const p = add(la.origin, mul(la.dir, t));
    return point(p.x, p.y);
  });
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
  if (g.kind === "group") {
    for (const c of g.children) walk(c as Geom, visit2, visit3);
    return;
  }
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
  const visit = (g: Geom) =>
    walk(
      g,
      (s) => {
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
  if (Array.isArray(geom)) {
    for (const g of geom) visit(g);
  } else {
    visit(geom);
  }
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
      return { geom: s };
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
  const add = (d: Drawable) => {
    if (seen.has(d.geom.id)) return;
    seen.add(d.geom.id);
    out.push(d);
  };
  for (const d of getDrawn()) add(d);
  if (returned != null) {
    for (const d of flatten(returned)) add(d);
  }
  return out;
}

export function flatten3(geom: Geom | Geom[]): Drawable3[] {
  const out: Drawable3[] = [];
  const visit = (g: Geom) =>
    walk(
      g,
      () => {},
      (s) => {
        out.push({ geom: s });
      },
    );
  if (Array.isArray(geom)) {
    for (const g of geom) visit(g);
  } else {
    visit(geom);
  }
  return out;
}
