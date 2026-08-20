import { point, type Line, type Point } from "../lib/geom.ts";
import { captureCallSite, type CallSite } from "../lib/provenance.ts";
import type { Vec2 } from "../lib/vec.ts";
import { lerp } from "../lib/vec.ts";

export type WidgetSite = CallSite & { instance: number };

export type PointGizmo = {
  kind: "point";
  index: number;
  site: WidgetSite;
  x: number;
  y: number;
};

export type DistanceGizmo = {
  kind: "distance";
  index: number;
  site: WidgetSite;
  origin: Vec2;
  d: number;
};

export type GliderGizmo = {
  kind: "glider";
  index: number;
  site: WidgetSite;
  a: Vec2;
  b: Vec2;
  t: number;
};

export type Gizmo = PointGizmo | DistanceGizmo | GliderGizmo;

const gizmos: Gizmo[] = [];
const overrides = new Map<number, number[]>();
const siteCounts = new Map<string, number>();
let nextIndex = 0;

export function beginWidgetFrame(): void {
  nextIndex = 0;
  gizmos.length = 0;
  siteCounts.clear();
}

export function setWidgetOverride(index: number, values: number[]): void {
  overrides.set(index, values);
}

export function clearWidgetOverrides(): void {
  overrides.clear();
}

export function getGizmos(): readonly Gizmo[] {
  return gizmos;
}

function takeIndex(): number {
  const i = nextIndex;
  nextIndex += 1;
  return i;
}

function takeSite(): WidgetSite {
  const site = captureCallSite();
  const key = `${site.file}:${site.line}:${site.column}`;
  const instance = siteCounts.get(key) ?? 0;
  siteCounts.set(key, instance + 1);
  return { ...site, instance };
}

export function editPoint(x: number, y: number): Point {
  const index = takeIndex();
  const widgetSite = takeSite();
  const o = overrides.get(index);
  const px = o?.[0] ?? x;
  const py = o?.[1] ?? y;
  gizmos.push({ kind: "point", index, site: widgetSite, x: px, y: py });
  return point(px, py);
}

export function editDistanceToPoint(origin: Vec2, d: number): number {
  const index = takeIndex();
  const widgetSite = takeSite();
  const o = overrides.get(index);
  const dist = o?.[0] ?? d;
  gizmos.push({
    kind: "distance",
    index,
    site: widgetSite,
    origin: { x: origin.x, y: origin.y },
    d: dist,
  });
  return dist;
}

export function editPointOnLine(lineSeg: Line, t: number): Point {
  const index = takeIndex();
  const widgetSite = takeSite();
  const o = overrides.get(index);
  const tt = Math.min(1, Math.max(0, o?.[0] ?? t));
  gizmos.push({
    kind: "glider",
    index,
    site: widgetSite,
    a: lineSeg.a,
    b: lineSeg.b,
    t: tt,
  });
  const p = lerp(lineSeg.a, lineSeg.b, tt);
  return point(p.x, p.y);
}

export function gizmoValues(g: Gizmo): number[] {
  switch (g.kind) {
    case "point":
      return [g.x, g.y];
    case "distance":
      return [g.d];
    case "glider":
      return [g.t];
  }
}
