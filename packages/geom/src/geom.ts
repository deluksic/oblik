import type { Vec2 } from "./vec.ts";
import { makeBase, type Base, type Group } from "./identity.ts";
import type { Geom3 } from "./geom3.ts";

export type Point = Base & { kind: "point"; x: number; y: number };
export type Line = Base & { kind: "line"; a: Point; b: Point };
export type Circle = Base & { kind: "circle"; center: Point; radius: number };
export type Polyline = Base & { kind: "polyline"; points: Point[] };

export type Geom2 = Point | Line | Circle | Polyline;
export type Geom = Geom2 | Geom3 | Group;

export function point(x: number, y: number): Point {
  return { ...makeBase("point", "point"), kind: "point", x, y };
}

export function line(a: Vec2, b: Vec2): Line {
  return {
    ...makeBase("line", "line"),
    kind: "line",
    a: point(a.x, a.y),
    b: point(b.x, b.y),
  };
}

export function circle(center: Vec2, radius: number): Circle {
  return {
    ...makeBase("circle", "circle"),
    kind: "circle",
    center: point(center.x, center.y),
    radius,
  };
}

export function polyline(points: Vec2[]): Polyline {
  return {
    ...makeBase("polyline", "polyline"),
    kind: "polyline",
    points: points.map((p) => point(p.x, p.y)),
  };
}

export type Drawable =
  | { geom: Point }
  | { geom: Line }
  | { geom: Circle }
  | { geom: Polyline };

export type Drawable3 = { geom: Geom3 };

function walk(g: Geom, visit2: (s: Geom2) => void, visit3: (s: Geom3) => void) {
  if (g.kind === "group") {
    for (const c of g.children) walk(c as Geom, visit2, visit3);
    return;
  }
  if (
    g.kind === "point3" ||
    g.kind === "line3" ||
    g.kind === "circle3" ||
    g.kind === "box3" ||
    g.kind === "cylinder3"
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
          case "line":
            out.push({ geom: s });
            break;
          case "circle":
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

export function flatten3(geom: Geom | Geom[]): Drawable3[] {
  const out: Drawable3[] = [];
  const visit = (g: Geom) =>
    walk(g, () => {}, (s) => {
      out.push({ geom: s });
    });
  if (Array.isArray(geom)) {
    for (const g of geom) visit(g);
  } else {
    visit(geom);
  }
  return out;
}
