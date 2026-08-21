import { makeBase, type Base } from "./identity.ts";
import type { Vec3 } from "./vec3.ts";

export type Point3 = Base & { kind: "point3"; x: number; y: number; z: number };
export type Line3 = Base & { kind: "line3"; a: Point3; b: Point3 };
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

export type Geom3 = Point3 | Line3 | Circle3 | Box3 | Cylinder3 | Mesh3;

export function point3(x: number, y: number, z: number): Point3 {
  return { ...makeBase("point3", "point3"), kind: "point3", x, y, z };
}

export function line3(a: Vec3, b: Vec3): Line3 {
  return {
    ...makeBase("line3", "line3"),
    kind: "line3",
    a: point3(a.x, a.y, a.z),
    b: point3(b.x, b.y, b.z),
  };
}

export function circle3(center: Vec3, radius: number, normal: Vec3): Circle3 {
  return {
    ...makeBase("circle3", "circle3"),
    kind: "circle3",
    center: point3(center.x, center.y, center.z),
    radius,
    normal,
  };
}

export function box3(min: Vec3, max: Vec3): Box3 {
  return {
    ...makeBase("box3", "box3"),
    kind: "box3",
    min: point3(min.x, min.y, min.z),
    max: point3(max.x, max.y, max.z),
  };
}

export function cylinder3(bottom: Vec3, top: Vec3, radius: number): Cylinder3 {
  return {
    ...makeBase("cylinder3", "cylinder3"),
    kind: "cylinder3",
    bottom: point3(bottom.x, bottom.y, bottom.z),
    top: point3(top.x, top.y, top.z),
    radius,
  };
}

export function mesh3(positions: number[], indices: number[]): Mesh3 {
  return {
    ...makeBase("mesh3", "mesh3"),
    kind: "mesh3",
    positions,
    indices,
  };
}
