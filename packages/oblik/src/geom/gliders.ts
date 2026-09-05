import { lineBasis } from "./ops";
import type { Circle, LineLike, Segment } from "./types";
import { add, dot, isFiniteVec, lerp, mul, norm, sub, type Vec2 } from "./vec";

const { abs, max, min } = Math;
export type GliderSegment = {
  kind: "gliderSegment";
  a: Vec2;
  b: Vec2;
  t: number;
  x: number;
  y: number;
};

export type GliderLine = {
  kind: "gliderLine";
  origin: Vec2;
  direction: Vec2;
  s: number;
  x: number;
  y: number;
};

export type GliderCircle = {
  kind: "gliderCircle";
  center: Vec2;
  radius: number;
  ux: number;
  uy: number;
  x: number;
  y: number;
};

export type Glider = GliderSegment | GliderLine | GliderCircle;

export function isGlider(v: { kind: string }): v is Glider {
  return v.kind === "gliderSegment" || v.kind === "gliderLine" || v.kind === "gliderCircle";
}

export function gliderAt(g: Glider): Vec2 {
  return { x: g.x, y: g.y };
}

export function clamp01(t: number): number {
  return min(1, max(0, t));
}

export function unit2(x: number, y: number): { ux: number; uy: number } {
  const n = norm({ x, y });
  return { ux: n.x, uy: n.y };
}

export function pointOnSegmentValue(seg: Segment, t: number): GliderSegment {
  const tt = clamp01(t);
  const p = lerp(seg.a, seg.b, tt);
  return { kind: "gliderSegment", a: seg.a, b: seg.b, t: tt, x: p.x, y: p.y };
}

export function pointOnLineValue(geom: LineLike, s: number): GliderLine {
  const { origin, dir } = lineBasis(geom);
  const p = add(origin, mul(dir, s));
  return { kind: "gliderLine", origin, direction: dir, s, x: p.x, y: p.y };
}

export function pointOnCircleValue(c: Circle, ux: number, uy: number): GliderCircle {
  const { ux: uu, uy: vv } = unit2(ux, uy);
  const p = add(c.center, mul({ x: uu, y: vv }, c.radius));
  return {
    kind: "gliderCircle",
    center: c.center,
    radius: c.radius,
    ux: uu,
    uy: vv,
    x: p.x,
    y: p.y,
  };
}

export function segmentTUnclamped(seg: Segment, p: Vec2): number {
  const ab = sub(seg.b, seg.a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return 0;
  return dot(sub(p, seg.a), ab) / l2;
}

export function segmentTAt(seg: Segment, p: Vec2): number {
  return clamp01(segmentTUnclamped(seg, p));
}

export function lineSAt(geom: LineLike, p: Vec2): number {
  const { origin, dir } = lineBasis(geom);
  return dot(sub(p, origin), dir);
}

export function circleUnitAt(c: Circle, p: Vec2): { ux: number; uy: number } {
  const v = sub(p, c.center);
  if (!isFiniteVec(v) || (abs(v.x) < 1e-12 && abs(v.y) < 1e-12)) {
    return { ux: 1, uy: 0 };
  }
  return unit2(v.x, v.y);
}
