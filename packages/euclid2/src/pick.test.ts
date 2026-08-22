import { expect, test } from "vitest";

import { beginGeomFrame, collectDrawables, point } from "@design-scenes/geom";

import { hitTest } from "./pick";
import type { Gizmo } from "./widgets";

const cam = { x: 0, y: 0, scale: 50 };
const W = 200;
const H = 200;
const at = { file: "f.ts", line: 1, column: 1 };

function offsetThroughOrigin(): Gizmo {
  return {
    kind: "offset",
    site: "f.ts:1:1",
    at,
    origin: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    d: 1.8,
  };
}

test("geom point wins over an offset line through it", () => {
  beginGeomFrame();
  const p = point(0, 0);
  const hit = hitTest({ x: 100, y: 100 }, cam, W, H, [offsetThroughOrigin()], collectDrawables());
  expect(hit).toEqual({ target: "geom", drawable: { geom: p } });
});

test("point gizmo wins over an offset gizmo at the same place", () => {
  const pt: Gizmo = { kind: "point", site: "f.ts:2:1", at, x: 0, y: 0 };
  const hit = hitTest({ x: 100, y: 100 }, cam, W, H, [offsetThroughOrigin(), pt], []);
  expect(hit?.target).toBe("gizmo");
  if (hit?.target === "gizmo") expect(hit.gizmo).toEqual(pt);
});

test("offset still hits when the pointer is away from the point", () => {
  beginGeomFrame();
  point(0, 0);
  const off = offsetThroughOrigin();
  const hit = hitTest({ x: 160, y: 100 }, cam, W, H, [off], collectDrawables());
  expect(hit).toEqual({ target: "gizmo", gizmo: off });
});
