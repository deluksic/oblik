import {
  arg,
  circle,
  csg2,
  defineTool,
  diff,
  point,
  pointOnSegmentValue,
  region,
  regionValue,
  segment,
  union,
} from "oblik";
import type { Region, Segment, Vec2 } from "oblik";

const { cos, PI, sin } = Math;

/**
 * Practice tools for P10 (user tools). Plain exported functions the scene can
 * also call directly; `defineTool` registers them in the Space palette. Each
 * tool fn body is stamped with constructor ids on load, so a draft call can be
 * evaluated for the ghost.
 */

export function rect(origin: Vec2, w: number, h: number) {
  const p1 = { x: origin.x + w, y: origin.y };
  const p2 = { x: origin.x + w, y: origin.y + h };
  const p3 = { x: origin.x, y: origin.y + h };
  const bottom = segment(origin, p1, "o_58603110cc");
  const right = segment(p1, p2, "o_72bf38381d");
  const top = segment(p2, p3, "o_e1be3693bc");
  const left = segment(p3, origin, "o_158ed457af");
  const face = region([origin, bottom, p1, right, p2, top, p3, left], [], "o_2ae357b50c");
  return { face };
}
export const rectTool = defineTool(rect, {
  title: "Rect",
  hint: "A corner, then width and height.",
  prefix: "rec",
  args: [arg.point("origin"), arg.number("w"), arg.number("h")],
});

export function boltCircle(center: Vec2, r: number, n: number) {
  const holes = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * PI;
    holes.push(
      circle({ x: center.x + r * cos(a), y: center.y + r * sin(a) }, 0.5, "o_ce3b710b58"),
    );
  }
  return { holes };
}
export const boltCircleTool = defineTool(boltCircle, {
  title: "Bolt circle",
  hint: "n holes evenly spaced around a center.",
  prefix: "bc",
  args: [arg.point("center"), arg.length("r", { anchor: "center" }), arg.number("n", { def: 6 })],
});

export function ring(center: Vec2, r: number, thickness: number) {
  const outer = circle(center, r, "o_1576d0572a");
  const inner = circle(center, r - thickness, "o_6fdaad2b4d");
  return { outer, inner };
}
export const ringTool = defineTool(ring, {
  title: "Ring",
  hint: "Two concentric circles; the inner clears by thickness.",
  prefix: "rng",
  args: [arg.point("center"), arg.length("r", { anchor: "center" }), arg.length("t", { def: 0.5 })],
});

export function keyhole(face: Region, at: Vec2, r: number) {
  const hole = circle(at, r, "o_feeaf66171");
  const half = r * 0.6;
  const a = { x: at.x + 0.5 * r, y: at.y - half };
  const b = { x: at.x + 3 * r, y: at.y - half };
  const c = { x: at.x + 3 * r, y: at.y + half };
  const d = { x: at.x + 0.5 * r, y: at.y + half };
  const topEdge = segment(a, b, "o_2faf11c1f6");
  const rightEdge = segment(b, c, "o_373a5f45d3");
  const bottomEdge = segment(c, d, "o_45fb4c7408");
  const leftEdge = segment(d, a, "o_66d3ec0329");
  const slot = regionValue([a, topEdge, b, rightEdge, c, bottomEdge, d, leftEdge], []);
  return { face: csg2(diff(face, [union([hole, slot])]), "o_57ac73129c") };
}

export const keyholeTool = defineTool(keyhole, {
  title: "Keyhole",
  hint: "Cut a hole and slot out of a face.",
  prefix: "kh",
  args: [arg.region("face"), arg.point("at"), arg.length("r", { anchor: "at" })],
});

export function bisect(seg: Segment) {
  const mid = pointOnSegmentValue(seg, 0.5);
  return { mid: point(mid.x, mid.y, "o_49156ff634") };
}

export const bisectTool = defineTool(bisect, {
  title: "Bisect",
  hint: "The midpoint of a segment.",
  prefix: "bi",
  args: [arg.segment("seg")],
});
