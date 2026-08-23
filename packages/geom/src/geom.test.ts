import { expect, test } from "vitest";

import {
  beginGeomFrame,
  circle,
  circleLineIntersection,
  collectDrawables,
  line,
  lineIntersection,
  offsetLine,
  perpendicularLine,
  point,
  signedDist,
} from "./index";

test("offsetLine returns { line, distance } and draws the parallel", () => {
  beginGeomFrame();
  const ground = line(point(0, 0), point(4, 0));
  const shelf = offsetLine(ground, 1.8);
  expect(shelf.distance).toBe(1.8);
  expect(shelf.line.kind).toBe("line");
  expect(shelf.line.origin.y).toBeCloseTo(1.8);
  const drawn = collectDrawables();
  expect(drawn.some((d) => d.geom.id === shelf.line.id)).toBe(true);
});

test("lineIntersection is NaN when parallel", () => {
  const a = line(point(0, 0), point(1, 0));
  const b = line(point(0, 1), point(1, 1));
  const p = lineIntersection(a, b);
  expect(Number.isFinite(p.x)).toBe(false);
  expect(Number.isFinite(p.y)).toBe(false);
  beginGeomFrame();
  collectDrawables(p);
  expect(collectDrawables(p)).toEqual([]);
});

test("lineIntersection of axes is the origin", () => {
  const h = line(point(-1, 0), point(1, 0));
  const v = line(point(0, -1), point(0, 1));
  const p = lineIntersection(h, v);
  expect(p.x).toBeCloseTo(0);
  expect(p.y).toBeCloseTo(0);
});

test("circleLineIntersection keeps the ± branch and NaNs on a miss", () => {
  const c = circle(point(0, 0), 1);
  const l = line(point(0, 0), point(1, 0));
  const plus = circleLineIntersection(c, l, +1);
  const minus = circleLineIntersection(c, l, -1);
  expect(plus.x).toBeCloseTo(1);
  expect(minus.x).toBeCloseTo(-1);
  const miss = circle(point(0, 0), 0.5);
  const far = line(point(0, 2), point(1, 2));
  const gone = circleLineIntersection(miss, far, +1);
  expect(Number.isFinite(gone.x)).toBe(false);
});

test("signedDist matches offsetLine", () => {
  const ground = line(point(0, 0), point(1, 0));
  const p = point(0, 1.8);
  expect(signedDist(p, ground)).toBeCloseTo(1.8);
  const shelf = offsetLine(ground, signedDist(p, ground));
  expect(shelf.line.origin.y).toBeCloseTo(1.8);
});

test("offsetLine mirror uses same literal on the opposite side", () => {
  beginGeomFrame();
  const ground = line(point(0, 0), point(4, 0));
  const forward = offsetLine(ground, 1.8);
  const mirrored = offsetLine(ground, 1.8, { mirror: true });
  expect(forward.line.origin.y).toBeCloseTo(1.8);
  expect(mirrored.line.origin.y).toBeCloseTo(-1.8);
  expect(mirrored.distance).toBe(1.8);
  expect(mirrored.line.offsetMirror).toBe(true);
});

test("perpendicularLine passes through point and is normal to carrier", () => {
  const ground = line(point(0, 0), point(4, 0));
  const p = point(2, 1);
  const perpLn = perpendicularLine(ground, p);
  expect(perpLn.kind).toBe("line");
  expect(Math.abs(perpLn.direction.x)).toBeLessThan(1e-9);
  expect(Math.abs(Math.abs(perpLn.direction.y) - 1)).toBeLessThan(1e-9);
  expect(Math.abs(signedDist(p, perpLn))).toBeLessThan(1e-9);
});
