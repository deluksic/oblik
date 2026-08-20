import {
  lerp3,
  point3,
  type Line3,
  type Point3,
  type Vec3,
} from "@design-scenes/geom";

export type Point3Gizmo = {
  kind: "point3";
  index: number;
  x: number;
  y: number;
  z: number;
};

export type Distance3Gizmo = {
  kind: "distance3";
  index: number;
  origin: Vec3;
  d: number;
};

export type Glider3Gizmo = {
  kind: "glider3";
  index: number;
  a: Vec3;
  b: Vec3;
  t: number;
};

export type Gizmo3 = Point3Gizmo | Distance3Gizmo | Glider3Gizmo;

const gizmos: Gizmo3[] = [];
const overrides = new Map<number, number[]>();
let nextIndex = 0;

export function beginWidgetFrame3(): void {
  nextIndex = 0;
  gizmos.length = 0;
}

export function setWidgetOverride3(index: number, values: number[]): void {
  overrides.set(index, values);
}

export function clearWidgetOverrides3(): void {
  overrides.clear();
}

export function getGizmos3(): readonly Gizmo3[] {
  return gizmos;
}

function takeIndex(): number {
  const i = nextIndex;
  nextIndex += 1;
  return i;
}

export function editPoint3(x: number, y: number, z: number): Point3 {
  const index = takeIndex();
  const o = overrides.get(index);
  const px = o?.[0] ?? x;
  const py = o?.[1] ?? y;
  const pz = o?.[2] ?? z;
  gizmos.push({ kind: "point3", index, x: px, y: py, z: pz });
  return point3(px, py, pz);
}

export function editDistance3(origin: Vec3, d: number): number {
  const index = takeIndex();
  const o = overrides.get(index);
  const dist = o?.[0] ?? d;
  gizmos.push({
    kind: "distance3",
    index,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    d: dist,
  });
  return dist;
}

export function editPointOnLine3(seg: Line3, t: number): Point3 {
  const index = takeIndex();
  const o = overrides.get(index);
  const tt = Math.min(1, Math.max(0, o?.[0] ?? t));
  gizmos.push({
    kind: "glider3",
    index,
    a: seg.a,
    b: seg.b,
    t: tt,
  });
  const p = lerp3(seg.a, seg.b, tt);
  return point3(p.x, p.y, p.z);
}

export function gizmoValues3(g: Gizmo3): number[] {
  switch (g.kind) {
    case "point3":
      return [g.x, g.y, g.z];
    case "distance3":
      return [g.d];
    case "glider3":
      return [g.t];
  }
}
