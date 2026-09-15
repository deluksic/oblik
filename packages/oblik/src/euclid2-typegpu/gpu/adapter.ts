import { vec2f, vec3f, vec4f } from "typegpu/data";
import type { v2f, v4f } from "typegpu/data";

import type { TraceNode, TraceNodeOf } from "#eval/context";
import type { Circle, CsgOperand, Polygon, Region, Vec2 } from "#geom";
import { isFillGeom } from "#geom/csg2";
import { gliderAt, isGlider } from "#geom/gliders";
import { infiniteLineAxis } from "#geom/ops";

import { infiniteClip, screenToWorld, type Camera2, type PaneSize } from "../../euclid2/camera";
import { isFiniteTrace } from "../../euclid2/pick";
import type { Ghost, PlaceHit } from "../../euclid2/tool";
import { DEFAULT_CHROME_METRICS, overlayBands } from "../../euclid2/view/chrome";
import { isHot, isSelected, splitChrome } from "../../euclid2/view/marks";
import { pointMarkRadius } from "../../euclid2/view/pointMark";
import { imageQuad, imageRect, isImage, type ImageValue } from "../../eval/image";
import {
  bandsFor,
  CIRCLE_BAND_LAYERS,
  INK_BAND_ORDER,
  INK_LAYER_COUNT,
  inkSlotOf,
  makeChromeValue,
  MUTED_ALPHA,
  POINT_RADIUS_TRIM_PX,
  type InkBandName,
  type InkState,
} from "./bands";
import {
  buildFieldInstance,
  fieldBox,
  fieldPlan,
  type FieldLeafData,
  type FieldPlan,
} from "./field/plan";
import {
  blockWindows,
  islandGeomOf,
  type Box,
  type SpanArc,
  type SpanSeg,
  type SpanWindow,
} from "./fillSpans";
import { buildOverlay } from "./overlay";
import type { OverlayPatch } from "./overlay";
import { createRecordPool, type RecordPool, type RecordRun } from "./recordPool";
import type {
  ChromeValue,
  CircleInstValue,
  FieldLeafValue,
  FieldQuadValue,
  FillArcValue,
  FillRegionValue,
  FillSegValue,
  ImageInstValue,
  PointNodeValue,
  StrokeNodeValue,
} from "./schemas";
import {
  CircleInst,
  FieldLeaf,
  FieldQuad,
  FillArc,
  FillRegion,
  FillSeg,
  ImageInst,
  ImageStyleFields,
  MAX_CIRCLES,
  MAX_FIELD_ARCS,
  MAX_FIELD_LEAVES,
  MAX_FIELD_QUADS,
  MAX_FIELD_SEGS,
  MAX_FILL_ARCS,
  MAX_FILL_REGIONS,
  MAX_FILL_SEGS,
  MAX_IMAGES,
  MAX_POINTS,
  LAYER_HALO,
  LAYER_KNOCKOUT,
  LAYER_PAINT,
  MAX_STROKE_DRAWS,
  PointNode,
  STATE_EDITABLE,
  STATE_HOT,
  STATE_MUTED,
  STATE_SELECTED,
  StrokeNode,
} from "./schemas";
import { createSlotPool } from "./slots";
import type { SlotPoolOpts } from "./slots";

const TAU = Math.PI * 2;

export type Rgb = readonly [number, number, number];

export type AdapterInput = {
  trace: readonly TraceNode[];
  cam: Camera2;
  size: PaneSize;
  colors: { ink: Rgb; accent: Rgb; selectedPaint: Rgb; ring: Rgb; paper: Rgb; ghost: Rgb };
  /** Construction paint width in CSS px (half of it is the ctrl radius). */
  strokePx: number;
  /** Hovered node's trace key (`id:occ`); select uses the same identity. */
  hoverKey: string | undefined;
  selectedKey: string | undefined;
  /** False while dragging: omit halo rings and knockouts (the paint still
   * lifts), mirroring the SVG view's chrome passes during a drag. */
  showHalos: boolean;
  hideFills: boolean;
  muted: (n: TraceNode) => boolean;
  /** Active placement tool ghost preview (SVG GhostMark/RegionGhost/TraceGhost). */
  ghost: Ghost | undefined;
  /** Placement cursor under the pointer; feeds the snap marker. */
  place: PlaceHit | undefined;
  /** Whether a placement tool is live (snap markers only render then). */
  placing: boolean;
  /** Hide snap markers while this tool is active (toolChrome.hideSnap). */
  hideSnap: boolean;
};

export type SlotPatch<T> = {
  writes: { idx: number; value: T }[];
  order: Uint32Array;
  count: number;
};

/** Records staged through a pool: the spans of the buffer that moved this tick.
 * Only the spans go up — the mirror behind them holds every record's current
 * bytes — so what a frame costs follows what changed, not the buffer's size. */
export type StagedRecords = { runs: RecordRun[] };

/** A staged kind that is also drawn: spans for the upload, an order list for the
 * draw. The two are independent — the order list says which records to draw and
 * in what order, the spans say which bytes moved. */
export type StagedDraw = StagedRecords & { order: Uint32Array; count: number };

/** One order list per draw-order band. The bands and their order come from
 * `bands.ts`'s table, so the painter plays what the adapter queued and neither
 * side lists the five names twice. */
export type InkBands = Record<InkBandName, Uint32Array>;

/** One world fill draw: a node's fill or its halo chrome. Fills are
 * translucent, so paint order is the SVG's band order; a compiled field and a
 * span fill are different pipelines, so the adapter emits a run per node — and
 * per layer, halo before paint — and the painter plays them in that order. */
export type FillDraw =
  | { path: "spans"; layer: FillLayer; first: number; count: number }
  | { path: "field"; layer: FillLayer; first: number; count: number; plan: FieldPlan };

/** Which fragment draws a fill run. */
export type FillLayer = "paint" | "halo";

export type TickPatch = {
  /** Pooled ink records: the spans of the record buffer that moved this tick,
   * plus the draw-order bands that address them. */
  strokes: { runs: RecordRun[]; bands: InkBands };
  circles: { runs: RecordRun[]; bands: InkBands };
  fills: StagedDraw;
  /** Boundary spans backing the fill regions — one array per record kind, so the
   * fragment's segment loop never touches a carrier. No draws of their own. */
  fillSegs: StagedRecords;
  fillArcs: StagedRecords;
  /** CSG fills compiled to GPU fields: an AABB quad per node, the leaf records
   * it reads, and the boundary spans of its region leaves. */
  fields: {
    quads: StagedDraw;
    leaves: StagedRecords;
    segs: StagedRecords;
    arcs: StagedRecords;
  };
  /** World fill draws, in band order (span fills and compiled fields mixed). */
  fillDraws: FillDraw[];
  /** Pooled point/glider marks, on the same staged-span path and bands. */
  points: { runs: RecordRun[]; bands: InkBands };
  /** Raster references: one byte-diffed quad per node, plus the draw list that
   * pairs each slot with the source whose texture paints it. The adapter names
   * the source but never touches a bitmap — loading is the GPU layer's. */
  images: {
    writes: { idx: number; value: ImageInstValue }[];
    draws: { slot: number; src: string }[];
  };
  /** Tool overlay (ghost previews + snap markers), rebuilt every tick. */
  overlay: OverlayPatch;
  /** The band widths and palette the record shaders derive their layers from:
   * a function of the theme and the chrome metrics rather than of any node, so
   * a theme switch rewrites this and no record at all. */
  chrome: ChromeValue;
  stats: { written: number; total: number };
};

