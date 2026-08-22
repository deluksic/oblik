import { expect, test } from "vitest";

import {
  beginGeomFrame,
  circle,
  circleLineIntersection,
  collectDrawables,
  line,
  lineIntersection,
  offsetLine,
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
