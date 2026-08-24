import {
  makeBase,
  geomSiteFromOpts,
  geomEditableFromOpts,
  geomBindFromOpts,
  geomStyleFromOpts,
  type Base,
  type GeomSiteOpts,
} from "./identity";
import type { Vec3 } from "./vec3";

export type Point3 = Base & { kind: "point3"; x: number; y: number; z: number };
export type Segment3 = Base & { kind: "segment3"; a: Point3; b: Point3 };
export type Circle3 = Base & {
  kind: "circle3";
  center: Point3;
  radius: number;
  normal: Vec3;
};
export type Box3 = Base & { kind: "box3"; min: Point3; max: Point3 };
export type Cylinder3 = Base & {
  kind: "cylinder3";
  bottom: Point3;
  top: Point3;
  radius: number;
};
export type Mesh3 = Base & {
  kind: "mesh3";
  /** Packed xyz. */
  positions: number[];
  /** Triangle indices into `positions` (triples). */
  indices: number[];
};

export type Geom3 = Point3 | Segment3 | Circle3 | Box3 | Cylinder3 | Mesh3;

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

export function point3(x: number, y: number, z: number, site?: GeomSiteOpts): Point3 {
  return { ...siteBase("point3", "point3", site), kind: "point3", x, y, z };
}

export function segment3(a: Vec3, b: Vec3, site?: GeomSiteOpts): Segment3 {
  return {
    ...siteBase("segment3", "segment3", site),
    kind: "segment3",
    a: point3(a.x, a.y, a.z),
    b: point3(b.x, b.y, b.z),
  };
}

export function circle3(center: Vec3, radius: number, normal: Vec3, site?: GeomSiteOpts): Circle3 {
  return {
    ...siteBase("circle3", "circle3", site),
    kind: "circle3",
    center: point3(center.x, center.y, center.z),
    radius,
    normal,
  };
}

export function box3(min: Vec3, max: Vec3, site?: GeomSiteOpts): Box3 {
  return {
    ...siteBase("box3", "box3", site),
    kind: "box3",
    min: point3(min.x, min.y, min.z),
    max: point3(max.x, max.y, max.z),
  };
}

export function cylinder3(bottom: Vec3, top: Vec3, radius: number, site?: GeomSiteOpts): Cylinder3 {
  return {
    ...siteBase("cylinder3", "cylinder3", site),
    kind: "cylinder3",
    bottom: point3(bottom.x, bottom.y, bottom.z),
    top: point3(top.x, top.y, top.z),
    radius,
  };
}

export function mesh3(positions: number[], indices: number[], site?: GeomSiteOpts): Mesh3 {
  return {
    ...siteBase("mesh3", "mesh3", site),
    kind: "mesh3",
    positions,
    indices,
  };
}