export type Adapter = {
  tick(input: AdapterInput): TickPatch;
  /** Drop the slot runs and byte records. The view calls this on unmount; a
   * navigation remounts the view, so there is nothing to reset in place. */
  destroy(): void;
};

/** Fill geometry for one node: edge blocks (one per island) plus the island
 * AABB quad each block is drawn in. */

/**
 * Stable identity of a trace node across ticks: the same `id:occ` the reuse pass
 * matches on (`reuse-trace.ts`). Pools and byte diffs are keyed by this, not by
 * the node object — a node whose value changed comes back as a *new* object, and
 * keying on it would re-upload everything the node owns: rotating a gear rewrote
 * 106 of the scene's 128 records when only 10 of them had actually changed.
 */
function nodeKey(n: TraceNode): string {
  return `${n.id}:${n.occ}`;
}

/**
 * Where a key's payload was last written and what those bytes were.
 *
 * The slot belongs in the record: a pool hands a freed range to whichever key
 * needs it next, so bytes uploaded for a key are only still *its* bytes while it
 * holds that same run. Scene switches are the common way to lose it — the next
 * scene allocates its nodes into the ranges the previous one freed, and a node
 * that comes back (the demo's scenes share authored ids) finds its old digits at
 * the same index with another node's geometry in them. Comparing bytes alone
 * skipped the rewrite and drew the previous scene's shapes.
 */
type Upload = { start: number; bytes: Float64Array };

/** Image nodes, narrowed: the quad builder needs the arm's own fields, and the
 * partition has to leave them out of the ink band. */
function isImageNode(n: TraceNode): n is TraceNodeOf<"image"> {
  return isImage(n.value);
}

