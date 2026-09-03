import { allocId, captureUserStack, currentBind, lerp3, point3 as makePoint3, resetIdentity, type CallSite, type Segment3, type Point3, type Vec3 } from "@design-scenes/geom";


const { max, min } = Math;
export type SiteOpts3 = {
  file?: string;
  at?: [number, number];
  editable?: boolean;
  bind?: string;
  style?: import("@design-scenes/geom").GeomStyle;
  __annotations__?: {
    file?: string;
    at?: [number, number];
    editable?: boolean;
    bind?: string;
  };
};

export type GizmoAt3 = { file: string; line: number; column: number };

/** `site` is the write target. `id` is `site#bind` or `site#k`. */
type Located = { site: string; id: string; bind?: string; at: GizmoAt3; stack?: CallSite[]; style?: import("@design-scenes/geom").GeomStyle };

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
  const nested = opts?.__annotations__;
  const file = nested?.file ?? opts?.file;
  const at = nested?.at ?? opts?.at;
  if (!file || !at || at.length < 2) return null;
  const line = at[0];
  const column = at[1];
  if (typeof line !== "number" || typeof column !== "number") return null;
  const site = `${file}:${line}:${column}`;
  const bind = currentBind();
  return {
    site,
    id: allocId(site, bind),
    ...(bind ? { bind } : {}),
    at: { file, line, column },
    stack: captureUserStack(),
    ...(opts?.style ? { style: opts.style } : {}),
  };
}

export function beginWidgetFrame3(): void {
  gizmos.length = 0;
  resetIdentity();
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

export function point3(x: number, y: number, z: number, site?: SiteOpts3): Point3 {
  const located = siteFrom(site);
  const o = located ? overrides.get(located.site) : undefined;
  const px = o?.[0] ?? x;
  const py = o?.[1] ?? y;
  const pz = o?.[2] ?? z;
  if (located) gizmos.push({ kind: "point3", ...located, x: px, y: py, z: pz });
  return makePoint3(px, py, pz, site);
}

export function distance3(origin: Vec3, d: number, site?: SiteOpts3): number {
  const located = siteFrom(site);
  const o = located ? overrides.get(located.site) : undefined;
  const dist = o?.[0] ?? d;
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

export function pointOnSegment3(seg: Segment3, t: number, site?: SiteOpts3): Point3 {
  const located = siteFrom(site);
  const o = located ? overrides.get(located.site) : undefined;
  const tt = min(1, max(0, o?.[0] ?? t));
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
  return makePoint3(p.x, p.y, p.z);
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
