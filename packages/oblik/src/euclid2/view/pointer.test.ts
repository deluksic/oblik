import { describe, expect, test } from "vitest";

import type { TraceNode } from "@/eval/context";
import type { Region, Segment } from "@/geom";
import { wrapCsg, offsetValue } from "@/geom/csg2";
import { regionValue } from "@/geom/region";

import { applyDrag, offsetDrag, parallelDrag, panDrag, radiusDrag, round } from "./pointer";

const camera = { x: 0, y: 0, scale: 48 };
const size = { w: 800, h: 600 };

const CIRCLE = {
  id: "o_r",
  occ: 0,
  kind: "circle",
  value: { kind: "circle", center: { x: 0, y: 0 }, radius: 2.5 },
  editable: true,
  stack: [],
} as TraceNode;

const OFFSET = {
  id: "o_par",
  occ: 0,
  kind: "parallelLine",
  value: {
    kind: "parallelLine",
    line: { kind: "line", origin: { x: 0, y: 1.76 }, direction: { x: 1, y: 0 } },
    distance: 1.76,
  },
  editable: true,
  stack: [],
} as TraceNode;

function squareProfile(): Region {
  const pts = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const cycle: unknown[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    cycle.push(a, { kind: "segment", a, b } satisfies Segment);
  }
  return regionValue(cycle, []);
}

const OFFSET_REGION = {
  id: "o_off",
  occ: 0,
  kind: "csg2",
  value: wrapCsg(offsetValue(squareProfile(), -0.2)),
  editable: true,
  stack: [],
} as TraceNode;

describe("round", () => {
  test("keeps two decimals", () => {
    expect(round(2.556)).toBe(2.56);
  });
});

describe("applyDrag", () => {
  test("pans by pointer delta in world units", () => {
    const e0 = { clientX: 100, clientY: 100 } as PointerEvent;
    const drag = panDrag(e0, camera);
    drag.moved = true;
    const next = applyDrag(
      drag,
      { clientX: 148, clientY: 100 } as PointerEvent,
      null,
      camera,
      size,
    );
    expect(next.camera?.x).toBe(-1);
    expect(next.camera?.y).toBe(0);
  });

  test("records the grab distance from the circle center", () => {
    const drag = radiusDrag(CIRCLE, { x: 2.5, y: 0 }, { clientX: 0, clientY: 0 } as PointerEvent);
    expect(drag.kind).toBe("radius");
    if (drag.kind !== "radius") return;
    expect(drag.grabDist).toBe(2.5);
    expect(drag.startR).toBe(2.5);
  });

  test("offsets by signed distance along the carrier normal", () => {
    const el = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLDivElement;
    const down = { clientX: 400, clientY: 300 - 1.76 * 48 } as PointerEvent;
    const drag = parallelDrag(OFFSET, { x: 0, y: 1.76 }, down);
    expect(drag.kind).toBe("parallel");
    if (drag.kind !== "parallel") return;
    expect(drag.grabSigned).toBeCloseTo(1.76);
    drag.moved = true;
    const same = applyDrag(drag, down, el, camera, size);
    expect(same.draft?.values[0]).toBeCloseTo(1.76);
    const pulled = applyDrag(
      drag,
      { clientX: 400, clientY: 300 - 2.5 * 48 } as PointerEvent,
      el,
      camera,
      size,
    );
    expect(pulled.draft?.values[0]).toBeCloseTo(2.5);
  });

  test("records the grab sdf of the un-offset operand", () => {
    const drag = offsetDrag(OFFSET_REGION, { x: 0.5, y: 0.2 }, {
      clientX: 0,
      clientY: 0,
    } as PointerEvent);
    expect(drag?.kind).toBe("offset");
    if (drag?.kind !== "offset") return;
    expect(drag.grabSdf).toBeCloseTo(-0.2);
    expect(drag.startD).toBe(-0.2);
  });

  test("dragging along the source sdf updates the offset distance", () => {
    const el = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLDivElement;
    const down = { clientX: 400 + 0.5 * 48, clientY: 300 - 0.2 * 48 } as PointerEvent;
    const drag = offsetDrag(OFFSET_REGION, { x: 0.5, y: 0.2 }, down);
    expect(drag?.kind).toBe("offset");
    if (!drag) return;
    drag.moved = true;
    const same = applyDrag(drag, down, el, camera, size);
    expect(same.draft?.values[0]).toBeCloseTo(-0.2);
    const pulled = applyDrag(
      drag,
      { clientX: 400 + 0.5 * 48, clientY: 300 - 0.3 * 48 } as PointerEvent,
      el,
      camera,
      size,
    );
    expect(pulled.draft?.values[0]).toBeCloseTo(-0.3);
  });
});