function sameBytes(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** True when the slot must be rewritten: the payload changed, or it moved. */
function diff(map: Map<string, Upload>, key: string, start: number, next: Float64Array): boolean {
  const prev = map.get(key);
  if (prev && prev.start === start && sameBytes(prev.bytes, next)) return false;
  map.set(key, { start, bytes: next });
  return true;
}

export function createAdapter(): Adapter {
  // Pooled records come first: a released range stops being its key's, so what
  // was staged there has to be forgotten — that is the hooks below.
  const strokeRecords = createRecordPool({
    element: StrokeNode,
    count: MAX_STROKE_DRAWS,
    make: makeStrokeNode,
  });
  const pointRecords = createRecordPool({
    element: PointNode,
    count: MAX_POINTS,
    make: makePointNode,
  });

  const fillRecords = createRecordPool({
    element: FillRegion,
    count: MAX_FILL_REGIONS,
    make: makeFillRegion,
  });
  const fillSegRecords = createRecordPool({
    element: FillSeg,
    count: MAX_FILL_SEGS,
    make: makeFillSeg,
  });
  const fillArcRecords = createRecordPool({
    element: FillArc,
    count: MAX_FILL_ARCS,
    make: makeFillArc,
  });

  const fieldQuadRecords = createRecordPool({
    element: FieldQuad,
    count: MAX_FIELD_QUADS,
    make: makeFieldQuad,
  });
  const fieldLeafRecords = createRecordPool({
    element: FieldLeaf,
    count: MAX_FIELD_LEAVES,
    make: makeFieldLeaf,
  });
  const fieldSegRecords = createRecordPool({
    element: FillSeg,
    count: MAX_FIELD_SEGS,
    make: makeFillSeg,
  });
  const fieldArcRecords = createRecordPool({
    element: FillArc,
    count: MAX_FIELD_ARCS,
    make: makeFillArc,
  });

  const circleRecords = createRecordPool({
    element: CircleInst,
    count: MAX_CIRCLES,
    make: makeCircleInst,
  });

  const strokePool = createSlotPool(MAX_STROKE_DRAWS, retireRun(strokeRecords));
  const pointPool = createSlotPool(MAX_POINTS, retireRun(pointRecords));
  const circlePool = createSlotPool(MAX_CIRCLES, retireRun(circleRecords));
  const fillPool = createSlotPool(MAX_FILL_REGIONS, retireRun(fillRecords));
  const fillSegPool = createSlotPool(MAX_FILL_SEGS, retireRun(fillSegRecords));
  const fillArcPool = createSlotPool(MAX_FILL_ARCS, retireRun(fillArcRecords));
  const fieldQuadPool = createSlotPool(MAX_FIELD_QUADS, retireRun(fieldQuadRecords));
  const fieldLeafPool = createSlotPool(MAX_FIELD_LEAVES, retireRun(fieldLeafRecords));
  const fieldSegPool = createSlotPool(MAX_FIELD_SEGS, retireRun(fieldSegRecords));
  const fieldArcPool = createSlotPool(MAX_FIELD_ARCS, retireRun(fieldArcRecords));
  const imagePool = createSlotPool(MAX_IMAGES);

  // Per-tick scratch, owned here and reused: the payload a pooled record is
  // filled from, and the signature it is compared by. Neither is allocated per
  // node, which is the point of pooling the records.
  const strokeFill: StrokeFill = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, halfPx: 0, state: 0 };
  const pointFill: PointFill = { at: { x: 0, y: 0 }, markRadiusPx: 0, state: 0 };
  const strokeSig = new Float64Array(STROKE_SIG_LANES);
  const pointSig = new Float64Array(POINT_SIG_LANES);
  const fillSig = new Float64Array(FILL_SIG_LANES);
  const segSig = new Float64Array(SEG_SIG_LANES);
  const arcSig = new Float64Array(ARC_SIG_LANES);
  const leafSig = new Float64Array(LEAF_SIG_LANES);
  const quadSig = new Float64Array(QUAD_SIG_LANES);
  const circleSig = new Float64Array(CIRCLE_SIG_LANES);
  const circleFill: CircleFill = {
    center: { x: 0, y: 0 },
    radius: 0,
    a0: 0,
    a1: 0,
    halfPx: 0,
    color: [0, 0, 0],
    alpha: 0,
    flags: 0,
  };
  const leafFill: LeafFill = {
    leaf: {
      a: { x: 0, y: 0 },
      b: { x: 0, y: 0 },
      r: 0,
      segOffset: 0,
      segCount: 0,
      arcOffset: 0,
      arcCount: 0,
    },
    segBase: 0,
    arcBase: 0,
  };
  const quadFill: QuadFill = {
    box: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    leafBase: 0,
    color: [0, 0, 0],
    alpha: 0,
    edge: { color: vec4f(0, 0, 0, 0), halfPx: 0 },
    halo: NO_HALO,
  };
  const regionFill: RegionFill = {
    bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    window: { segOffset: 0, segCount: 0, arcOffset: 0, arcCount: 0 },
    segBase: 0,
    arcBase: 0,
    color: [0, 0, 0],
    alpha: 0,
    edge: { color: vec4f(0, 0, 0, 0), halfPx: 0 },
    halo: NO_HALO,
  };

  /** Last uploaded payload per key, for CPU-side byte diffs. */
  const lastFillRegion = new Map<string, Upload>();
  const lastFillSegs = new Map<string, Upload>();
  const lastFillArcs = new Map<string, Upload>();
  const lastFieldQuad = new Map<string, Upload>();
  const lastFieldLeaf = new Map<string, Upload>();
  const lastFieldSegs = new Map<string, Upload>();
  const lastFieldArcs = new Map<string, Upload>();
  const lastImage = new Map<string, Upload>();

  /** Every record above, for the per-tick prune below. Strokes and points are
   * not here: their pools are told about released ranges as they happen. */
  const uploads = [
    lastFillRegion,
    lastFillSegs,
    lastFillArcs,
    lastFieldQuad,
    lastFieldLeaf,
    lastFieldSegs,
    lastFieldArcs,
  ];

  function tick(input: AdapterInput): TickPatch {
    const { cam, size, colors, strokePx } = input;
    // No record below takes the camera's scale: every width is CSS px (see the
    // band widths under the ink section). The one consumer left is the overlay,
    // whose px patterns — dash spacing, snap ring radii, the arrow shaft — are
    // world geometry on purpose, because they must not scale with the zoom.
    const overlay = buildOverlay({
      ghost: input.ghost,
      snap:
        input.placing && !input.hideSnap && input.place && input.place.point.kind !== "free"
          ? input.place
          : undefined,
      cam,
      size,
      scale: cam.scale,
      strokePx,
      colors: {
        ink: colors.ink,
        ghost: colors.ghost,
        paper: colors.paper,
        accent: colors.accent,
      },
    });

    const finite = input.trace.filter((n) => isFiniteTrace(n) && n.kind !== "slider");
    const fills = input.hideFills ? [] : finite.filter((n) => isFillGeom(n.value));
    // A reference is neither ink nor fill: it is the backdrop the ink is drawn
    // over, so it leaves the partition before the stroke band can claim it.
    const images = finite.filter(isImageNode);
    const ink = finite.filter(
      (n) => n.kind !== "point" && !isGlider(n.value) && !isFillGeom(n.value) && !isImage(n.value),
    );
    // Mirrors the SVG view's `points()` memo: point nodes and gliders, never sliders.
    const points = finite.filter((n) => n.kind === "point" || isGlider(n.value));
    const present = new Set<string>([...ink, ...fills, ...points].map(nodeKey));
    strokePool.sync(present);
    circlePool.sync(present);
    fillPool.sync(present);
    fillSegPool.sync(present);
    fillArcPool.sync(present);
    pointPool.sync(present);
    fieldQuadPool.sync(present);
    fieldLeafPool.sync(present);
    fieldSegPool.sync(present);
    fieldArcPool.sync(present);
    const imageKeys = new Set(images.map(nodeKey));
    imagePool.sync(imageKeys);
    // A key that left the scene released its runs, so whatever is in those
    // ranges is no longer its payload — forget the record and write afresh when
    // it returns.
    for (const last of uploads) {
      for (const key of last.keys()) {
        if (!present.has(key)) last.delete(key);
      }
    }
    for (const key of lastImage.keys()) {
      if (!imageKeys.has(key)) lastImage.delete(key);
    }

    const white = (n: TraceNode) => isHot(n, input.hoverKey, input.selectedKey);

    // --- strokes + circles (ink band). Five draw-order bands per kind mirror
    // --- the SVG chrome passes: rest paints, hover halos, hover paints,
    // --- lifted halos, lifted paints. The painter interleaves strokes and
    // --- circles within each band so chrome stacks per-state, not per-shape:
    // --- a hovered circle's paint sits under a selected edge's halo.
    const strokeLists = blankLists();
    const circleLists = blankLists();

    const inkBand = splitChrome(ink, (n) => isSelected(n, input.selectedKey), white);
    // Every width below is CSS px, not world units: the shaders scale them by
    // the frame's zoom (`worldPerPx`), so the records hold nothing the camera
    // can change and zooming reprojects the world instead of rewriting it.
    const halfStrokePx = strokePx / 2;
    // Chrome bands sit at the same CSS px widths regardless of state (the
    // selected overlayBands pass is what points/ink chrome share upstream).
    const outlineHalfPx = overlayBands(strokePx, { selected: true }).outline / 2;
    const knockoutHalfPx = overlayBands(strokePx, { selected: true }).knockout / 2;

    // --- references (the backdrop). One slot per node, in tape order; the
    // --- draw list pairs each slot with the source whose texture paints it.
    const imageWrites: { idx: number; value: ImageInstValue }[] = [];
    const imageDraws: { slot: number; src: string }[] = [];
    for (const n of images) {
      const key = nodeKey(n);
      const slot = imagePool.alloc(key, 1);
      if (slot === undefined) continue;
      const inst = imageInstance(
        n.value,
        colors,
        isHot(n, input.hoverKey, input.selectedKey),
        isSelected(n, input.selectedKey),
        input.showHalos,
        strokePx,
        outlineHalfPx,
        knockoutHalfPx,
      );
      if (diff(lastImage, key, slot, encodeImage(inst)))
        imageWrites.push({ idx: slot, value: inst });
      imageDraws.push({ slot, src: n.value.src });
    }

    // A fill's own outline is the construction stroke width, like every edge —
    // and it straddles the boundary, so half of it sits outside the silhouette.
    const edgeWidthPx = strokePx;

    /**
     * One pooled record per stroke node, staged only if its inputs moved.
     *
     * The record says what is true of the node — its run, its half width, and the
     * state word both shaders derive the rest of the layer from — while the band
     * says which layer is drawing. That is what turns three records per stroke
     * into one, and why a hover moves a state word rather than rebuilding a
     * record's geometry.
     */
    const emitStrokeInk = (n: TraceNode, state: InkState): void => {
      const ends = strokeEndpoints(n, cam, size);
      if (!ends) return;
      const slot = strokePool.alloc(nodeKey(n), 1);
      if (slot === undefined) return;
      const hot = state !== "rest";
      const selected = state === "lifted";
      const word = stateWord(n, hot, selected, input.muted(n) && !hot);
      writeStrokeSig(strokeSig, ends.a, ends.b, halfStrokePx, word);
      strokeFill.a = ends.a;
      strokeFill.b = ends.b;
      strokeFill.halfPx = halfStrokePx;
      strokeFill.state = word;
      strokeRecords.touch(slot, strokeSig, fillStroke, strokeFill);
      queue(strokeLists, bandsFor(state, input.showHalos), slot);
    };
    /**
     * A circle still keeps one record per layer: its three bands carry what a
     * stroke's single record would have to derive (a half width, a colour, an
     * alpha each), and its geometry is analytic rather than a record of two
     * endpoints. The shared layer numbers map to its slots through `inkSlotOf`,
     * so there is still only one numbering.
     */
    const emitCircleInk = (n: TraceNode, state: InkState): void => {
      const start = circlePool.alloc(nodeKey(n), INK_LAYER_COUNT);
      if (start === undefined) return;
      const hot = state !== "rest";
      const selected = state === "lifted";
      const muted = input.muted(n) && !hot;
      const v = n.value as Circle;
      circleFill.center.x = v.center.x;
      circleFill.center.y = v.center.y;
      circleFill.radius = Math.abs(v.radius);
      circleFill.a0 = 0;
      circleFill.a1 = TAU;
      const haloAlpha = selected
        ? DEFAULT_CHROME_METRICS.selectOutlineOpacity
        : DEFAULT_CHROME_METRICS.hoverOutlineOpacity;
      const paintColor = hot ? colors.selectedPaint : n.editable ? colors.accent : colors.ink;
      /** Stage one layer: its own numbers are the signature, so a circle that did
       * not move costs three comparisons instead of three built records. */
      const disc = (layer: number, halfPx: number, color: Rgb, alpha: number): void => {
        circleFill.halfPx = halfPx;
        circleFill.color = color;
        circleFill.alpha = alpha;
        writeCircleSig(circleSig, circleFill);
        circleRecords.touch(start + inkSlotOf(layer), circleSig, fillCircle, circleFill);
      };
      disc(LAYER_HALO, hot ? outlineHalfPx : -1, colors.ring, haloAlpha);
      disc(LAYER_KNOCKOUT, selected ? knockoutHalfPx : -1, colors.paper, 1);
      disc(LAYER_PAINT, halfStrokePx, paintColor, muted ? MUTED_ALPHA : 1);
      for (const band of bandsFor(state, input.showHalos)) {
        for (const layer of CIRCLE_BAND_LAYERS[band]) {
          // The layer's own half width says whether it draws at all; the sign of
          // the cull value is never in the record.
          const halfPx =
            layer === LAYER_HALO
              ? hot
                ? outlineHalfPx
                : -1
              : layer === LAYER_KNOCKOUT
                ? selected
                  ? knockoutHalfPx
                  : -1
                : halfStrokePx;
          if (halfPx > 0) circleLists[band]!.push(start + inkSlotOf(layer));
        }
      }
    };
    const emitInk = (n: TraceNode, state: InkState): void =>
      n.value.kind === "circle" ? emitCircleInk(n, state) : emitStrokeInk(n, state);
    for (const n of inkBand.rest) emitInk(n, "rest");
    for (const n of inkBand.hover) emitInk(n, "hover");
    for (const n of inkBand.lifted) emitInk(n, "lifted");

    // --- fills (rest → hover → lifted). A `csg2` tree whose operands are all
    // --- single scalar fields is drawn by the compiled-field pass (no island
    // --- resolution, exact arcs, data-only uploads); everything else — regions,
    // --- polygons, picks — keeps the span pass. Fills are translucent, so the
    // --- two passes are drawn per node in band order (see `fillDraws`), and a
    // --- hot node's halo run is queued *after* its paint run: the halo band
    // --- knocks the fill out rather than being washed by it.
    const fillOrder: number[] = [];
    const fieldOrder: number[] = [];
    const fillDraws: FillDraw[] = [];
    const visible = visibleWorldBox(cam, size);

    const fillBand = splitChrome(fills, (n) => isSelected(n, input.selectedKey), white);
    /** Paint runs of one band, each preceded by its halo run when it has one. */
    const emitFillBand = (nodes: readonly TraceNode[]) => {
      for (const n of nodes) {
        const hot = white(n);
        const selected = isSelected(n, input.selectedKey);
        const color = hot ? colors.selectedPaint : colors.ink;
        const alpha = hot ? 0.28 : 0.16;
        const halo =
          input.showHalos && hot
            ? haloWrites(selected, colors.ring, colors.paper, outlineHalfPx, knockoutHalfPx)
            : NO_HALO;
        // The fill's own outline carries the same state colors as every other
        // ink node (`inkClass`): accent while editable, cream while hot.
        const edge = edgeWrites(
          hot ? colors.selectedPaint : n.editable ? colors.accent : colors.ink,
          edgeWidthPx,
        );
        const plan = fieldPlan(n.value as CsgOperand);
        if (plan) {
          const draw = emitField(n, plan, color, alpha, edge, halo, visible);
          if (draw) {
            fieldOrder.push(draw.slot);
            const first = fieldOrder.length - 1;
            fillDraws.push({ path: "field", layer: "paint", first, count: 1, plan });
            if (halo.ring.w > 0) {
              fillDraws.push({ path: "field", layer: "halo", first, count: 1, plan });
            }
          }
          continue;
        }
        // Islands are finite: their AABB (and the quad's AA skirt, applied by
        // the shader) is world geometry the camera cannot move.
        const geom = islandGeomOf(n.value as Region | Polygon | CsgOperand);
        if (geom.spans.length === 0) {
          fillPool.alloc(nodeKey(n), 0);
          fillSegPool.alloc(nodeKey(n), 0);
          fillArcPool.alloc(nodeKey(n), 0);
          continue;
        }
        // Blocks concatenate in order, so the per-island windows of one kind are
        // contiguous runs: one pool allocation per kind, and every record in a
        // run staged against its own inputs — a node that moved one endpoint
        // uploads that span, not the polygon.
        const windows = blockWindows(geom.spans);
        const segs = geom.spans.flatMap((block) => block.segs);
        const arcs = geom.spans.flatMap((block) => block.arcs);
        const segStart = fillSegPool.alloc(nodeKey(n), segs.length);
        const arcStart = fillArcPool.alloc(nodeKey(n), arcs.length);
        const regionStart = fillPool.alloc(nodeKey(n), geom.spans.length);
        if (segStart === undefined || arcStart === undefined || regionStart === undefined) continue;
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i]!;
          writeSegSig(segSig, seg);
          fillSegRecords.touch(segStart + i, segSig, fillSeg, seg);
        }
        for (let i = 0; i < arcs.length; i++) {
          const arc = arcs[i]!;
          writeArcSig(arcSig, arc);
          fillArcRecords.touch(arcStart + i, arcSig, fillArc, arc);
        }
        for (let i = 0; i < geom.spans.length; i++) {
          regionFill.bounds = geom.bounds[i]!;
          regionFill.window = windows[i]!;
          regionFill.segBase = segStart;
          regionFill.arcBase = arcStart;
          regionFill.color = color;
          regionFill.alpha = alpha;
          regionFill.edge = edge;
          regionFill.halo = halo;
          writeRegionSig(fillSig, regionFill);
          fillRecords.touch(regionStart + i, fillSig, fillRegion, regionFill);
        }
        const first = fillOrder.length;
        for (let i = 0; i < geom.spans.length; i++) fillOrder.push(regionStart + i);
        fillDraws.push({ path: "spans", layer: "paint", first, count: geom.spans.length });
        if (halo.ring.w > 0) {
          fillDraws.push({ path: "spans", layer: "halo", first, count: geom.spans.length });
        }
      }
    };
    emitFillBand(fillBand.rest);
    emitFillBand(fillBand.hover);
    emitFillBand(fillBand.lifted);

    // --- points (SVG PointMark passes: rest dots, hover halo, hover dot,
    // --- lifted halos, lifted dots — each node's discs stack back-to-front)
    const pointLists = blankLists();
    const pointBand = splitChrome(
      points,
      (n) => isSelected(n, input.selectedKey),
      (n) => isHot(n, input.hoverKey, input.selectedKey),
    );
    /** One pooled record per mark, on the same bands as the strokes: the four
     * concentric discs are the mark's layers, and a band replays the two that
     * belong to it (rim+paint, or ring+knockout). */
    const emitPointInk = (n: TraceNode, state: InkState): void => {
      const at = pointCenter(n);
      if (!at) return;
      const slot = pointPool.alloc(nodeKey(n), 1);
      if (slot === undefined) return;
      const hot = state !== "rest";
      const selected = state === "lifted";
      const word = stateWord(n, hot, selected, input.muted(n) && !hot);
      const markRadiusPx = pointMarkRadius(n.editable) - POINT_RADIUS_TRIM_PX;
      writePointSig(pointSig, at, markRadiusPx, word);
      pointFill.at = at;
      pointFill.markRadiusPx = markRadiusPx;
      pointFill.state = word;
      pointRecords.touch(slot, pointSig, fillPoint, pointFill);
      queue(pointLists, bandsFor(state, input.showHalos), slot);
    };
    for (const n of pointBand.rest) emitPointInk(n, "rest");
    for (const n of pointBand.hover) emitPointInk(n, "hover");
    for (const n of pointBand.lifted) emitPointInk(n, "lifted");

    // Every record has been touched: the pools hand back the spans of the buffer
    // that moved, one write each, and say how many records those spans carry.
    const strokeRuns: RecordRun[] = [];
    const pointRuns: RecordRun[] = [];
    const fillRuns: RecordRun[] = [];
    const circleRuns: RecordRun[] = [];
    const fillSegRuns: RecordRun[] = [];
    const fillArcRuns: RecordRun[] = [];
    const quadRuns: RecordRun[] = [];
    const leafRuns: RecordRun[] = [];
    const fieldSegRuns: RecordRun[] = [];
    const fieldArcRuns: RecordRun[] = [];
    const strokeStaged = strokeRecords.flush((run) => strokeRuns.push(run));
    const pointStaged = pointRecords.flush((run) => pointRuns.push(run));
    const fillStaged = fillRecords.flush((run) => fillRuns.push(run));
    const circleStaged = circleRecords.flush((run) => circleRuns.push(run));
    const fillSegStaged = fillSegRecords.flush((run) => fillSegRuns.push(run));
    const fillArcStaged = fillArcRecords.flush((run) => fillArcRuns.push(run));
    const quadStaged = fieldQuadRecords.flush((run) => quadRuns.push(run));
    const leafStaged = fieldLeafRecords.flush((run) => leafRuns.push(run));
    const fieldSegStaged = fieldSegRecords.flush((run) => fieldSegRuns.push(run));
    const fieldArcStaged = fieldArcRecords.flush((run) => fieldArcRuns.push(run));

    return {
      strokes: { runs: strokeRuns, bands: bandArrays(strokeLists) },
      circles: { runs: circleRuns, bands: bandArrays(circleLists) },
      fills: { runs: fillRuns, order: Uint32Array.from(fillOrder), count: fillOrder.length },
      fillSegs: { runs: fillSegRuns },
      fillArcs: { runs: fillArcRuns },
      fields: {
        quads: { runs: quadRuns, order: Uint32Array.from(fieldOrder), count: fieldOrder.length },
        leaves: { runs: leafRuns },
        segs: { runs: fieldSegRuns },
        arcs: { runs: fieldArcRuns },
      },
      fillDraws,
      points: { runs: pointRuns, bands: bandArrays(pointLists) },
      images: { writes: imageWrites, draws: imageDraws },
      overlay,
      chrome: makeChromeValue(colors, strokePx),
      stats: {
        written:
          strokeStaged +
          circleStaged +
          fillStaged +
          fillSegStaged +
          fillArcStaged +
          quadStaged +
          leafStaged +
          fieldSegStaged +
          fieldArcStaged +
          imageWrites.length +
          pointStaged +
          overlay.under.strokes.length +
          overlay.under.circles.length +
          overlay.under.fills.length +
          overlay.over.strokes.length +
          overlay.over.circles.length +
          overlay.over.disks.length +
          overlay.over.markers.length +
          overlay.over.fills.length,
        total:
          strokePool.used +
          circlePool.used +
          fillPool.used +
          fillSegPool.used +
          fillArcPool.used +
          pointPool.used +
          fieldQuadPool.used +
          fieldLeafPool.used +
          fieldSegPool.used +
          fieldArcPool.used +
          imagePool.used,
      },
    };
  }

  /** One fill node on the compiled-field path: leaves + boundary spans into the
   * shared pools, one AABB quad, all byte-diffed so a drag rewrites only what
   * moved and never re-encodes the shader's inputs. */
  function emitField(
    n: TraceNode,
    plan: FieldPlan,
    color: Rgb,
    alpha: number,
    edge: EdgeFields,
    halo: HaloFields,
    visible: Box,
  ): { slot: number } | undefined {
    const instance = buildFieldInstance(plan);
    // The superset box is the field's own world extent, so it holds still under
    // a pan or a zoom; only a half-plane makes it unbounded, and that case is
    // clamped to the pane because a quad has to be finite. The AA skirt is a
    // screen-space width, so the vertex shader grows the quad instead (see
    // `QUAD_PAD_PX`). Culling is separate from the record — it only drops the
    // draw from the order.
    const raw = fieldBox(plan, instance);
    const box = Number.isFinite(raw.min.x) ? raw : clipBox(raw, visible);
    if (!box || !overlaps(box, visible)) {
      fieldQuadPool.alloc(nodeKey(n), 0);
      fieldLeafPool.alloc(nodeKey(n), 0);
      fieldSegPool.alloc(nodeKey(n), 0);
      fieldArcPool.alloc(nodeKey(n), 0);
      return undefined;
    }
    const leafStart = fieldLeafPool.alloc(nodeKey(n), instance.leaves.length);
    const segStart = fieldSegPool.alloc(nodeKey(n), instance.spans.segs.length);
    const arcStart = fieldArcPool.alloc(nodeKey(n), instance.spans.arcs.length);
    const slot = fieldQuadPool.alloc(nodeKey(n), 1);
    if (
      leafStart === undefined ||
      segStart === undefined ||
      arcStart === undefined ||
      slot === undefined
    ) {
      return undefined;
    }
    // Every record is signed from the same numbers that fill it, and the windows
    // it carries are the rebased ones — so a run that moves restages whatever
    // reads it, without comparing a byte.
    leafFill.segBase = segStart;
    leafFill.arcBase = arcStart;
    for (let i = 0; i < instance.leaves.length; i++) {
      leafFill.leaf = instance.leaves[i]!;
      writeLeafSig(leafSig, leafFill);
      fieldLeafRecords.touch(leafStart + i, leafSig, fillLeaf, leafFill);
    }
    const { segs, arcs } = instance.spans;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      writeSegSig(segSig, seg);
      fieldSegRecords.touch(segStart + i, segSig, fillSeg, seg);
    }
    for (let i = 0; i < arcs.length; i++) {
      const arc = arcs[i]!;
      writeArcSig(arcSig, arc);
      fieldArcRecords.touch(arcStart + i, arcSig, fillArc, arc);
    }
    quadFill.box = box;
    quadFill.leafBase = leafStart;
    quadFill.color = color;
    quadFill.alpha = alpha;
    quadFill.edge = edge;
    quadFill.halo = halo;
    writeQuadSig(quadSig, quadFill);
    fieldQuadRecords.touch(slot, quadSig, fillQuad, quadFill);
    return { slot };
  }

  function destroy() {
    circleRecords.reset();
    lastFillRegion.clear();
    lastFillSegs.clear();
    lastFillArcs.clear();
    lastFieldQuad.clear();
    lastFieldLeaf.clear();
    lastFieldSegs.clear();
    lastFieldArcs.clear();
    lastImage.clear();
    strokeRecords.reset();
    pointRecords.reset();
    strokePool.reset();
    circlePool.reset();
    fillPool.reset();
    fillSegPool.reset();
    fillArcPool.reset();
    pointPool.reset();
    fieldQuadPool.reset();
    fieldLeafPool.reset();
    fieldSegPool.reset();
    fieldArcPool.reset();
    imagePool.reset();
  }

  return { tick, destroy };
}

