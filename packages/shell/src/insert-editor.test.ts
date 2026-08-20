import assert from "node:assert/strict";
import test from "node:test";
import {
  insertEditors,
  widgetBindingName,
  widgetInSceneFunction,
} from "./insert-editor.ts";

const hello = `import { circle } from "@design-scenes/geom";
import { editDistanceToPoint, editPoint } from "@design-scenes/euclid2";

export function scene() {
  const c = editPoint(0, 0);
  const r = editDistanceToPoint(c, 1);
  return circle(c, r);
}
`;

test("inserts editPoint after existing scene widgets", () => {
  const next = insertEditors(hello, [{ kind: "point", x: 1.25, y: -0.4 }]);
  assert.match(next, /const __scene = circle\(c, r\);/);
  assert.match(next, /const p = editPoint\(1\.25, -0\.4\);/);
  assert.match(next, /return __scene;/);
  assert.equal(widgetBindingName(hello, 0), "c");
  assert.equal(widgetInSceneFunction(hello, 0), true);
});

test("second insert stacks before return __scene", () => {
  const once = insertEditors(hello, [{ kind: "point", x: 1, y: 2 }]);
  const twice = insertEditors(once, [
    { kind: "distance", originName: "p", d: 0.5 },
  ]);
  assert.equal(
    (twice.match(/const __scene = /g) ?? []).length,
    1,
  );
  assert.match(twice, /const d = editDistanceToPoint\(p, 0\.5\);/);
});

test("rewrites return drawPlate so layout widgets still run first", () => {
  const plate = `import { drawPlate } from "../demo/plate.ts";
import { editPoint } from "@design-scenes/euclid2";

export function plateLayout() {
  const min = editPoint(-5, -3);
  return { min };
}

export function scene() {
  return drawPlate(plateLayout());
}
`;
  const next = insertEditors(plate, [{ kind: "point", x: 0, y: 1 }]);
  assert.match(next, /const __scene = drawPlate\(plateLayout\(\)\);/);
  assert.match(next, /const p = editPoint\(0, 1\);/);
  assert.equal(widgetInSceneFunction(plate, 0), false);
  assert.equal(widgetBindingName(plate, 0), "min");
});

test("point then distance in one write shares the new name", () => {
  const next = insertEditors(hello, [
    { kind: "point", x: 2, y: 1 },
    { kind: "distance", d: 0.75 },
  ]);
  assert.match(next, /const p = editPoint\(2, 1\);/);
  assert.match(next, /const d = editDistanceToPoint\(p, 0\.75\);/);
});

test("adds a named import when euclid2 is missing", () => {
  const src = `import { circle } from "@design-scenes/geom";

export function scene() {
  return circle({ x: 0, y: 0 }, 1);
}
`;
  const next = insertEditors(src, [{ kind: "point", x: 0, y: 0 }]);
  assert.match(
    next,
    /import \{ editPoint \} from "@design-scenes\/euclid2";/,
  );
});
