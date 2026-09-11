import { describe, expect, test } from "vitest";

import type { TraceValue } from "#eval/context";
import type { TraceNode } from "#eval/context";
import type { Csg2, Region } from "#geom";
import type { Vec2 } from "#geom";
import type { PolarRepeat } from "#geom";
import { csg2Value, polarRepeatValue } from "#geom/csg2";
import { isCircleWalk } from "#geom/region";

import { imageQuad, type ImageValue } from "../../eval/image";
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
    hoverKey: undefined,
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

/** `kind` is derived from `value`, so the pair cannot disagree. */
/** Slot indices a patch wrote, in ascending order. */
function slotsOf(writes: readonly { idx: number }[]): number[] {
  return writes.map((w) => w.idx).toSorted((p, q) => p - q);
}

/** Triangle polygon shifted along x: a second scene with the same shape. */
function triangleAt(dx: number) {
  return {
    kind: "polygon" as const,
    boundary: [
      { x: -1 + dx, y: -1 },
      { x: 1 + dx, y: -1 },
      { x: dx, y: 1 },
    ],
    holes: [],
  };
}

function node<V extends TraceValue>(
  id: string,
  value: V,
  bind?: string,
  editable = false,
): TraceNode {
  return { id, occ: 0, kind: value.kind, value, bind, editable, stack: [] } as TraceNode;
}

/** A raster reference: a rect, a turn and a look, plus the URL it names. */
function imageValue(over: Partial<ImageValue> = {}): ImageValue {
  return {
    kind: "image",
    src: "/assets/gear-9f3a2c11.png",
    // The rect is (0, 0) to (4, 2): the bitmap's top-left anchored at (0, 2).
    world: { x: 0, y: 2 },
    anchor: { x: 0, y: 0 },
    imageSize: { width: 4, height: 2 },
    targetSize: { width: 4, height: 2 },
    rot: 0,
    flip: 0,
    style: { opacity: 0.4, saturation: 0.2, contrast: 1.1 },
    ...over,
  };
}