// -- geometry ---------------------------------------------------------------

/** Visible run of a stroke node: segment endpoints, or the pane-clipped
 * extent of an infinite line. Undefined for degenerate/unbounded geometry. */
function strokeEndpoints(
  n: TraceNode,
  cam: Camera2,
  size: PaneSize,
): { a: Vec2; b: Vec2 } | undefined {
  const v = n.value;
  if (v.kind === "segment") return { a: v.a, b: v.b };
  if (v.kind === "line" || v.kind === "parallelLine") {
    const axis = infiniteLineAxis(v);
    if (!axis) return undefined;
    return infiniteClip(axis.origin, axis.dir, cam, size);
  }
  return undefined;
}

// -- ink layers: inputs first, then pooled records ---------------------------

/** A released run's slots stop being that key's, so the pool that mirrors them
 * has to forget what it staged there: the next node to take the range stages
 * afresh whatever its own inputs are. */
function retireRun<T>(records: RecordPool<T>): SlotPoolOpts {
  return {
    onRelease: (_key, run) => {
      for (let i = 0; i < run.count; i++) records.retire(run.start + i);
    },
  };
}

/** A span-fill island's payload: the island's box and its two span windows, plus
 * the colour and the chrome its node gives every island. Reused per island, so
 * filling and signing one allocate nothing. */
