import { point, type Line, type Point } from "@design-scenes/geom";
import type { Vec2 } from "@design-scenes/geom";
import { lerp } from "@design-scenes/geom";

export type PointGizmo = {
  kind: "point";
  index: number;
  x: number;
  y: number;
};

export type DistanceGizmo = {
  kind: "distance";
  index: number;
  origin: Vec2;
  d: number;
};

export type GliderGizmo = {
  kind: "glider";
  index: number;
  a: Vec2;
  b: Vec2;
  t: number;
};

export type Gizmo = PointGizmo | DistanceGizmo | GliderGizmo;

const gizmos: Gizmo[] = [];
const overrides = new Map<number, number[]>();
let nextIndex = 0;
let silent = 0;

export function beginWidgetFrame(): void {
  nextIndex = 0;
  gizmos.length = 0;
}

/** Run edit* as plain literals — no gizmos, no write-back indices. */
export function withoutWidgets<T>(fn: () => T): T {
  silent += 1;
  try {
    return fn();
  } finally {
    silent -= 1;
  }
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

export function editPoint(x: number, y: number): Point {
  if (silent) return point(x, y);
  const index = takeIndex();
  const o = overrides.get(index);
  const px = o?.[0] ?? x;
  const py = o?.[1] ?? y;
  gizmos.push({ kind: "point", index, x: px, y: py });
  return point(px, py);
}

export function editDistanceToPoint(origin: Vec2, d: number): number {
  if (silent) return d;
  const index = takeIndex();
  const o = overrides.get(index);
  const dist = o?.[0] ?? d;
  gizmos.push({
    kind: "distance",
    index,
    origin: { x: origin.x, y: origin.y },
    d: dist,
  });
  return dist;
}

export function editPointOnLine(lineSeg: Line, t: number): Point {
  if (silent) {
    const p = lerp(lineSeg.a, lineSeg.b, Math.min(1, Math.max(0, t)));
    return point(p.x, p.y);
  }
  const index = takeIndex();
  const o = overrides.get(index);
  const tt = Math.min(1, Math.max(0, o?.[0] ?? t));
  gizmos.push({
    kind: "glider",
    index,
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