function imageNode(id: string, over: Partial<ImageValue> = {}): TraceNode {
  return node(id, imageValue(over));
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
    // The quad is the tree's AABB (the circle) in pure world units: the AA
    // skirt is not baked in any more, the vertex shader grows it by
    // `QUAD_PAD_PX` at draw time (see `pipelines/fills.ts`).
    expect(quad.aabbMin.x).toBeCloseTo(-2, 9);
    expect(quad.aabbMax.x).toBeCloseTo(2, 9);

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

  /**
   * Switching scenes drops one scene's keys and allocates the next scene's into
   * the ranges they freed. A key that comes back — the demo's scenes share
   * authored ids, and going back and forth is the normal way to compare them —
   * finds its slot at the same index, but the *bytes* there are now the other
   * key's. The byte diff must not read that as "unchanged".
   */
  test("a node that returns to a slot another key used is re-uploaded", () => {
    const adapter = createAdapter();
    const a = node("o_a", { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, "a");
    const b = node("o_b", { kind: "segment", a: { x: 0, y: 1 }, b: { x: 1, y: 1 } }, "b");

    // The GPU buffer is exactly what the writes put there, so shadow it.
    const buffer = new Map<number, unknown>();
    const upload = (patch: ReturnType<typeof adapter.tick>) => {
      for (const w of patch.strokes.writes) buffer.set(w.idx, w.value);
      return patch;
    };

    // Scene A on its own: `o_a` takes slot range 0 and every disc is new.
    const first = upload(adapter.tick(input([a])));
    const aSlots = [...first.strokes.bands.rest];
    expect(aSlots.length).toBeGreaterThan(0);
    const aInk = new Map(aSlots.map((i) => [i, buffer.get(i)]));

    // Scene B, which has none of A's keys: `o_b` reuses the range `o_a` freed.
    upload(adapter.tick(input([b])));

    // Back to A, with identical geometry. Its slot index is the same, so only
    // the diff decides whether the buffer gets A's discs back.
    const back = adapter.tick(input([a]));
    expect(back.strokes.writes.filter((w) => aSlots.includes(w.idx))).not.toHaveLength(0);
    upload(back);
    for (const i of aSlots) expect(buffer.get(i)).toEqual(aInk.get(i));
  });

  /**
   * The reported bug, without any navigation at all: one node leaves the trace
   * (an erase, an undo, a node that went non-finite for a tick) while another
   * takes the range it freed, then it comes back. The adapter cannot tell this
   * from a scene swap, so dropping caches on navigation alone would not cover
   * it — the per-tick records do.
   */
  test("a node that leaves and returns within one scene re-uploads", () => {
    const adapter = createAdapter();
    const x = node("o_x", { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, "x");
    const y = node("o_y", { kind: "segment", a: { x: 0, y: 2 }, b: { x: 1, y: 2 } }, "y");
    const z = node("o_z", { kind: "segment", a: { x: 0, y: 1 }, b: { x: 1, y: 1 } }, "z");

    const buffer = new Map<number, unknown>();
    const upload = (patch: ReturnType<typeof adapter.tick>) => {
      for (const w of patch.strokes.writes) buffer.set(w.idx, w.value);
      return patch;
    };

    const first = upload(adapter.tick(input([x, z])));
    const xSlots = [...first.strokes.bands.rest].filter((i) => buffer.has(i));
    const xInk = new Map(xSlots.map((i) => [i, buffer.get(i)]));

    upload(adapter.tick(input([z, y]))); // x leaves; y takes its range
    const back = adapter.tick(input([x, z])); // x returns
    expect(back.strokes.writes.filter((w) => xSlots.includes(w.idx))).not.toHaveLength(0);
    upload(back);
    for (const i of xSlots) expect(buffer.get(i)).toEqual(xInk.get(i));
  });

  /**
   * The same hazard on the compiled-field path, where one node owns records in
   * five pools at once. Each site must diff against *its own* slot, so a fill
   * that comes back rewrites its quad, leaves, spans and region window rather
   * than leaving the other scene's geometry in place.
   */
  test("a field fill that returns to a reused range rewrites every record", () => {
    const adapter = createAdapter();
    const a = csgNode("o_a", 0, "pac");
    const b = csgNode("o_b", 1.5, "pac"); // same shape, different geometry
    const first = adapter.tick(input([a]));
    const firstIdx = {
      quads: slotsOf(first.fields.quads.writes),
      leaves: slotsOf(first.fields.leaves.writes),
      segs: slotsOf(first.fields.segs.writes),
    };
    for (const slots of Object.values(firstIdx)) expect(slots.length).toBeGreaterThan(0);

    adapter.tick(input([b])); // takes over every range A freed
    const back = adapter.tick(input([a]));
    expect(slotsOf(back.fields.quads.writes)).toEqual(firstIdx.quads);
    expect(slotsOf(back.fields.leaves.writes)).toEqual(firstIdx.leaves);
    expect(slotsOf(back.fields.segs.writes)).toEqual(firstIdx.segs);
  });

  /** And on the span path, whose record is the region slab plus its spans. */
  test("a span fill that returns to a reused range rewrites its regions and spans", () => {
    const adapter = createAdapter();
    const a = node("o_a", triangleAt(0), "shell");
    const b = node("o_b", triangleAt(2), "shell"); // same shape, moved

    const first = adapter.tick(input([a]));
    const firstRegions = slotsOf(first.fills.writes);
    const firstSegs = slotsOf(first.fillSegs.writes);
    expect(firstRegions.length).toBeGreaterThan(0);
    expect(firstSegs.length).toBeGreaterThan(0);

    adapter.tick(input([b]));
    const back = adapter.tick(input([a]));
    expect(slotsOf(back.fills.writes)).toEqual(firstRegions);
    expect(slotsOf(back.fillSegs.writes)).toEqual(firstSegs);
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
    const draggedCsg = dragged.value as Csg2;
    const first = draggedCsg.of[0];
    if (first?.kind !== "circle") throw new Error("fixture: first operand is a circle");
    first.radius = 2.5;
    const moved = adapter.tick(input([dragged]));
    // Same shape, new numbers: leaves and the AABB move, the spans do not.
    expect(moved.fields.quads.writes).toHaveLength(1);
    expect(moved.fields.leaves.writes).toHaveLength(2);
    expect(moved.fields.segs.writes).toHaveLength(0);
    expect(moved.fields.arcs.writes).toHaveLength(0);
    const draw = moved.fillDraws[0]!;
    expect(draw.path === "field" && draw.plan.shape).toBe("diff(circle,region)");

    const hovered = adapter.tick(input([dragged], { hoverKey: "o_csg:0" }));
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
    const value = trace[0]!.value as Region;
    if (!isCircleWalk(value.outer)) throw new Error("fixture: outer is a circle");
    const outer = value.outer;
    outer.radius = 2.5;
    const moved = adapter.tick(input(trace));
    // The carrier moved, the hole did not: half the record kinds re-upload.
    expect(moved.fields.arcs.writes).toHaveLength(1);
    expect(moved.fields.segs.writes).toHaveLength(0);
  });

  test("slots are keyed by the node, not by the object it arrives in", () => {
    const adapter = createAdapter();
    adapter.tick(input([csgNode("o_csg")]));
    // Eval hands over a *fresh* node object every tick — the reuse pass only
    // keeps the old one when the drawn value is unchanged — so keying on the
    // object would re-upload everything a node owns on every edit (rotating the
    // demo's gear cost 106 of its 128 records that way, 10 of which had moved).
    const again = adapter.tick(input([csgNode("o_csg")]));
    expect(again.fields.quads.writes).toHaveLength(0);
    expect(again.fields.leaves.writes).toHaveLength(0);
    expect(again.stats.written).toBe(0);
    // The same key with new numbers: that node's payload, and nothing else.
    const moved = adapter.tick(input([csgNode("o_csg", 1.5)]));
    expect(moved.fields.quads.writes).toHaveLength(1);
    expect(moved.fields.leaves.writes).toHaveLength(2);
    expect(moved.fields.segs.writes).toHaveLength(0);
    expect(moved.stats.total).toBe(again.stats.total);
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

/** The chrome widths the records carry are CSS px, so a hover ring of 7px is
 * `halfPx = 3.5` — no zoom baked in (see `docs/chrome.md`). */

describe("fill halo chrome", () => {
  test("a hot fill draws its halo under its own paint, cold ones do not", () => {
    const trace = [csgNode("o_csg", 0, "pac")];
    const cold = createAdapter().tick(input(trace));
    expect(cold.fillDraws.map((d) => d.layer)).toEqual(["paint"]);
    const coldQuad = cold.fields.quads.writes[0]!.value;
    expect(coldQuad.haloRing.w).toBe(0);
    expect(coldQuad.haloHalfPx.x).toBe(0);

    // Hover: the accent outline alone, 7px wide from the fill's edge inward
    // (half = 3.5px), at 50%, and no paper knockout — driven straight off the
    // ink chrome's band widths. The halo draws *after* the paint: it knocks the
    // fill out rather than being washed by it.
    const hovered = createAdapter().tick(input(trace, { hoverKey: "o_csg:0" }));
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
    expect(hoverQuad.haloHalfPx.x).toBe(0);
    expect(hoverQuad.haloHalfPx.y).toBeCloseTo(3.5, 6);

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
    expect(liftedQuad.haloHalfPx.x).toBeCloseTo(2, 6);
    expect(liftedQuad.haloHalfPx.y).toBeCloseTo(3.5, 6);
  });

  test("the span path carries the same halo fields per island", () => {
    const hovered = createAdapter().tick(
      input([node("o_poly", polygonValue(), "shell")], { hoverKey: "o_poly:0" }),
    );
    expect(hovered.fillDraws.map((d) => d.layer)).toEqual(["paint", "halo"]);
    const region = hovered.fills.writes[0]!.value;
    expect(region.haloRing.w).toBeCloseTo(0.5, 6);
    expect(region.haloHalfPx.y).toBeCloseTo(3.5, 6);
  });

  test("dragging drops the halo and keeps the paint", () => {
    const patch = createAdapter().tick(
      input([csgNode("o_csg", 0, "pac")], { hoverKey: "o_csg:0", showHalos: false }),
    );
    expect(patch.fillDraws.map((d) => d.layer)).toEqual(["paint"]);
    expect(patch.fields.quads.writes[0]!.value.haloRing.w).toBe(0);
  });
});

describe("fill outline (state colors)", () => {
  /** The fill's own stroke: `inkClass` colors, the construction stroke width
   * (1.5 CSS px, centred on the boundary). */
  const strokeWidthPx = 1.5;

  test("every fill carries an outline: ink, accent when editable, cream when hot", () => {
    const plain = createAdapter().tick(input([node("o_flat", squareRegion(1), "plate")]));
    const inkEdge = plain.fields.quads.writes[0]!.value;
    expect([inkEdge.edge.x, inkEdge.edge.y, inkEdge.edge.z]).toEqual([...COLORS.ink]);
    expect(inkEdge.edge.w).toBe(1);
    expect(inkEdge.edgeWidthPx).toBeCloseTo(strokeWidthPx, 9);

    const editable = createAdapter().tick(input([node("o_flat", squareRegion(1), "plate", true)]));
    const accentEdge = editable.fields.quads.writes[0]!.value;
    expect([accentEdge.edge.x, accentEdge.edge.y, accentEdge.edge.z]).toEqual([...COLORS.accent]);

    const hot = createAdapter().tick(
      input([node("o_flat", squareRegion(1), "plate", true)], { hoverKey: "o_flat:0" }),
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
    expect(region.edgeWidthPx).toBeCloseTo(strokeWidthPx, 9);
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

/** A tooth-like box on the `+x` side of the origin: cell 0 of a repeat. */
function ringTooth() {
  const corners: Vec2[] = [
    { x: 1.8, y: -0.3 },
    { x: 2.2, y: -0.3 },
    { x: 2.2, y: 0.3 },
    { x: 1.8, y: 0.3 },
  ];
  const outer = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    return { a, b, carrier: { kind: "segment" as const, a, b } };
  });
  return { kind: "region" as const, outer, holes: [] };
}

/** One node of every record kind — a stroke, a circle, a point, a compiled
 * field and a span-path fill. Between them they carry every width a zoom used
 * to rewrite: ctrl radii, annulus bands, disc radii, the fill outline and the
 * halo bands. */
function recordFixture(): TraceNode[] {
  return [
    node("o_seg", { kind: "segment", a: { x: -1, y: 0 }, b: { x: 1, y: 0 } }, "beam"),
    node("o_circ", { kind: "circle", center: { x: 0, y: 3 }, radius: 1 }, "drill", true),
    {
      id: "o_pt",
      occ: 0,
      kind: "point",
      value: { kind: "point", x: 2, y: -2 },
      editable: true,
      stack: [],
    },
    csgNode("o_csg", 0, "pac"),
    node("o_poly", polygonValue(), "shell"),
  ];
}

/**
 * The unit contract: every width in a record is CSS px, so the camera's zoom
 * lives in the frame uniform alone. Nothing a zoom touches is a record, and a
 * zoom therefore re-uploads nothing while still reprojecting the world — the
 * whole point of storing px instead of world units (see `schemas.ts`).
 */
describe("polar repeat fills", () => {
  /** A 24-tooth ring with a bore cut out: the shape the gear scene hands the
   * pane, and the one the fold exists for. */
  function ringFace(count = 24): { face: Csg2; rep: PolarRepeat } {
    const rep = polarRepeatValue(ringTooth(), count, { x: 0, y: 0 }, 0);
    const face = csg2Value("diff", [rep, { kind: "circle", center: { x: 0, y: 0 }, radius: 0.5 }]);
    return { face, rep };
  }

  test("a 24-tooth ring compiles to one tooth, on the field path", () => {
    const { face } = ringFace();
    const patch = createAdapter().tick(input([node("o_ring", face, "ring")]));
    // The compiled field, never the span path: 24 copies on the span path would
    // be 96 boundary spans walking every pixel, against 4 for the folded tooth.
    expect(patch.fillDraws.map((d) => d.path)).toEqual(["field"]);
    expect(patch.fields.quads.writes).toHaveLength(1);
    expect(patch.fields.segs.writes).toHaveLength(4);
    expect(patch.fills.writes).toHaveLength(0);
    const draw = patch.fillDraws[0]!;
    // The shape key names the structure, not the numbers: one tooth, a ring.
    expect(draw.path === "field" && draw.plan.shape).toBe("diff(polarRepeat(region),circle)");
    expect(draw.path === "field" && draw.plan.leaves.map((l) => l.kind)).toEqual([
      "spans",
      "repeat",
      "circle",
    ]);
  });

  test("dragging the tooth count rewrites numbers, never the spans", () => {
    const { face, rep } = ringFace();
    // One node object across both ticks, like eval's reused trace.
    const ring = node("o_ring", face, "ring");
    const adapter = createAdapter();
    adapter.tick(input([ring]));
    // A slider drag: same operand identity, new count. The teeth are implied by
    // the fold, so only bean-count numbers move — the tooth's spans, the ring's
    // boundary in the record, never re-upload.
    rep.count = 40;
    const patch = adapter.tick(input([ring]));
    // The node's whole leaf payload re-uploads (the tooth's window, the spacing
    // and the bore) — a handful of floats either way.
    expect(patch.fields.leaves.writes).toHaveLength(3);
    expect(patch.fields.quads.writes).toHaveLength(1);
    expect(patch.fields.segs.writes).toHaveLength(0);
    expect(patch.fills.writes).toHaveLength(0);
  });

  test("a repeat recolors on hover like any other fill", () => {
    const { face } = ringFace();
    const ring = node("o_ring", face, "ring");
    const adapter = createAdapter();
    adapter.tick(input([ring]));
    const hovered = adapter.tick(input([ring], { hoverKey: "o_ring:0" }));
    expect(hovered.fillDraws.map((d) => `${d.path}:${d.layer}`)).toEqual([
      "field:paint",
      "field:halo",
    ]);
    expect(hovered.fields.quads.writes).toHaveLength(1);
    expect(hovered.fields.segs.writes).toHaveLength(0);
  });
});

describe("zoom and pan write no records", () => {
  test("the first tick uploads everything, the second nothing", () => {
    const trace = recordFixture();
    const adapter = createAdapter();
    const first = adapter.tick(input(trace));
    expect(first.stats.written).toBe(first.stats.total);
    expect(first.stats.total).toBeGreaterThan(0);

    const again = adapter.tick(input(trace));
    expect(again.stats.written).toBe(0);
    expect(again.stats.total).toBe(first.stats.total);
  });

  test("a zoom step rewrites no record but still draws the same runs", () => {
    const trace = recordFixture();
    const adapter = createAdapter();
    const first = adapter.tick(input(trace));
    const zoomed = adapter.tick(input(trace, { cam: { ...CAM, scale: CAM.scale * 1.05 } }));

    expect(zoomed.stats.written).toBe(0);
    expect(zoomed.stats.total).toBe(first.stats.total);
    // Same runs, same slots: the reprojection is the frame uniform's job.
    expect(zoomed.fillDraws).toEqual(first.fillDraws);
    expect(zoomed.circles.bands).toEqual(first.circles.bands);
    expect(zoomed.strokes.bands).toEqual(first.strokes.bands);
  });

  test("a pan rewrites no record, hover included", () => {
    const trace = recordFixture();
    const adapter = createAdapter();
    const hovered = input(trace, { hoverKey: "o_csg:0", selectedKey: "o_seg:0" });
    adapter.tick(hovered);
    const panned = adapter.tick({ ...hovered, cam: { ...CAM, x: CAM.x + 3, y: CAM.y - 2 } });
    expect(panned.stats.written).toBe(0);
  });

  test("only an unbounded field box follows the camera", () => {
    // A half-plane has no world extent of its own, so its quad has to be
    // clamped to the pane — the one record a pan or zoom may legitimately move.
    const half = node(
      "o_half",
      {
        kind: "csg2",
        op: "diff",
        of: [
          {
            kind: "halfPlane",
            line: { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
            side: 1,
          },
          squareRegion(0.5),
        ],
      },
      "shelf",
    );
    const nothingBounded = node("o_poly2", polygonValue(), "shell");
    const adapter = createAdapter();
    const first = adapter.tick(input([half, nothingBounded]));
    expect(first.stats.written).toBe(first.stats.total);

    const zoomed = adapter.tick(
      input([half, nothingBounded], { cam: { ...CAM, scale: CAM.scale * 1.05 } }),
    );
    // Only the half-plane's quad: the span fill holds still, so this is the
    // whole exception, not a rule.
    expect(zoomed.fields.quads.writes).toHaveLength(1);
    expect(zoomed.fills.writes).toHaveLength(0);
    expect(zoomed.stats.written).toBe(1);
  });
});

/**
 * References are the backdrop: they must not reach the ink band (a stroke
 * record built from one would be a quad drawn as a polyline), they own one slot
 * each keyed by the node, and the draw list carries the source the layer binds.
 */
describe("adapter image routing", () => {
  test("a reference draws a quad, not a stroke, and names its source", () => {
    const patch = createAdapter().tick(input([imageNode("o_img")]));

    expect(patch.images.draws).toEqual([{ slot: 0, src: "/assets/gear-9f3a2c11.png" }]);
    expect(patch.images.writes).toHaveLength(1);
    expect(patch.strokes.writes).toHaveLength(0);
    expect(patch.circles.writes).toHaveLength(0);
    expect(patch.stats.total).toBe(1);
  });

  test("the quad is the rotated, flipped rect in draw order", () => {
    const value = imageValue({ rot: 90, flip: 1 });
    const patch = createAdapter().tick(input([node("o_img", value)]));
    const inst = patch.images.writes[0]!.value;
    const got = [inst.a, inst.b, inst.c, inst.d].map((p) => [p.x, p.y]);
    expect(got).toEqual(imageQuad(value).map((p) => [p.x, p.y]));
    expect(inst.opacity).toBeCloseTo(0.4, 6);
    expect(inst.saturation).toBeCloseTo(0.2, 6);
    expect(inst.contrast).toBeCloseTo(1.1, 6);
  });

  test("an unchanged tick re-uploads nothing but still draws", () => {
    const adapter = createAdapter();
    const trace = [imageNode("o_img")];
    adapter.tick(input(trace));
    const patch = adapter.tick(input(trace));

    expect(patch.images.writes).toHaveLength(0);
    expect(patch.images.draws).toHaveLength(1);
  });

  test("a moved reference rewrites its own record only", () => {
    const adapter = createAdapter();
    adapter.tick(input([imageNode("o_img"), imageNode("o_other")]));
    const patch = adapter.tick(
      input([imageNode("o_img", { world: { x: 3, y: 2 } }), imageNode("o_other")]),
    );

    expect(patch.images.writes).toHaveLength(1);
    expect(patch.images.writes[0]!.idx).toBe(0);
    expect(patch.images.draws.map((d) => d.slot)).toEqual([0, 1]);
  });

  test("a reference that leaves the scene releases its slot", () => {
    const adapter = createAdapter();
    adapter.tick(input([imageNode("o_img"), imageNode("o_other")]));
    const patch = adapter.tick(input([imageNode("o_other")]));

    // The survivor keeps slot 1 — runs are per key, so the free one is only reused.
    expect(patch.images.draws).toEqual([{ slot: 1, src: "/assets/gear-9f3a2c11.png" }]);
    expect(patch.stats.total).toBe(1);
  });

  /**
   * A reference has no ink of its own, so its **selection chrome is its
   * outline** — the band the image fragment draws inside the quad's border. It
   * carries one only while hot, in the state colour every other node's chrome
   * uses, and the selected weight is the one selected strokes get.
   */
  test("hovering or selecting lights the same chrome a hot fill carries", () => {
    const adapter = createAdapter();
    const trace = [imageNode("o_img")];
    const cold = adapter.tick(input(trace)).images.writes[0]!.value;
    expect(cold.edge.w).toBe(0);
    expect(cold.haloRing.w).toBe(0);
    expect(cold.haloKnock.w).toBe(0);

    const hovered = adapter.tick(input(trace, { hoverKey: "o_img:0" })).images.writes[0]!.value;
    // Hover: the ring alone, paper-backed at half opacity, no knockout gap yet.
    expect(hovered.haloRing.w).toBeCloseTo(0.5, 6);
    expect(hovered.haloKnock.w).toBe(0);
    expect(hovered.edge.w).toBe(1);
    expect(hovered.edgeWidthPx).toBeGreaterThan(0);
    expect(hovered.haloHalfPx.y).toBeGreaterThan(0);

    const selected = adapter.tick(input(trace, { selectedKey: "o_img:0" })).images.writes[0]!.value;
    // Selected: the same ring opaque, plus the paper knockout just inside it —
    // and the node's own outline switches to the selected paint.
    expect(selected.haloRing.w).toBe(1);
    expect(selected.haloKnock.w).toBe(1);
    expect(selected.haloHalfPx.x).toBeGreaterThan(0);
    // The node's own outline is the state colour in both: it is the halo that
    // says which state it is.
    expect(selected.edge.w).toBe(1);
  });

  test("a drag suppresses the halo and keeps the outline, like every other node", () => {
    const adapter = createAdapter();
    const trace = [imageNode("o_img")];
    const dragging = adapter.tick(input(trace, { hoverKey: "o_img:0", showHalos: false })).images
      .writes[0]!.value;
    expect(dragging.haloRing.w).toBe(0);
    expect(dragging.haloKnock.w).toBe(0);
    expect(dragging.edge.w).toBe(1);
  });

  test("the band knows the rect it sits in", () => {
    const inst = createAdapter().tick(input([imageNode("o_img")])).images.writes[0]!.value;
    expect([inst.size.x, inst.size.y]).toEqual([4, 2]);
  });

  test("a collapsed reference is never recorded", () => {
    const patch = createAdapter().tick(
      input([imageNode("o_img", { targetSize: { width: 0, height: 2 } })]),
    );
    expect(patch.images.draws).toHaveLength(0);
    expect(patch.stats.total).toBe(0);
  });
});