type RegionFill = {
  bounds: Box;
  window: SpanWindow;
  /** The node's runs in the shared span arrays; the record carries the rebased
   * windows, so a run that moves restages. */
  segBase: number;
  arcBase: number;
  color: Rgb;
  alpha: number;
  edge: EdgeFields;
  halo: HaloFields;
};

/**
 * The two halves of one span-fill record: `writeRegionSig` puts its inputs in the
 * order the pool compares them, `fillRegion` puts the same inputs in the record.
 * They walk the same fields in the same order and live next to each other so a
 * field added to one is added to the other — a lane the signature does not carry
 * is a record that does not restage when it changes, which is a stale shape on
 * screen rather than a failing test. `recordPool.test.ts`'s replay checks the
 * bytes; `adapter.test.ts` changes each input in turn and checks that it stages.
 */
function writeRegionSig(sig: Float64Array, args: RegionFill): void {
  let i = 0;
  sig[i++] = args.bounds.min.x;
  sig[i++] = args.bounds.min.y;
  sig[i++] = args.bounds.max.x;
  sig[i++] = args.bounds.max.y;
  sig[i++] = args.segBase + args.window.segOffset;
  sig[i++] = args.window.segCount;
  sig[i++] = args.arcBase + args.window.arcOffset;
  sig[i++] = args.window.arcCount;
  sig[i++] = args.color[0];
  sig[i++] = args.color[1];
  sig[i++] = args.color[2];
  sig[i++] = args.alpha;
  i = encodeEdge(sig, i, args.edge);
  encodeHalo(sig, i, args.halo);
}

