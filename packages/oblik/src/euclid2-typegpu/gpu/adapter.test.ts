import { describe, expect, test } from "vitest";

import type { TraceNode } from "#eval/context";
import type { Vec2 } from "#geom";

import { createAdapter, type AdapterInput, type Rgb } from "./adapter";

/**
 * The adapter is pure CPU (no device), so the routing between the compiled-field
 * pass and the span pass, the band order of the draws, and the byte-diffs that
 * keep a drag from re-uploading are all testable here.
 */

const COLORS = {
  ink: [0, 0, 0] as Rgb,
  accent: [0, 0, 1] as Rgb,
  selectedPaint: [1, 1, 1] as Rgb,
  ring: [0.5, 0.5, 0.5] as Rgb,
  paper: [1, 1, 1] as Rgb,
  ghost: [0, 0, 0] as Rgb,
};

const CAM = { x: 0, y: 0, scale: 48 };
const SIZE = { w: 800, h: 600 };

function input(trace: TraceNode[], over: Partial<AdapterInput> = {}): AdapterInput {
  return {
    trace,
    cam: CAM,
    size: SIZE,
    colors: COLORS,
    strokePx: 1.5,
    hoverId: undefined,
    selectedKey: undefined,
    showHalos: true,
    hideFills: false,
    muted: () => false,
    ghost: undefined,
    place: undefined,
    placing: false,
    hideSnap: false,
    ...over,
  };
}

/** Square region loop (unit square centred on the origin), as a region value. */
function squareRegion(half = 1) {
  const corners: Vec2[] = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
  const outer = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    return { a, b, carrier: { kind: "segment" as const, a, b } };
  });
  return { kind: "region" as const, outer, holes: [] };
}

/** Triangle polygon — not a `CsgOperand`, so it stays on the span pass. */
function polygonValue() {
  const boundary: Vec2[] = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 0, y: 1 },
  ];
  return { kind: "polygon" as const, boundary, holes: [] };
}

function node(id: string, value: unknown, bind?: string): TraceNode {
  return { id, occ: 0, kind: "region", value, bind, editable: false, stack: [] } as TraceNode;
}

/** `diff(circle, region)` — a tree the field compiler takes. */
function csgNode(id: string, cx = 0, bind?: string): TraceNode {
  return node(
    id,
    {
      kind: "csg2",
      op: "diff",
      of: [{ kind: "circle", center: { x: cx, y: 0 }, radius: 2 }, squareRegion(0.5)],
    },
    bind,
  );
}

