import {
  circle,
  circleLineIntersection,
  dist,
  line,
  offsetLine,
  point,
  segment,
} from "@design-scenes/geom";

export const title = "Shelf";
export const view = "euclid2" as const;
export const sceneFile = "shelf.scene.ts";
export const hint =
  "Handles on A, B, lamp, shelf distance, and reach radius. Shrink reach until P vanishes; restore 2.5 and the same +1 root returns.";
export const camera = { x: 3, y: 1.5, scale: 52 };

export function scene() {
  const A = point(0, 0);
  const B = point(6, 0.4);
  const ground = line(A, B);
  const shelf = offsetLine(ground, 1.8);
  const reach = circle(A, 2.5);
  const P = circleLineIntersection(reach, shelf.line, +1);
  segment(A, P);
  const lamp = point(2.2, 3.1);
  const beam = circle(lamp, dist(lamp, P));
  const Q = circleLineIntersection(beam, ground, +1);
  line(P, Q);
  const cellar = offsetLine(ground, -shelf.distance);
  void cellar;
}