/** The lanes `writeRegionSig` fills: the record's own fields, minus `flags`,
 * which this path always writes as 0. */
const FILL_SIG_LANES = 27;

function fillRegion(record: FillRegionValue, args: RegionFill): void {
  const w = args.window;
  record.aabbMin.x = args.bounds.min.x;
  record.aabbMin.y = args.bounds.min.y;
  record.aabbMax.x = args.bounds.max.x;
  record.aabbMax.y = args.bounds.max.y;
  record.segOffset = args.segBase + w.segOffset;
  record.segCount = w.segCount;
  record.arcOffset = args.arcBase + w.arcOffset;
  record.arcCount = w.arcCount;
  record.color.r = args.color[0];
  record.color.g = args.color[1];
  record.color.b = args.color[2];
  record.alpha = args.alpha;
  record.flags = 0;
  record.edge.x = args.edge.color.x;
  record.edge.y = args.edge.color.y;
  record.edge.z = args.edge.color.z;
  record.edge.w = args.edge.color.w;
  record.edgeWidthPx = args.edge.halfPx;
  record.haloRing.x = args.halo.ring.x;
  record.haloRing.y = args.halo.ring.y;
  record.haloRing.z = args.halo.ring.z;
  record.haloRing.w = args.halo.ring.w;
  record.haloKnock.x = args.halo.knock.x;
  record.haloKnock.y = args.halo.knock.y;
  record.haloKnock.z = args.halo.knock.z;
  record.haloKnock.w = args.halo.knock.w;
  record.haloHalfPx.x = args.halo.halfPx.x;
  record.haloHalfPx.y = args.halo.halfPx.y;
}

function makeFillRegion(): FillRegionValue {
  return FillRegion({
    aabbMin: vec2f(0, 0),
    aabbMax: vec2f(0, 0),
    segOffset: 0,
    segCount: 0,
    arcOffset: 0,
    arcCount: 0,
    color: vec3f(0, 0, 0),
    alpha: 0,
    flags: 0,
    edge: vec4f(0, 0, 0, 0),
    edgeWidthPx: 0,
    haloRing: vec4f(0, 0, 0, 0),
    haloKnock: vec4f(0, 0, 0, 0),
    haloHalfPx: vec2f(0, 0),
  });
}

/** One boundary span: four numbers, and no carrier — that is the whole reason
 * segments and arcs are separate record kinds. */
function writeSegSig(sig: Float64Array, e: SpanSeg): void {
  sig[0] = e.a.x;
  sig[1] = e.a.y;
  sig[2] = e.b.x;
  sig[3] = e.b.y;
}

const SEG_SIG_LANES = 4;

function fillSeg(record: FillSegValue, e: SpanSeg): void {
  record.a.x = e.a.x;
  record.a.y = e.a.y;
  record.b.x = e.b.x;
  record.b.y = e.b.y;
}

function makeFillSeg(): FillSegValue {
  return FillSeg({ a: vec2f(0, 0), b: vec2f(0, 0) });
}

/** One arc boundary span: the endpoints, the carrier and the sweep. */
function writeArcSig(sig: Float64Array, e: SpanArc): void {
  sig[0] = e.a.x;
  sig[1] = e.a.y;
  sig[2] = e.b.x;
  sig[3] = e.b.y;
  sig[4] = e.center.x;
  sig[5] = e.center.y;
  sig[6] = e.radius;
  sig[7] = e.span;
}

const ARC_SIG_LANES = 8;

function fillArc(record: FillArcValue, e: SpanArc): void {
  record.a.x = e.a.x;
  record.a.y = e.a.y;
  record.b.x = e.b.x;
  record.b.y = e.b.y;
  record.center.x = e.center.x;
  record.center.y = e.center.y;
  record.radius = e.radius;
  record.span = e.span;
}

function makeFillArc(): FillArcValue {
  return FillArc({
    a: vec2f(0, 0),
    b: vec2f(0, 0),
    center: vec2f(0, 0),
    radius: 0,
    span: 0,
  });
}

/** A field leaf's payload: its primitive parameters and its *rebased* windows
 * into the shared span arrays. */
type LeafFill = {
  leaf: FieldLeafData;
  segBase: number;
  arcBase: number;
};

/** The leaves' signature and their record, field for field — see
 * `writeRegionSig` for why the two sit together. The windows are the rebased
 * ones the record carries, so a run that moves restages the leaf that reads it. */
function writeLeafSig(sig: Float64Array, args: LeafFill): void {
  const { leaf } = args;
  sig[0] = leaf.a.x;
  sig[1] = leaf.a.y;
  sig[2] = leaf.b.x;
  sig[3] = leaf.b.y;
  sig[4] = leaf.r;
  sig[5] = args.segBase + leaf.segOffset;
  sig[6] = leaf.segCount;
  sig[7] = args.arcBase + leaf.arcOffset;
  sig[8] = leaf.arcCount;
}

const LEAF_SIG_LANES = 9;

function fillLeaf(record: FieldLeafValue, args: LeafFill): void {
  const { leaf } = args;
  record.a.x = leaf.a.x;
  record.a.y = leaf.a.y;
  record.b.x = leaf.b.x;
  record.b.y = leaf.b.y;
  record.r = leaf.r;
  record.segOffset = args.segBase + leaf.segOffset;
  record.segCount = leaf.segCount;
  record.arcOffset = args.arcBase + leaf.arcOffset;
  record.arcCount = leaf.arcCount;
}

function makeFieldLeaf(): FieldLeafValue {
  return FieldLeaf({
    a: vec2f(0, 0),
    b: vec2f(0, 0),
    r: 0,
    segOffset: 0,
    segCount: 0,
    arcOffset: 0,
    arcCount: 0,
  });
}

/** A compiled field's quad: the box it covers, the leaf window it reads, and the
 * fill's colour and chrome. */
type QuadFill = {
  box: Box;
  leafBase: number;
  color: Rgb;
  alpha: number;
  edge: EdgeFields;
  halo: HaloFields;
};

