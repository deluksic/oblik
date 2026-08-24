import { expect, test } from "vitest";

import {
  allocId,
  beginGeomFrame,
  makeBase,
  resetIdentity,
  withBind,
} from "./identity";
import { circle, collectDrawables, point, polyline, segment } from "./geom";

test("unlabeled ids are origin#k and rematch across frames", () => {
  beginGeomFrame();
  const a = makeBase("point", "point");
  const b = makeBase("point", "point");
  expect(a.id).toBe("point#0");
  expect(b.id).toBe("point#1");
  beginGeomFrame();
  expect(makeBase("point", "point").id).toBe("point#0");
  expect(makeBase("point", "point").id).toBe("point#1");
});

test("bind replaces occurrence in the pick id", () => {
  resetIdentity();
  expect(allocId("apps/paper/src/s.ts:4:5", "shelf")).toBe("apps/paper/src/s.ts:4:5#shelf");
  expect(allocId("apps/paper/src/s.ts:4:5", "shelf")).toBe("apps/paper/src/s.ts:4:5#shelf#1");
});

test("withBind labels nested constructors", () => {
  beginGeomFrame();
  const leaf = withBind("entrySwing", () => point(0, 0));
  expect(leaf.bind).toBe("entrySwing");
  expect(leaf.id).toBe("point#entrySwing");
});

test("annotated geom rematches by site without a bind", () => {
  const site = { __annotations__: { file: "f.ts", at: [3, 1] as [number, number], editable: true } };
  beginGeomFrame();
  const first = point(1, 2, site);
  beginGeomFrame();
  const second = point(1, 2, site);
  expect(first.id).toBe("f.ts:3:1#0");
  expect(second.id).toBe(first.id);
});

test("annotated constructors under withBind use site#bind", () => {
  const site = { __annotations__: { file: "f.ts", at: [20, 1] as [number, number], editable: true } };
  beginGeomFrame();
  const a = withBind("entrySwing", () => point(0, 0, site));
  const b = withBind("hallSwing", () => point(2, 0, site));
  expect(a.id).toBe("f.ts:20:1#entrySwing");
  expect(b.id).toBe("f.ts:20:1#hallSwing");
  expect(a.bind).toBe("entrySwing");
});

test("same bind at one site keeps extra instances drawable", () => {
  const site = { __annotations__: { file: "f.ts", at: [8, 1] as [number, number], editable: true } };
  beginGeomFrame();
  const parts = withBind("south", () => [
    polyline(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      site,
    ),
    polyline(
      [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      site,
    ),
  ]);
  expect(parts[0]!.id).toBe("f.ts:8:1#south");
  expect(parts[1]!.id).toBe("f.ts:8:1#south#1");
  expect(collectDrawables(parts)).toHaveLength(2);
});

test("a named constructor called twice keeps both outlines", () => {
  const site = { __annotations__: { file: "f.ts", at: [9, 1] as [number, number], editable: true } };
  const bottom = () => withBind("bottom", () => segment({ x: 0, y: 0 }, { x: 1, y: 0 }, site));
  beginGeomFrame();
  const a = bottom();
  const b = bottom();
  expect(a.id).toBe("f.ts:9:1#bottom");
  expect(b.id).toBe("f.ts:9:1#bottom#1");
  expect(collectDrawables([a, b])).toHaveLength(2);
});

test("two unlabeled circles at the same site keep distinct ids", () => {
  const site = { __annotations__: { file: "f.ts", at: [4, 5] as [number, number], editable: true } };
  beginGeomFrame();
  const a = circle({ x: 0, y: 0 }, 0.4, site);
  const b = circle({ x: 1, y: 0 }, 0.4, site);
  expect(a.id).toBe("f.ts:4:5#0");
  expect(b.id).toBe("f.ts:4:5#1");
});
