import { expect, test } from "vitest";
import {
  beginWidgetFrame,
  editDistanceToPoint,
  editPoint,
  editVector,
  getGizmos,
  gizmoValues,
  publishWidgetOverrides,
  setWidgetOverride,
  withoutWidgets,
} from "./widgets.ts";

const pt = { id: "pt", at: [1, 1] as [number, number] };
const dist = { id: "dist", at: [4, 5] as [number, number] };

test("five looped distances share site and overlay", () => {
  beginWidgetFrame("loop");
  editPoint(0, 0, pt);
  for (let i = 0; i < 5; i++) {
    editDistanceToPoint({ x: i, y: 0 }, 0.4, dist);
  }
  const gizmos = getGizmos();
  const rings = gizmos.filter((g) => g.kind === "distance");
  expect(rings).toHaveLength(5);
  expect(rings.every((g) => g.site === "dist")).toBe(true);
  expect(rings.every((g) => g.kind === "distance" && g.d === 0.4)).toBe(true);

  setWidgetOverride("dist", [0.9], "loop");
  beginWidgetFrame("loop");
  editPoint(0, 0, pt);
  for (let i = 0; i < 5; i++) {
    editDistanceToPoint({ x: i, y: 0 }, 0.4, dist);
  }
  const after = getGizmos().filter((g) => g.kind === "distance");
  expect(after).toHaveLength(5);
  expect(after.every((g) => g.kind === "distance" && g.d === 0.9)).toBe(true);
  expect(gizmoValues(after[0]!)).toEqual([0.9]);
});

test("withoutWidgets reads producer overlay by uuid, not gizmos", () => {
  beginWidgetFrame("plate");
  editPoint(1, 2, pt);
  setWidgetOverride("pt", [9, 8], "plate");
  publishWidgetOverrides("plate");

  beginWidgetFrame("mill");
  const silent = withoutWidgets(() => editPoint(1, 2, pt), "plate");
  expect(silent.x).toBe(9);
  expect(silent.y).toBe(8);
  expect(getGizmos()).toHaveLength(0);
});

test("editVector overlay is dx, dy", () => {
  beginWidgetFrame("rel");
  const a = editPoint(-2.2, 0.15, pt);
  const d = editVector(a, 2.4, 1.05, { id: "vec", at: [2, 11] });
  expect(d.x).toBe(2.4);
  expect(d.y).toBe(1.05);
  setWidgetOverride("vec", [3, 4], "rel");
  beginWidgetFrame("rel");
  const a2 = editPoint(-2.2, 0.15, pt);
  const d2 = editVector(a2, 2.4, 1.05, { id: "vec", at: [2, 11] });
  expect(d2.x).toBe(3);
  expect(d2.y).toBe(4);
  const g = getGizmos().find((x) => x.kind === "vector");
  expect(g?.kind).toBe("vector");
  expect(gizmoValues(g!)).toEqual([3, 4]);
});