function writeQuadSig(sig: Float64Array, args: QuadFill): void {
  let i = 0;
  sig[i++] = args.box.min.x;
  sig[i++] = args.box.min.y;
  sig[i++] = args.box.max.x;
  sig[i++] = args.box.max.y;
  sig[i++] = args.leafBase;
  sig[i++] = args.color[0];
  sig[i++] = args.color[1];
  sig[i++] = args.color[2];
  sig[i++] = args.alpha;
  i = encodeEdge(sig, i, args.edge);
  i = encodeHalo(sig, i, args.halo);
}

const QUAD_SIG_LANES = 23;

function fillQuad(record: FieldQuadValue, args: QuadFill): void {
  record.aabbMin.x = args.box.min.x;
  record.aabbMin.y = args.box.min.y;
  record.aabbMax.x = args.box.max.x;
  record.aabbMax.y = args.box.max.y;
  record.leafBase = args.leafBase;
  record.color.r = args.color[0];
  record.color.g = args.color[1];
  record.color.b = args.color[2];
  record.alpha = args.alpha;
  record.edge.x = args.edge.color.x;
  record.edge.y = args.edge.color.y;
  record.edge.z = args.edge.color.z;
  record.edge.w = args.edge.color.w;
  record.edgeWidthPx = args.edge.halfPx;
  record.haloRing.x = args.halo.ring.x;
  record.haloRing.y = args.halo.ring.y;
  record.haloRing.z = args.halo.ring.z;
  record.haloRing.w = args.halo.ring.w;
  record.haloKnock.x = args.halo.knock.x;
  record.haloKnock.y = args.halo.knock.y;
  record.haloKnock.z = args.halo.knock.z;
  record.haloKnock.w = args.halo.knock.w;
  record.haloHalfPx.x = args.halo.halfPx.x;
  record.haloHalfPx.y = args.halo.halfPx.y;
}

function makeFieldQuad(): FieldQuadValue {
  return FieldQuad({
    aabbMin: vec2f(0, 0),
    aabbMax: vec2f(0, 0),
    leafBase: 0,
    color: vec3f(0, 0, 0),
    alpha: 0,
    edge: vec4f(0, 0, 0, 0),
    edgeWidthPx: 0,
    haloRing: vec4f(0, 0, 0, 0),
    haloKnock: vec4f(0, 0, 0, 0),
    haloHalfPx: vec2f(0, 0),
  });
}

/** The state word a node's record carries. Both pooled shaders read it instead
 * of the geometry the old per-layer records encoded, so a hover, a select or an
 * editability flip moves a word rather than rebuilding a record's geometry. */
function stateWord(n: TraceNode, hot: boolean, selected: boolean, muted: boolean): number {
  let state = 0;
  if (hot) state |= STATE_HOT;
  if (selected) state |= STATE_SELECTED;
  if (n.editable) state |= STATE_EDITABLE;
  if (muted) state |= STATE_MUTED;
  return state;
}

/** A pooled stroke record's payload: the run, and the state the shader derives
 * the rest of the layer from. Reused per node so filling one allocates nothing. */
type StrokeFill = { a: Vec2; b: Vec2; halfPx: number; state: number };

/** A pooled mark's payload. */
type PointFill = { at: Vec2; markRadiusPx: number; state: number };

/** Write one pooled stroke record in place. Colour and alpha stay empty: scene
 * ink derives both from the state, and the overlay's records — which fill them —
 * live in their own buffers. */
function fillStroke(record: StrokeNodeValue, args: StrokeFill): void {
  record.a.x = args.a.x;
  record.a.y = args.a.y;
  record.b.x = args.b.x;
  record.b.y = args.b.y;
  record.halfPx = args.halfPx;
  record.state = args.state;
}

/** Write one pooled mark record in place. The paint radius is the record's own,
 * because it is the one number the SVG's chrome recipe measures every layer's
 * offset from; the rest of the mark is the frame's. */
function fillPoint(record: PointNodeValue, args: PointFill): void {
  record.center.x = args.at.x;
  record.center.y = args.at.y;
  record.markRadiusPx = args.markRadiusPx;
  record.state = args.state;
}

/** Where a mark sits: a point's own position, or the spot a glider is on. */
function pointCenter(n: TraceNode): Vec2 | undefined {
  const v = n.value;
  if (v.kind === "point") return { x: v.x, y: v.y };
  return isGlider(v) ? gliderAt(v) : undefined;
}

/** A blank stroke record: the pool's `make`, called once per slot that ever
 * stages and mutated in place from then on. */
function makeStrokeNode(): StrokeNodeValue {
  return StrokeNode({
    a: vec2f(0, 0),
    b: vec2f(0, 0),
    halfPx: 0,
    state: 0,
    color: vec3f(0, 0, 0),
    alpha: 1,
  });
}

function makePointNode(): PointNodeValue {
  return PointNode({
    center: vec2f(0, 0),
    markRadiusPx: 0,
    state: 0,
    color: vec3f(0, 0, 0),
    alpha: 1,
  });
}

/** The per-tick order lists, one array per band, filled by the emission and
 * turned into the patch's `Uint32Array`s at the end of the tick. */
type InkLists = Record<InkBandName, number[]>;

function blankLists(): InkLists {
  return { rest: [], hoverHalo: [], hoverPaint: [], liftedHalo: [], liftedPaint: [] };
}

/** Queue a slot into every band its state draws in: `bandsFor` is the one place
 * that set is decided, and these lists are the only thing a draw reads. */
function queue(lists: InkLists, bands: readonly InkBandName[], slot: number): void {
  for (const band of bands) lists[band]!.push(slot);
}

function bandArrays(lists: InkLists): InkBands {
  const out = {} as InkBands;
  for (const band of INK_BAND_ORDER) out[band] = Uint32Array.from(lists[band]!);
  return out;
}

// -- signatures ---------------------------------------------------------------

/** Every number a stroke record is made of, and nothing else: compare these and
 * the upload is decided before anything is built. Scene ink's colour and alpha
 * are not here because the shader derives them from the state. */
const STROKE_SIG_LANES = 6;

function writeStrokeSig(sig: Float64Array, a: Vec2, b: Vec2, halfPx: number, state: number): void {
  sig[0] = a.x;
  sig[1] = a.y;
  sig[2] = b.x;
  sig[3] = b.y;
  sig[4] = halfPx;
  sig[5] = state;
}

const POINT_SIG_LANES = 4;

function writePointSig(sig: Float64Array, at: Vec2, markRadiusPx: number, state: number): void {
  sig[0] = at.x;
  sig[1] = at.y;
  sig[2] = markRadiusPx;
  sig[3] = state;
}

// -- pooled circle records ----------------------------------------------------

/** One circle layer's payload: the node's analytic geometry — which every layer
 * shares — and the layer's own width, colour and alpha. */
type CircleFill = {
  center: { x: number; y: number };
  radius: number;
  a0: number;
  a1: number;
  halfPx: number;
  color: Rgb;
  alpha: number;
  flags: number;
};

/** The layer's signature and its record, field for field — see
 * `writeRegionSig` for why the two sit together. */
function writeCircleSig(sig: Float64Array, args: CircleFill): void {
  let i = 0;
  sig[i++] = args.center.x;
  sig[i++] = args.center.y;
  sig[i++] = args.radius;
  sig[i++] = args.halfPx;
  sig[i++] = args.a0;
  sig[i++] = args.a1;
  sig[i++] = args.color[0];
  sig[i++] = args.color[1];
  sig[i++] = args.color[2];
  sig[i++] = args.alpha;
  sig[i++] = args.flags;
}

const CIRCLE_SIG_LANES = 11;

