import { expect, test } from "vitest";

import {
  beginWidgetFrame,
  getGizmos,
  gizmosFromDrawables,
  gizmoValues,
  pointOnLine,
  publishWidgetOverrides,
  setWidgetOverride,
  slider,
  vector,
  withoutWidgets,
  angle,
} from "./widgets";
import { beginGeomFrame, circle, collectDrawables, line, offsetLine, point, withBind } from "@design-scenes/geom";

const F = "apps/paper/src/scenes/plate-layout.ts";
const pt = { __annotations__: { file: F, at: [1, 1] as [number, number], editable: true } };
const dist = { __annotations__: { file: F, at: [4, 5] as [number, number], editable: true } };

test("five looped distances share site and overlay", () => {
  beginGeomFrame();
  beginWidgetFrame("loop");
  point(0, 0, pt);
  for (let i = 0; i < 5; i++) {
    circle({ x: i, y: 0 }, 0.4, dist);
  }
  const gizmos = gizmosFromDrawables(collectDrawables());
  const rings = gizmos.filter((g) => g.kind === "distance");
  expect(rings).toHaveLength(5);
  expect(rings.every((g) => g.site === `${F}:4:5`)).toBe(true);
  expect(new Set(rings.map((g) => g.id)).size).toBe(5);
  expect(rings.map((g) => g.id)).toEqual([
    `${F}:4:5#0`,
    `${F}:4:5#1`,
    `${F}:4:5#2`,
    `${F}:4:5#3`,
    `${F}:4:5#4`,
  ]);
  expect(rings.every((g) => g.kind === "distance" && g.d === 0.4)).toBe(true);

  setWidgetOverride(`${F}:4:5`, [0.9], "loop");
  beginGeomFrame();
  beginWidgetFrame("loop");
  point(0, 0, pt);
  for (let i = 0; i < 5; i++) {
    circle({ x: i, y: 0 }, 0.4, dist);
  }
  const after = gizmosFromDrawables(collectDrawables()).filter((g) => g.kind === "distance");
  expect(after).toHaveLength(5);
  expect(after.every((g) => g.kind === "distance" && g.d === 0.9)).toBe(true);
  expect(gizmoValues(after[0]!)).toEqual([0.9]);
});

test("withoutWidgets reads producer overlay by file:L:C, not gizmos", () => {
  beginGeomFrame();
  beginWidgetFrame("plate");
  point(1, 2, pt);
  setWidgetOverride(`${F}:1:1`, [9, 8], "plate");
  publishWidgetOverrides("plate");

  beginGeomFrame();
  beginWidgetFrame("mill");
  const silent = withoutWidgets(() => point(1, 2, pt), "plate");
  expect(silent.x).toBe(9);
  expect(silent.y).toBe(8);
  expect(getGizmos()).toHaveLength(0);
  expect(gizmosFromDrawables(collectDrawables())).toHaveLength(0);
});

test("vector overlay is dx, dy", () => {
  const vec = { file: F, at: [2, 11] as [number, number] };
  beginGeomFrame();
  beginWidgetFrame("rel");
  const a = point(-2.2, 0.15, pt);
  const d = vector(a, 2.4, 1.05, vec);
  expect(d.x).toBe(2.4);
  expect(d.y).toBe(1.05);
  setWidgetOverride(`${F}:2:11`, [3, 4], "rel");
  beginGeomFrame();
  beginWidgetFrame("rel");
  const a2 = point(-2.2, 0.15, pt);
  const d2 = vector(a2, 2.4, 1.05, vec);
  expect(d2.x).toBe(3);
  expect(d2.y).toBe(4);
  const g = getGizmos().find((x) => x.kind === "vector");
  expect(g?.kind).toBe("vector");
  expect(gizmoValues(g!)).toEqual([3, 4]);
});

test("pointOnLine tracks origin + s * hat(dir)", () => {
  const lineSite = { file: F, at: [3, 3] as [number, number] };
  beginWidgetFrame("line");
  const p = pointOnLine({ x: 1, y: 2 }, { x: 3, y: 4 }, 0.5, lineSite);
  expect(p.x).toBeCloseTo(1 + 0.5 * (3 / 5));
  expect(p.y).toBeCloseTo(2 + 0.5 * (4 / 5));
  setWidgetOverride(`${F}:3:3`, [1.2], "line");
  beginWidgetFrame("line");
  const p2 = pointOnLine({ x: 1, y: 2 }, { x: 3, y: 4 }, 0.5, lineSite);
  expect(p2.x).toBeCloseTo(1 + 1.2 * (3 / 5));
  const g = getGizmos().find((x) => x.kind === "lineGlider");
  expect(g?.kind).toBe("lineGlider");
  expect(gizmoValues(g!)).toEqual([1.2]);
});

