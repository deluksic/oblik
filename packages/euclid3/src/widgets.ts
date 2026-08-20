import {
  lerp3,
  point3,
  type Line3,
  type Point3,
  type Vec3,
} from "@design-scenes/geom";

export type SiteOpts3 = {
  id?: string;
  at?: [number, number];
};

export type GizmoAt3 = { line: number; column: number };

type Located = { site: string; at: GizmoAt3 };

export type Point3Gizmo = Located & {
  kind: "point3";
  x: number;
  y: number;
  z: number;
};

export type Distance3Gizmo = Located & {
  kind: "distance3";
  origin: Vec3;
  d: number;
};

export type Glider3Gizmo = Located & {
  kind: "glider3";
  a: Vec3;
  b: Vec3;
  t: number;
};

export type Gizmo3 = Point3Gizmo | Distance3Gizmo | Glider3Gizmo;

const gizmos: Gizmo3[] = [];
const overrides = new Map<string, number[]>();

function siteFrom(opts?: SiteOpts3): Located | null {
  if (!opts?.id || !opts.at || opts.at.length < 2) return null;
  const line = opts.at[0];
  const column = opts.at[1];
  if (typeof line !== "number" || typeof column !== "number") return null;
  return { site: opts.id, at: { line, column } };
}

export function beginWidgetFrame3(): void {
  gizmos.length = 0;
}

export function setWidgetOverride3(site: string, values: number[]): void {
  overrides.set(site, values);
}

export function clearWidgetOverrides3(): void {
  overrides.clear();
}

export function getGizmos3(): readonly Gizmo3[] {
  return gizmos;
}

export function editPoint3(
  x: number,
  y: number,
  z: number,
  site?: SiteOpts3,
): Point3 {
  const o = site?.id ? overrides.get(site.id) : undefined;
  const px = o?.[0] ?? x;
  const py = o?.[1] ?? y;
  const pz = o?.[2] ?? z;
  const located = siteFrom(site);
  if (located) gizmos.push({ kind: "point3", ...located, x: px, y: py, z: pz });
  return point3(px, py, pz);
}

export function editDistance3(
  origin: Vec3,
  d: number,
  site?: SiteOpts3,
): number {
  const o = site?.id ? overrides.get(site.id) : undefined;
  const dist = o?.[0] ?? d;
  const located = siteFrom(site);
  if (located) {
    gizmos.push({
      kind: "distance3",
      ...located,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      d: dist,
    });
  }
  return dist;
}

export function editPointOnLine3(
  seg: Line3,
  t: number,
  site?: SiteOpts3,
): Point3 {
  const o = site?.id ? overrides.get(site.id) : undefined;
  const tt = Math.min(1, Math.max(0, o?.[0] ?? t));
  const located = siteFrom(site);
  if (located) {
    gizmos.push({
      kind: "glider3",
      ...located,
      a: seg.a,
      b: seg.b,
      t: tt,
    });
  }
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