function fillCircle(record: CircleInstValue, args: CircleFill): void {
  record.center.x = args.center.x;
  record.center.y = args.center.y;
  record.radius = args.radius;
  record.halfPx = args.halfPx;
  record.a0 = args.a0;
  record.a1 = args.a1;
  record.color.r = args.color[0];
  record.color.g = args.color[1];
  record.color.b = args.color[2];
  record.alpha = args.alpha;
  record.flags = args.flags;
}

function makeCircleInst(): CircleInstValue {
  return CircleInst({
    center: vec2f(0, 0),
    radius: 0,
    halfPx: 0,
    a0: 0,
    a1: 0,
    color: vec3f(0, 0, 0),
    alpha: 0,
    flags: 0,
  });
}

// -- payload encoding (canonical float diffs) --------------------------------

/** Visible pane rectangle in world units — the clamp for unbounded fields. */
function visibleWorldBox(cam: Camera2, size: PaneSize): Box {
  const a = screenToWorld({ x: 0, y: 0 }, cam, size);
  const b = screenToWorld({ x: size.w, y: size.h }, cam, size);
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
  };
}

/** Do two boxes overlap? (The pane test that culls off-screen fields without
 * touching their records.) */
function overlaps(a: Box, b: Box): boolean {
  return a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y;
}

function clipBox(box: Box, clip: Box): Box | undefined {
  const out: Box = {
    min: { x: Math.max(box.min.x, clip.min.x), y: Math.max(box.min.y, clip.min.y) },
    max: { x: Math.min(box.max.x, clip.max.x), y: Math.min(box.max.y, clip.max.y) },
  };
  return out.min.x >= out.max.x || out.min.y >= out.max.y ? undefined : out;
}

/**
 * One reference quad: the four corners in strip order (`rot`/`flip` already
 * folded in by `eval/image.ts`), the three style dials, and — while the node is
 * hot — the *same* chrome a hot fill carries: `haloWrites` for the paper-backed
 * ring and its knockout gap, `edgeWrites` for the node's own outline in the
 * state colour every other node's ink uses.
 *
 * A cold reference carries neither. A fill's own outline is always on — ink
 * when cold — because it *is* the fill's ink; a reference has no ink, so a
 * border around every one of them would be noise.
 */
function imageInstance(
  value: ImageValue,
  colors: AdapterInput["colors"],
  hot: boolean,
  selected: boolean,
  showHalos: boolean,
  strokePx: number,
  outlineHalfPx: number,
  knockoutHalfPx: number,
): ImageInstValue {
  const [a, b, c, d] = imageQuad(value);
  const rect = imageRect(value);
  const halo =
    showHalos && hot
      ? haloWrites(selected, colors.ring, colors.paper, outlineHalfPx, knockoutHalfPx)
      : NO_HALO;
  const edge = edgeWrites(hot ? colors.selectedPaint : colors.ink, strokePx);
  return ImageInst({
    a: vec2f(a.x, a.y),
    b: vec2f(b.x, b.y),
    c: vec2f(c.x, c.y),
    d: vec2f(d.x, d.y),
    size: vec2f(rect.w, rect.h),
    style: ImageStyleFields({
      opacity: value.style.opacity,
      saturation: value.style.saturation,
      contrast: value.style.contrast,
    }),
    edge: vec4f(edge.color.x, edge.color.y, edge.color.z, hot ? 1 : 0),
    edgeWidthPx: edge.halfPx * 2,
    haloRing: halo.ring,
    haloKnock: halo.knock,
    haloHalfPx: halo.halfPx,
  });
}

function encodeImage(inst: ImageInstValue): Float64Array {
  const f = new Float64Array(28);
  let j = 0;
  f[j++] = inst.a.x;
  f[j++] = inst.a.y;
  f[j++] = inst.b.x;
  f[j++] = inst.b.y;
  f[j++] = inst.c.x;
  f[j++] = inst.c.y;
  f[j++] = inst.d.x;
  f[j++] = inst.d.y;
  f[j++] = inst.size.x;
  f[j++] = inst.size.y;
  // Field order follows `ImageStyleFields`, the schema the buffer was made from.
  f[j++] = inst.style.opacity;
  f[j++] = inst.style.saturation;
  f[j++] = inst.style.contrast;
  j = encodeEdge(f, j, { color: inst.edge, halfPx: inst.edgeWidthPx / 2 });
  encodeHalo(f, j, { ring: inst.haloRing, knock: inst.haloKnock, halfPx: inst.haloHalfPx });
  return f;
}

// -- edge + halo chrome ------------------------------------------------------

/** The fill's own outline: its state color and total width in CSS px, centred
 * on the boundary. */
type EdgeFields = { color: v4f; halfPx: number };

/** SVG's `inkClass` for a fill's stroke: `stroke-width: var(--oblik-stroke)`,
 * screen-space, straddling the boundary here. */
function edgeWrites(color: Rgb, halfPx: number): EdgeFields {
  return { color: vec4f(color[0], color[1], color[2], 1), halfPx };
}

/** Append an outline's floats to a change-check buffer. */
function encodeEdge(f: Float64Array, at: number, edge: EdgeFields): number {
  f[at] = edge.color.x;
  f[at + 1] = edge.color.y;
  f[at + 2] = edge.color.z;
  f[at + 3] = edge.color.w;
  f[at + 4] = edge.halfPx;
  return at + 5;
}

/** The halo fields of one fill node, exactly as the records store them. */
type HaloFields = { ring: v4f; knock: v4f; halfPx: v2f };

/** Cold nodes carry no halo: the bands' alphas are 0, so a stray halo run would
 * still draw nothing — this is only about not emitting the run at all. */
const NO_HALO: HaloFields = {
  ring: vec4f(0, 0, 0, 0),
  knock: vec4f(0, 0, 0, 0),
  halfPx: vec2f(0, 0),
};

/**
 * Halo chrome of one hot fill node, mirroring `chromeLayers()`: hover is the
 * accent outline alone at 50%, selection is the same outline opaque plus the
 * paper knockout band just inside it. Widths are the ink chrome's, in CSS px —
 * `outlinePx` from the fill's edge inward, then `knockoutPx` — so a hot fill
 * carries the
 * same weight as a hot edge, and the halo layer itself is opaque (it knocks the
 * fill's paint out from under the ring instead of being tinted by it).
 */
function haloWrites(
  selected: boolean,
  ring: Rgb,
  paper: Rgb,
  outlineHalfPx: number,
  knockoutHalfPx: number,
): HaloFields {
  const alpha = selected
    ? DEFAULT_CHROME_METRICS.selectOutlineOpacity
    : DEFAULT_CHROME_METRICS.hoverOutlineOpacity;
  return {
    ring: vec4f(ring[0], ring[1], ring[2], alpha),
    // The paper color is always carried: the outline band is paper-backed (that
    // is the knockout), and only the band *inside* the ring is conditional.
    knock: vec4f(paper[0], paper[1], paper[2], selected ? 1 : 0),
    halfPx: vec2f(selected ? knockoutHalfPx : 0, outlineHalfPx),
  };
}

/** Append a halo's floats to a change-check buffer. */
function encodeHalo(f: Float64Array, at: number, halo: HaloFields): number {
  let j = at;
  f[j++] = halo.ring.x;
  f[j++] = halo.ring.y;
  f[j++] = halo.ring.z;
  f[j++] = halo.ring.w;
  f[j++] = halo.knock.x;
  f[j++] = halo.knock.y;
  f[j++] = halo.knock.z;
  f[j++] = halo.knock.w;
  f[j++] = halo.halfPx.x;
  f[j] = halo.halfPx.y;
  return j + 1;
}