test("pointOnLine min clamps negative s", () => {
  const lineSite = { file: F, at: [4, 4] as [number, number] };
  beginWidgetFrame("line");
  setWidgetOverride(`${F}:4:4`, [-0.5], "line");
  beginWidgetFrame("line");
  const p = pointOnLine({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.3, {
    ...lineSite,
    min: 0,
  });
  expect(p.x).toBe(0);
  expect(p.y).toBe(0);
});

test("pointOnLine max clamps s", () => {
  const lineSite = { file: F, at: [5, 5] as [number, number] };
  beginWidgetFrame("line");
  setWidgetOverride(`${F}:5:5`, [2], "line");
  beginWidgetFrame("line");
  const p = pointOnLine({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.3, {
    ...lineSite,
    min: 0,
    max: 1,
  });
  expect(p.x).toBe(1);
});

test("annotated constructors spawn gizmos; dist() radius does not", () => {
  beginGeomFrame();
  beginWidgetFrame("ann");
  const A = point(0, 0, { __annotations__: { file: F, at: [1, 1], editable: true } });
  circle(A, 2.5, { __annotations__: { file: F, at: [2, 1], editable: true } });
  circle(A, 3, { __annotations__: { file: F, at: [3, 1], editable: false } });
  const gs = gizmosFromDrawables(collectDrawables());
  expect(gs.filter((g) => g.kind === "point")).toHaveLength(1);
  expect(gs.filter((g) => g.kind === "distance")).toHaveLength(1);
  expect(gs.find((g) => g.kind === "distance" && g.d === 2.5)).toBeTruthy();
});

test("live overrides move annotated constructors during drag", () => {
  setWidgetOverride(`${F}:1:1`, [4, 5], "live");
  setWidgetOverride(`${F}:2:1`, [3.1], "live");
  beginGeomFrame();
  beginWidgetFrame("live");
  const A = point(0, 0, { __annotations__: { file: F, at: [1, 1], editable: true } });
  const reach = circle(A, 2.5, { __annotations__: { file: F, at: [2, 1], editable: true } });
  expect(A.x).toBe(4);
  expect(A.y).toBe(5);
  expect(reach.radius).toBe(3.1);
  expect(reach.center.x).toBe(4);
});

test("slider HUD uses label, min, max, step", () => {
  beginWidgetFrame("sl");
  slider(1.8, {
    label: "reach",
    min: 0,
    max: 4,
    step: 0.1,
    __annotations__: { file: F, at: [9, 1], editable: true },
  });
  const g = getGizmos().find((x) => x.kind === "number");
  expect(g?.kind).toBe("number");
  if (g?.kind !== "number") return;
  expect(g.label).toBe("reach");
  expect(g.min).toBe(0);
  expect(g.max).toBe(4);
  expect(g.n).toBe(1.8);
});

test("angle degrees are relative to from; return is world radians", () => {
  beginWidgetFrame("ang");
  const site = { __annotations__: { file: F, at: [11, 1] as [number, number], editable: true } };
  const world = angle({ x: 0, y: 0 }, -59, { from: Math.PI / 2, radius: 1, ...site });
  expect(world).toBeCloseTo((31 * Math.PI) / 180, 6);
  const g = getGizmos().find((x) => x.kind === "angle");
  expect(g?.kind).toBe("angle");
  if (g?.kind !== "angle") return;
  expect(g.deg).toBe(-59);
  expect(g.from).toBeCloseTo(Math.PI / 2);
});

test("angle mirror reflects world direction; same deg, opposite swing", () => {
  beginWidgetFrame("mir");
  const site = { __annotations__: { file: F, at: [12, 1] as [number, number], editable: true } };
  const from = Math.PI / 2;
  const forward = angle({ x: 0, y: 0 }, 69, { from, radius: 1, ...site });
  const mirrored = angle({ x: 0, y: 0 }, 69, { from, radius: 1, mirror: true, ...site });
  expect(forward).toBeCloseTo((159 * Math.PI) / 180, 6);
  expect(mirrored).toBeCloseTo((21 * Math.PI) / 180, 6);
  expect(forward + mirrored).toBeCloseTo(Math.PI, 6);
});

test("offset mirror gizmo keeps stored literal, line on opposite side", () => {
  const off = { __annotations__: { file: F, at: [8, 1] as [number, number], editable: true } };
  beginGeomFrame();
  beginWidgetFrame("off");
  const ground = line(point(0, 0), point(4, 0));
  const shelf = offsetLine(ground, 1.8, off);
  const cellar = offsetLine(ground, 1.8, { ...off, mirror: true });
  expect(shelf.line.origin.y).toBeCloseTo(1.8);
  expect(cellar.line.origin.y).toBeCloseTo(-1.8);
  const gizmos = gizmosFromDrawables(collectDrawables());
  const offsets = gizmos.filter((g) => g.kind === "offset");
  expect(offsets).toHaveLength(2);
  expect(offsets.every((g) => g.kind === "offset" && g.d === 1.8)).toBe(true);
  const mirrored = offsets.find((g) => g.kind === "offset" && g.mirror);
  expect(mirrored?.kind).toBe("offset");
});

test("paired offset shares site; overlay moves both sides together", () => {
  const off = { __annotations__: { file: F, at: [8, 1] as [number, number], editable: true } };
  beginGeomFrame();
  beginWidgetFrame("pair");
  const ground = line(point(0, 0), point(4, 0));
  offsetLine(ground, 1.8, off);
  offsetLine(ground, 1.8, { ...off, mirror: true });
  setWidgetOverride(`${F}:8:1`, [2.2], "pair");
  beginGeomFrame();
  beginWidgetFrame("pair");
  const shelf = offsetLine(ground, 1.8, off);
  const cellar = offsetLine(ground, 1.8, { ...off, mirror: true });
  expect(shelf.line.origin.y).toBeCloseTo(2.2);
  expect(cellar.line.origin.y).toBeCloseTo(-2.2);
});

test("nested angle helpers keep distinct caller frames", () => {
  const site = { __annotations__: { file: F, at: [20, 1] as [number, number], editable: true } };
  function doorOpen(hinge: { x: number; y: number }) {
    return angle(hinge, 60, { radius: 1, ...site });
  }
  function floorPlanLayout() {
    doorOpen({ x: 0, y: 0 });
    doorOpen({ x: 2, y: 0 });
  }
  beginWidgetFrame("doors");
  floorPlanLayout();
  const gs = getGizmos().filter((g) => g.kind === "angle");
  expect(gs).toHaveLength(2);
  expect(gs[0]!.site).toBe(gs[1]!.site);
  expect(gs[0]!.id).toBe(`${gs[0]!.site}#0`);
  expect(gs[1]!.id).toBe(`${gs[1]!.site}#1`);
  const names = (g: (typeof gs)[0]) => (g.stack ?? []).map((f) => f.name);
  expect(names(gs[0]!)).toContain("doorOpen");
  expect(names(gs[0]!)).toContain("floorPlanLayout");
  const caller = (g: (typeof gs)[0]) => g.stack?.find((f) => f.name === "floorPlanLayout");
  expect(caller(gs[0]!)?.line).not.toBe(caller(gs[1]!)?.line);
});

test("withBind labels nested angles at a shared site", () => {
  const site = { __annotations__: { file: F, at: [20, 1] as [number, number], editable: true } };
  function doorOpen(hinge: { x: number; y: number }) {
    return angle(hinge, 60, { radius: 1, ...site });
  }
  beginWidgetFrame("doors");
  withBind("entrySwing", () => doorOpen({ x: 0, y: 0 }));
  withBind("hallSwing", () => doorOpen({ x: 2, y: 0 }));
  const gs = getGizmos().filter((g) => g.kind === "angle");
  expect(gs).toHaveLength(2);
  expect(gs[0]!.site).toBe(gs[1]!.site);
  expect(gs[0]!.id).toBe(`${gs[0]!.site}#entrySwing`);
  expect(gs[1]!.id).toBe(`${gs[1]!.site}#hallSwing`);
  expect(gs[0]!.bind).toBe("entrySwing");
  expect(gs[1]!.bind).toBe("hallSwing");
});

test("shared-site gizmos keep stable instance ids across re-evaluate", () => {
  const site = { __annotations__: { file: F, at: [20, 1] as [number, number], editable: true } };
  const layout = () => {
    angle({ x: 0, y: 0 }, 60, { radius: 1, ...site });
    angle({ x: 2, y: 0 }, 60, { radius: 1, ...site });
  };
  beginWidgetFrame("doors");
  layout();
  const first = getGizmos().filter((g) => g.kind === "angle");
  beginWidgetFrame("doors");
  layout();
  const second = getGizmos().filter((g) => g.kind === "angle");
  expect(second.map((g) => g.id)).toEqual(first.map((g) => g.id));
  const pick = second[1]!;
  expect(second.find((g) => g.id === pick.id)).toBe(pick);
  expect(second.find((g) => g.site === pick.site)).toBe(second[0]);
});