describe("adapter fill routing", () => {
  test("csg2 and region nodes compile; a polygon keeps the span pass", () => {
    const trace = [csgNode("o_csg", 0, "pac"), node("o_poly", polygonValue(), "shell")];
    const patch = createAdapter().tick(input(trace));

    expect(patch.fillDraws.map((d) => d.path)).toEqual(["field", "spans"]);
    const [field, spans] = patch.fillDraws;
    expect(field?.path === "field" && field.plan.shape).toBe("diff(circle,region)");
    expect(spans).toEqual({ path: "spans", first: 0, count: 1 });

    // One quad, two leaves (circle + region spans), four span edges.
    expect(patch.fields.quads.count).toBe(1);
    expect(patch.fields.quads.writes).toHaveLength(1);
    expect(patch.fields.leaves.writes).toHaveLength(2);
    expect(patch.fields.edges.writes).toHaveLength(4);
    const quad = patch.fields.quads.writes[0]!.value;
    expect(quad.leafBase).toBe(0);
    expect(quad.alpha).toBeCloseTo(0.16);
    expect([quad.color.x, quad.color.y, quad.color.z]).toEqual([0, 0, 0]);
    // The quad is the tree's AABB (the circle), padded and clipped to the pane.
    expect(quad.aabbMin.x).toBeCloseTo(-2 - 2 / CAM.scale, 6);
    expect(quad.aabbMax.x).toBeCloseTo(2 + 2 / CAM.scale, 6);

    // The polygon still lands in the span buffers.
    expect(patch.fills.count).toBe(1);
    expect(patch.fillEdges.writes).toHaveLength(3);
  });

  test("a region node compiles as a single spans leaf", () => {
    const patch = createAdapter().tick(input([node("o_reg", squareRegion(1), "plate")]));
    expect(patch.fillDraws).toHaveLength(1);
    const draw = patch.fillDraws[0]!;
    expect(draw.path === "field" && draw.plan.shape).toBe("region");
    expect(patch.fields.leaves.writes).toHaveLength(1);
    expect(patch.fields.edges.writes).toHaveLength(4);
  });

  test("an unchanged tick re-uploads nothing but still draws", () => {
    const adapter = createAdapter();
    const trace = [csgNode("o_csg", 0, "pac")];
    adapter.tick(input(trace));
    const patch = adapter.tick(input(trace));

    expect(patch.fields.quads.writes).toHaveLength(0);
    expect(patch.fields.leaves.writes).toHaveLength(0);
    expect(patch.fields.edges.writes).toHaveLength(0);
    expect(patch.fillDraws).toHaveLength(1);
  });

  test("dragging a leaf rewrites data; hover only recolors", () => {
    const adapter = createAdapter();
    // Eval keeps node identity across draft ticks (`#eval/reuse-trace`), which is
    // what makes the identity-keyed pools and byte diffs effective.
    const dragged = node("o_csg", {
      kind: "csg2",
      op: "diff",
      of: [{ kind: "circle", center: { x: 0, y: 0 }, radius: 2 }, squareRegion(0.5)],
    });
    adapter.tick(input([dragged]));
    (dragged.value as { of: { radius?: number }[] }).of[0]!.radius = 2.5;
    const moved = adapter.tick(input([dragged]));
    // Same shape, new numbers: leaves and the AABB move, the spans do not.
    expect(moved.fields.quads.writes).toHaveLength(1);
    expect(moved.fields.leaves.writes).toHaveLength(2);
    expect(moved.fields.edges.writes).toHaveLength(0);
    const draw = moved.fillDraws[0]!;
    expect(draw.path === "field" && draw.plan.shape).toBe("diff(circle,region)");

    const hovered = adapter.tick(input([dragged], { hoverId: "o_csg" }));
    expect(hovered.fields.quads.writes).toHaveLength(1);
    const hoverColor = hovered.fields.quads.writes[0]!.value.color;
    expect([hoverColor.x, hoverColor.y, hoverColor.z]).toEqual([...COLORS.selectedPaint]);
    expect(hovered.fields.quads.writes[0]!.value.alpha).toBeCloseTo(0.28);
    // Chrome is data too: no leaf or span traffic for a hover.
    expect(hovered.fields.leaves.writes).toHaveLength(0);
    expect(hovered.fields.edges.writes).toHaveLength(0);
  });

  test("a fresh node identity re-uploads its field", () => {
    const adapter = createAdapter();
    adapter.tick(input([csgNode("o_csg")]));
    const again = adapter.tick(input([csgNode("o_csg")]));
    expect(again.fields.quads.writes).toHaveLength(1);
    expect(again.fields.leaves.writes).toHaveLength(2);
  });

  test("an off-screen field is culled; hideFills drops every draw", () => {
    const far = createAdapter().tick(
      input([node("o_far", { kind: "circle", center: { x: 40, y: 0 }, radius: 2 })]),
    );
    expect(far.fillDraws).toHaveLength(0);

    const hidden = createAdapter().tick(input([csgNode("o_csg", 0)], { hideFills: true }));
    expect(hidden.fillDraws).toHaveLength(0);
    expect(hidden.fields.quads.writes).toHaveLength(0);
  });

  test("a pick node keeps the span pass (island-restricted, not a scalar field)", () => {
    const pick = node("o_pick", {
      kind: "pick",
      of: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
      at: { x: 0, y: 0 },
    });
    const patch = createAdapter().tick(input([pick]));
    expect(patch.fillDraws.map((d) => d.path)).toEqual(["spans"]);
    expect(patch.fields.quads.writes).toHaveLength(0);
  });
});
