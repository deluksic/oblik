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

function node(id: string, value: unknown, bind?: string, editable = false): TraceNode {
  return { id, occ: 0, kind: "region", value, bind, editable, stack: [] } as TraceNode;
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

    expect(patch.fillDraws.map((d) => `${d.path}:${d.layer}`)).toEqual([
      "field:paint",
      "spans:paint",
    ]);
    const [field, spans] = patch.fillDraws;
    expect(field?.path === "field" && field.plan.shape).toBe("diff(circle,region)");
    expect(spans).toEqual({ path: "spans", layer: "paint", first: 0, count: 1 });

    // One quad, two leaves (circle + region spans), four straight spans — and
    // no arc record at all: the split keeps the segment array branch-free.
    expect(patch.fields.quads.count).toBe(1);
    expect(patch.fields.quads.writes).toHaveLength(1);
    expect(patch.fields.leaves.writes).toHaveLength(2);
    expect(patch.fields.segs.writes).toHaveLength(4);
    expect(patch.fields.arcs.writes).toHaveLength(0);
    const quad = patch.fields.quads.writes[0]!.value;
    expect(quad.leafBase).toBe(0);
    expect(quad.alpha).toBeCloseTo(0.16);
    expect([quad.color.x, quad.color.y, quad.color.z]).toEqual([0, 0, 0]);
    // The quad is the tree's AABB (the circle), padded and clipped to the pane.
    expect(quad.aabbMin.x).toBeCloseTo(-2 - 2 / CAM.scale, 6);
    expect(quad.aabbMax.x).toBeCloseTo(2 + 2 / CAM.scale, 6);

    // The polygon still lands in the span buffers.
    expect(patch.fills.count).toBe(1);
    expect(patch.fillSegs.writes).toHaveLength(3);
    expect(patch.fillArcs.writes).toHaveLength(0);
  });

  test("a region node compiles as a single spans leaf", () => {
    const patch = createAdapter().tick(input([node("o_reg", squareRegion(1), "plate")]));
    expect(patch.fillDraws).toHaveLength(1);
    const draw = patch.fillDraws[0]!;
    expect(draw.path === "field" && draw.plan.shape).toBe("region");
    expect(patch.fields.leaves.writes).toHaveLength(1);
    expect(patch.fields.segs.writes).toHaveLength(4);
  });

  test("arc carriers get their own records and their own window", () => {
    // Outer loop is a full circle carrier (one arc), the hole is a square walk
    // (four segments): one region, two windows, two independently packed arrays.
    const ring = (id: string) =>
      node(
        id,
        {
          kind: "region",
          outer: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
          holes: [squareRegion(1).outer],
        },
        "ring",
      );
    const patch = createAdapter().tick(input([ring("o_a"), ring("o_b")]));
    const [first, second] = patch.fields.leaves.writes.map((w) => w.value);
    expect(first!.arcCount).toBe(1);
    expect(first!.segCount).toBe(4);
    expect(first!.segOffset).toBe(0);
    expect(first!.arcOffset).toBe(0);
    // The second node's windows move in each array by that array's own count.
    expect(second!.segOffset).toBe(4);
    expect(second!.arcOffset).toBe(1);
    expect(patch.fields.arcs.writes.map((w) => w.idx)).toEqual([0, 1]);
    expect(patch.fields.segs.writes.map((w) => w.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // The arc record carries the carrier; the hole's spans carry none.
    const arc = patch.fields.arcs.writes[0]!.value;
    expect(arc.radius).toBeCloseTo(2, 6);
    expect(Math.abs(arc.span)).toBeCloseTo(Math.PI * 2, 6);
  });

  test("an unchanged tick re-uploads nothing but still draws", () => {
    const adapter = createAdapter();
    const trace = [csgNode("o_csg", 0, "pac")];
    adapter.tick(input(trace));
    const patch = adapter.tick(input(trace));

    expect(patch.fields.quads.writes).toHaveLength(0);
    expect(patch.fields.leaves.writes).toHaveLength(0);
    expect(patch.fields.segs.writes).toHaveLength(0);
    expect(patch.fields.arcs.writes).toHaveLength(0);
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
    (dragged.value as unknown as { of: { radius?: number }[] }).of[0]!.radius = 2.5;
    const moved = adapter.tick(input([dragged]));
    // Same shape, new numbers: leaves and the AABB move, the spans do not.
    expect(moved.fields.quads.writes).toHaveLength(1);
    expect(moved.fields.leaves.writes).toHaveLength(2);
    expect(moved.fields.segs.writes).toHaveLength(0);
    expect(moved.fields.arcs.writes).toHaveLength(0);
    const draw = moved.fillDraws[0]!;
    expect(draw.path === "field" && draw.plan.shape).toBe("diff(circle,region)");

    const hovered = adapter.tick(input([dragged], { hoverId: "o_csg" }));
    expect(hovered.fields.quads.writes).toHaveLength(1);
    const hoverColor = hovered.fields.quads.writes[0]!.value.color;
    expect([hoverColor.x, hoverColor.y, hoverColor.z]).toEqual([...COLORS.selectedPaint]);
    expect(hovered.fields.quads.writes[0]!.value.alpha).toBeCloseTo(0.28);
    // Chrome is data too: no leaf or span traffic for a hover.
    expect(hovered.fields.leaves.writes).toHaveLength(0);
    expect(hovered.fields.segs.writes).toHaveLength(0);
    expect(hovered.fields.arcs.writes).toHaveLength(0);
  });

  test("a dragged arc leaf rewrites only the arc array", () => {
    const adapter = createAdapter();
    const trace = [
      node("o_ring", {
        kind: "region",
        outer: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
        holes: [squareRegion(1).outer],
      }),
    ];
    adapter.tick(input(trace));
    const value = trace[0]!.value as unknown as { outer: { radius: number } };
    value.outer.radius = 2.5;
    const moved = adapter.tick(input(trace));
    // The carrier moved, the hole did not: half the record kinds re-upload.
    expect(moved.fields.arcs.writes).toHaveLength(1);
    expect(moved.fields.segs.writes).toHaveLength(0);
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

/** CSS px → world units, the chrome convention (see `docs/chrome.md`). */
const world = (px: number) => px / CAM.scale;

describe("fill halo chrome", () => {
  test("a hot fill draws its halo under its own paint, cold ones do not", () => {
    const trace = [csgNode("o_csg", 0, "pac")];
    const cold = createAdapter().tick(input(trace));
    expect(cold.fillDraws.map((d) => d.layer)).toEqual(["paint"]);
    const coldQuad = cold.fields.quads.writes[0]!.value;
    expect(coldQuad.haloRing.w).toBe(0);
    expect(coldQuad.haloHalf.x).toBe(0);

    // Hover: the accent outline alone, 7px wide from the fill's edge inward
    // (half = 3.5px), at 50%, and no paper knockout — driven straight off the
    // ink chrome's band widths. The halo draws *after* the paint: it knocks the
    // fill out rather than being washed by it.
    const hovered = createAdapter().tick(input(trace, { hoverId: "o_csg" }));
    expect(hovered.fillDraws.map((d) => `${d.path}:${d.layer}`)).toEqual([
      "field:paint",
      "field:halo",
    ]);
    // Both runs are the node's one quad slot, so the halo costs no extra state.
    expect(hovered.fillDraws.map((d) => d.first)).toEqual([0, 0]);
    const hoverQuad = hovered.fields.quads.writes[0]!.value;
    expect([hoverQuad.haloRing.x, hoverQuad.haloRing.y, hoverQuad.haloRing.z]).toEqual([
      ...COLORS.ring,
    ]);
    expect(hoverQuad.haloRing.w).toBeCloseTo(0.5, 6);
    expect(hoverQuad.haloKnock.w).toBe(0);
    expect(hoverQuad.haloHalf.x).toBe(0);
    expect(hoverQuad.haloHalf.y).toBeCloseTo(world(3.5), 6);

    // Selected: the same outline opaque, plus the 2px paper knockout band just
    // inside it.
    const selected = createAdapter().tick(input(trace, { selectedKey: "o_csg:0" }));
    expect(selected.fillDraws.map((d) => d.layer)).toEqual(["paint", "halo"]);
    const liftedQuad = selected.fields.quads.writes[0]!.value;
    expect(liftedQuad.haloRing.w).toBe(1);
    expect([liftedQuad.haloKnock.x, liftedQuad.haloKnock.y, liftedQuad.haloKnock.z]).toEqual([
      ...COLORS.paper,
    ]);
    expect(liftedQuad.haloKnock.w).toBe(1);
    expect(liftedQuad.haloHalf.x).toBeCloseTo(world(2), 6);
    expect(liftedQuad.haloHalf.y).toBeCloseTo(world(3.5), 6);
  });

  test("the span path carries the same halo fields per island", () => {
    const hovered = createAdapter().tick(
      input([node("o_poly", polygonValue(), "shell")], { hoverId: "o_poly" }),
    );
    expect(hovered.fillDraws.map((d) => d.layer)).toEqual(["paint", "halo"]);
    const region = hovered.fills.writes[0]!.value;
    expect(region.haloRing.w).toBeCloseTo(0.5, 6);
    expect(region.haloHalf.y).toBeCloseTo(world(3.5), 6);
  });

  test("dragging drops the halo and keeps the paint", () => {
    const patch = createAdapter().tick(
      input([csgNode("o_csg", 0, "pac")], { hoverId: "o_csg", showHalos: false }),
    );
    expect(patch.fillDraws.map((d) => d.layer)).toEqual(["paint"]);
    expect(patch.fields.quads.writes[0]!.value.haloRing.w).toBe(0);
  });
});

describe("fill outline (state colors)", () => {
  /** The fill's own stroke: `inkClass` colors, construction stroke width, and
   * unlike the halo bands all of it sits inside the silhouette. */
  const strokeWidth = world(1.5);

  test("every fill carries an outline: ink, accent when editable, cream when hot", () => {
    const plain = createAdapter().tick(input([node("o_flat", squareRegion(1), "plate")]));
    const inkEdge = plain.fields.quads.writes[0]!.value;
    expect([inkEdge.edge.x, inkEdge.edge.y, inkEdge.edge.z]).toEqual([...COLORS.ink]);
    expect(inkEdge.edge.w).toBe(1);
    expect(inkEdge.edgeWidth).toBeCloseTo(strokeWidth, 9);

    const editable = createAdapter().tick(input([node("o_flat", squareRegion(1), "plate", true)]));
    const accentEdge = editable.fields.quads.writes[0]!.value;
    expect([accentEdge.edge.x, accentEdge.edge.y, accentEdge.edge.z]).toEqual([...COLORS.accent]);

    const hot = createAdapter().tick(
      input([node("o_flat", squareRegion(1), "plate", true)], { hoverId: "o_flat" }),
    );
    const creamEdge = hot.fields.quads.writes[0]!.value;
    expect([creamEdge.edge.x, creamEdge.edge.y, creamEdge.edge.z]).toEqual([
      ...COLORS.selectedPaint,
    ]);
  });

  test("the span path carries the same outline", () => {
    const patch = createAdapter().tick(input([node("o_poly", polygonValue(), "shell", true)]));
    const region = patch.fills.writes[0]!.value;
    expect([region.edge.x, region.edge.y, region.edge.z]).toEqual([...COLORS.accent]);
    expect(region.edgeWidth).toBeCloseTo(strokeWidth, 9);
  });

  test("flipping editability recolors the record without touching the spans", () => {
    const adapter = createAdapter();
    const flat = node("o_flat", squareRegion(1), "plate", false);
    adapter.tick(input([flat]));
    // Same node identity, new editable flag: the outline is data like any other
    // state color, so it rides the existing byte diff.
    (flat as { editable: boolean }).editable = true;
    const patch = adapter.tick(input([flat]));
    const quad = patch.fields.quads.writes[0]!.value;
    expect([quad.edge.x, quad.edge.y, quad.edge.z]).toEqual([...COLORS.accent]);
    expect(patch.fields.quads.writes).toHaveLength(1);
    expect(patch.fields.segs.writes).toHaveLength(0);
  });
});
