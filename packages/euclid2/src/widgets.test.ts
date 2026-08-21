import { expect, test } from "vitest";

import {
  beginWidgetFrame,
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
  editVector,
  getGizmos,
  gizmoValues,
  publishWidgetOverrides,
  setWidgetOverride,
  withoutWidgets,
} from "./widgets.ts";

const F = "apps/paper/src/scenes/plate-layout.ts";
const pt = { file: F, at: [1, 1] as [number, number] };
const dist = { file: F, at: [4, 5] as [number, number] };

test("five looped distances share site and overlay", () => {
  beginWidgetFrame("loop");
  editPoint(0, 0, pt);
  for (let i = 0; i < 5; i++) {
    editDistanceToPoint({ x: i, y: 0 }, 0.4, dist);
  }
  const gizmos = getGizmos();
  const rings = gizmos.filter((g) => g.kind === "distance");
  expect(rings).toHaveLength(5);
  expect(rings.every((g) => g.site === `${F}:4:5`)).toBe(true);
  expect(rings.every((g) => g.kind === "distance" && g.d === 0.4)).toBe(true);

  setWidgetOverride(`${F}:4:5`, [0.9], "loop");
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

test("withoutWidgets reads producer overlay by file:L:C, not gizmos", () => {
  beginWidgetFrame("plate");
  editPoint(1, 2, pt);
  setWidgetOverride(`${F}:1:1`, [9, 8], "plate");
  publishWidgetOverrides("plate");

  beginWidgetFrame("mill");
  const silent = withoutWidgets(() => editPoint(1, 2, pt), "plate");
  expect(silent.x).toBe(9);
  expect(silent.y).toBe(8);
  expect(getGizmos()).toHaveLength(0);
});

test("editVector overlay is dx, dy", () => {
  const vec = { file: F, at: [2, 11] as [number, number] };
  beginWidgetFrame("rel");
  const a = editPoint(-2.2, 0.15, pt);
  const d = editVector(a, 2.4, 1.05, vec);
  expect(d.x).toBe(2.4);
  expect(d.y).toBe(1.05);
  setWidgetOverride(`${F}:2:11`, [3, 4], "rel");
  beginWidgetFrame("rel");
  const a2 = editPoint(-2.2, 0.15, pt);
  const d2 = editVector(a2, 2.4, 1.05, vec);
  expect(d2.x).toBe(3);
  expect(d2.y).toBe(4);
  const g = getGizmos().find((x) => x.kind === "vector");
  expect(g?.kind).toBe("vector");
  expect(gizmoValues(g!)).toEqual([3, 4]);
});

test("editPointOnLine tracks origin + s * hat(dir)", () => {
  const lineSite = { file: F, at: [3, 3] as [number, number] };
  beginWidgetFrame("line");
  const p = editPointOnLine({ x: 1, y: 2 }, { x: 3, y: 4 }, 0.5, lineSite);
  expect(p.x).toBeCloseTo(1 + 0.5 * (3 / 5));
  expect(p.y).toBeCloseTo(2 + 0.5 * (4 / 5));
  setWidgetOverride(`${F}:3:3`, [1.2], "line");
  beginWidgetFrame("line");
  const p2 = editPointOnLine({ x: 1, y: 2 }, { x: 3, y: 4 }, 0.5, lineSite);
  expect(p2.x).toBeCloseTo(1 + 1.2 * (3 / 5));
  const g = getGizmos().find((x) => x.kind === "lineGlider");
  expect(g?.kind).toBe("lineGlider");
  expect(gizmoValues(g!)).toEqual([1.2]);
});

test("editPointOnLine min clamps negative s", () => {
  const lineSite = { file: F, at: [4, 4] as [number, number] };
  beginWidgetFrame("line");
  setWidgetOverride(`${F}:4:4`, [-0.5], "line");
  beginWidgetFrame("line");
  const p = editPointOnLine({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.3, {
    ...lineSite,
    min: 0,
  });
  expect(p.x).toBe(0);
  expect(p.y).toBe(0);
});

test("editPointOnLine max clamps s", () => {
  const lineSite = { file: F, at: [5, 5] as [number, number] };
  beginWidgetFrame("line");
  setWidgetOverride(`${F}:5:5`, [2], "line");
  beginWidgetFrame("line");
  const p = editPointOnLine({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.3, {
    ...lineSite,
    min: 0,
    max: 1,
  });
  expect(p.x).toBe(1);
});
