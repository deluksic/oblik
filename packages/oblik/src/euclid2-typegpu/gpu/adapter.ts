import { vec2f, vec3f, vec4f } from "typegpu/data";
import type { v2f, v4f } from "typegpu/data";

import type { TraceNode, TraceNodeOf } from "#eval/context";
import type { Circle, CsgOperand, Polygon, Region, Vec2 } from "#geom";
import { isFillGeom } from "#geom/csg2";
import { gliderAt, isGlider, type Glider } from "#geom/gliders";
import { infiniteLineAxis } from "#geom/ops";

import { infiniteClip, screenToWorld, type Camera2, type PaneSize } from "../../euclid2/camera";
import { isFiniteTrace } from "../../euclid2/pick";
import type { Ghost, PlaceHit } from "../../euclid2/tool";
import { DEFAULT_CHROME_METRICS, overlayBands, POINT_STROKE_PX } from "../../euclid2/view/chrome";
import { isHot, isSelected, splitChrome } from "../../euclid2/view/marks";
import { pointMarkRadius } from "../../euclid2/view/pointMark";
import { imageQuad, isImage, type ImageValue } from "../../eval/image";
import { buildFieldInstance, fieldBox, fieldPlan, type FieldPlan } from "./field/plan";
import {
  blockWindows,
  islandGeomOf,
  type Box,
  type IslandGeom,
  type SpanArc,
  type SpanSeg,
  type SpanWindow,
} from "./fillSpans";
import { buildOverlay } from "./overlay";
import type { OverlayPatch } from "./overlay";
import type {
  CircleInstValue,
  FieldLeafValue,
  FieldQuadValue,
  FillArcValue,
  FillRegionValue,
  FillSegValue,
  ImageInstValue,
  PointInstValue,
  StrokeDrawValue,
} from "./schemas";
import {
  CircleInst,
  FieldLeaf,
  FieldQuad,
  FillRegion,
  ImageInst,
  MAX_FIELD_ARCS,
  MAX_FIELD_LEAVES,
  MAX_FIELD_QUADS,
  MAX_FIELD_SEGS,
  MAX_FILL_ARCS,
  MAX_FILL_SEGS,
  MAX_IMAGES,
  MAX_POINTS,
  PointInst,
  RUN_GEOM_TWO_POINT,
  RUN_MUTED,
  StrokeCtrl,
  StrokeDraw,
  StrokeRun,
} from "./schemas";
import { createSlotPool } from "./slots";
import { pushArcWrites, pushSegWrites, type SpanWrite } from "./spanRecords";

const TAU = Math.PI * 2;
/** Muted (chrome.mutePoints/scope) opacity — matches the SVG `.muted` rule. */
const MUTED_ALPHA = 0.32;

/** Layered disc slots of one point/glider node, back-to-front: halo ring,
 * selected knockout, paper outline, paint. Culled layers carry radiusPx <= 0. */
const POINT_DISC_COUNT = 4;
const RING = 0;
const KNOCKOUT = 1;
const OUTLINE = 2;
const PAINT = 3;

/** Layered draw slots of one ink (stroke/circle) node, back-to-front: halo
 * ring, selected knockout, paint. Culled layers carry radiusPx <= 0. */
const INK_DISC_COUNT = 3;
const INK_HALO = 0;
const INK_KNOCKOUT = 1;
const INK_PAINT = 2;

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

/** Draw-order bands per ink kind, mirroring the SVG chrome pass order: rest
 * paints, hover halos, hover paints, lifted halos, lifted paints. The painter
 * plays these bands back-to-front per kind so a hovered/selected node's chrome
 * lands above every rest paint yet below points, and selected chrome lands
 * above hovered chrome regardless of shape kind. */
export type InkBands = {
  /** Paint draws of idle nodes. */
  rest: Uint32Array;
  /** Halo ring + knockout draws of hovered (not selected) nodes. */
  hoverHalo: Uint32Array;
  /** Paint draws of hovered (not selected) nodes. */
  hoverPaint: Uint32Array;
  /** Halo ring + knockout draws of selected nodes. */
  liftedHalo: Uint32Array;
  /** Paint draws of selected nodes. */
  liftedPaint: Uint32Array;
};

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
  strokes: { writes: { idx: number; value: StrokeDrawValue }[]; bands: InkBands };
  circles: { writes: { idx: number; value: CircleInstValue }[]; bands: InkBands };
  fills: SlotPatch<FillRegionValue>;
  /** Boundary spans backing the fill regions — one array per record kind, so the
   * fragment's segment loop never touches a carrier. No draws of their own. */
  fillSegs: { writes: SpanWrite<FillSegValue>[] };
  fillArcs: { writes: SpanWrite<FillArcValue>[] };
  /** CSG fills compiled to GPU fields: an AABB quad per node, the leaf records
   * it reads, and the boundary spans of its region leaves. */
  fields: {
    quads: SlotPatch<FieldQuadValue>;
    leaves: { writes: { idx: number; value: FieldLeafValue }[] };
    segs: { writes: SpanWrite<FillSegValue>[] };
    arcs: { writes: SpanWrite<FillArcValue>[] };
  };
  /** World fill draws, in band order (span fills and compiled fields mixed). */
  fillDraws: FillDraw[];
  points: SlotPatch<PointInstValue>;
  /** Raster references: one byte-diffed quad per node, plus the draw list that
   * pairs each slot with the source whose texture paints it. The adapter names
   * the source but never touches a bitmap — loading is the GPU layer's. */
  images: {
    writes: { idx: number; value: ImageInstValue }[];
    draws: { slot: number; src: string }[];
  };
  /** Tool overlay (ghost previews + snap markers), rebuilt every tick. */
  overlay: OverlayPatch;
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
  const strokePool = createSlotPool(4096);
  const circlePool = createSlotPool(512);
  const fillPool = createSlotPool(256);
  const fillSegPool = createSlotPool(MAX_FILL_SEGS);
  const fillArcPool = createSlotPool(MAX_FILL_ARCS);
  const pointPool = createSlotPool(MAX_POINTS);
  const fieldQuadPool = createSlotPool(MAX_FIELD_QUADS);
  const fieldLeafPool = createSlotPool(MAX_FIELD_LEAVES);
  const fieldSegPool = createSlotPool(MAX_FIELD_SEGS);
  const fieldArcPool = createSlotPool(MAX_FIELD_ARCS);
  const imagePool = createSlotPool(MAX_IMAGES);

  /** Last uploaded payload per key, for CPU-side byte diffs. */
  const lastStroke = new Map<string, Upload>();
  const lastCircle = new Map<string, Upload>();
  const lastFillRegion = new Map<string, Upload>();
  const lastFillSegs = new Map<string, Upload>();
  const lastFillArcs = new Map<string, Upload>();
  const lastPoint = new Map<string, Upload>();
  const lastFieldQuad = new Map<string, Upload>();
  const lastFieldLeaf = new Map<string, Upload>();
  const lastFieldSegs = new Map<string, Upload>();
  const lastFieldArcs = new Map<string, Upload>();
  const lastImage = new Map<string, Upload>();

  /** Every record above, for the per-tick prune below. */
  const uploads = [
    lastStroke,
    lastCircle,
    lastFillRegion,
    lastFillSegs,
    lastFillArcs,
    lastPoint,
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

    // --- references (the backdrop). One slot per node, in tape order; the
    // --- draw list pairs each slot with the source whose texture paints it.
    const imageWrites: { idx: number; value: ImageInstValue }[] = [];
    const imageDraws: { slot: number; src: string }[] = [];
    for (const n of images) {
      const key = nodeKey(n);
      const slot = imagePool.alloc(key, 1);
      if (slot === undefined) continue;
      const inst = imageInstance(n.value);
      if (diff(lastImage, key, slot, encodeImage(inst)))
        imageWrites.push({ idx: slot, value: inst });
      imageDraws.push({ slot, src: n.value.src });
    }

    const white = (n: TraceNode) => isHot(n, input.hoverKey, input.selectedKey);

    // --- strokes + circles (ink band). Five draw-order bands per kind mirror
    // --- the SVG chrome passes: rest paints, hover halos, hover paints,
    // --- lifted halos, lifted paints. The painter interleaves strokes and
    // --- circles within each band so chrome stacks per-state, not per-shape:
    // --- a hovered circle's paint sits under a selected edge's halo.
    const strokeWrites: { idx: number; value: StrokeDrawValue }[] = [];
    const strokeRest: number[] = [];
    const strokeHoverHalo: number[] = [];
    const strokeHoverPaint: number[] = [];
    const strokeLiftedHalo: number[] = [];
    const strokeLiftedPaint: number[] = [];
    const circleWrites: { idx: number; value: CircleInstValue }[] = [];
    const circleRest: number[] = [];
    const circleHoverHalo: number[] = [];
    const circleHoverPaint: number[] = [];
    const circleLiftedHalo: number[] = [];
    const circleLiftedPaint: number[] = [];

    const inkBand = splitChrome(ink, (n) => isSelected(n, input.selectedKey), white);
    // Every width below is CSS px, not world units: the shaders scale them by
    // the frame's zoom (`worldPerPx`), so the records hold nothing the camera
    // can change and zooming reprojects the world instead of rewriting it.
    const halfStrokePx = strokePx / 2;
    // Chrome bands sit at the same CSS px widths regardless of state (the
    // selected overlayBands pass is what points/ink chrome share upstream).
    const outlineHalfPx = overlayBands(strokePx, { selected: true }).outline / 2;
    const knockoutHalfPx = overlayBands(strokePx, { selected: true }).knockout / 2;
    // A fill's own outline is the construction stroke width, like every edge —
    // and it straddles the boundary, so half of it sits outside the silhouette.
    const edgeWidthPx = strokePx;

    const emitStrokeLayers = (n: TraceNode, layers: readonly number[], into: number[]): void => {
      const start = strokePool.alloc(nodeKey(n), INK_DISC_COUNT);
      if (start === undefined) return;
      const hot = white(n);
      const selected = isSelected(n, input.selectedKey);
      const discs = strokeInkDiscs(
        n,
        colors,
        halfStrokePx,
        outlineHalfPx,
        knockoutHalfPx,
        cam,
        size,
        hot,
        selected,
        input.muted(n) && !hot,
      );
      if (!discs) return;
      if (diff(lastStroke, nodeKey(n), start, encodeStrokes(discs))) {
        for (let i = 0; i < INK_DISC_COUNT; i++) {
          strokeWrites.push({ idx: start + i, value: discs[i]! });
        }
      }
      for (const layer of layers) {
        if (discs[layer]!.a.radiusPx > 0) into.push(start + layer);
      }
    };
    const emitCircleLayers = (n: TraceNode, layers: readonly number[], into: number[]): void => {
      const start = circlePool.alloc(nodeKey(n), INK_DISC_COUNT);
      if (start === undefined) return;
      const hot = white(n);
      const selected = isSelected(n, input.selectedKey);
      const discs = circleInkDiscs(
        n,
        colors,
        halfStrokePx,
        outlineHalfPx,
        knockoutHalfPx,
        hot,
        selected,
        input.muted(n) && !hot,
      );
      if (diff(lastCircle, nodeKey(n), start, encodeCircles(discs))) {
        for (let i = 0; i < INK_DISC_COUNT; i++) {
          circleWrites.push({ idx: start + i, value: discs[i]! });
        }
      }
      for (const layer of layers) {
        if (discs[layer]!.halfPx > 0) into.push(start + layer);
      }
    };
    const emitInk = (n: TraceNode, layers: readonly number[], sInto: number[], cInto: number[]) =>
      n.value.kind === "circle"
        ? emitCircleLayers(n, layers, cInto)
        : emitStrokeLayers(n, layers, sInto);
    // Halos off while dragging (SVG parity): the five chrome passes collapse
    // to paint-only rest/hover/lifted passes.
    const passes: { nodes: TraceNode[]; layers: readonly number[]; s: number[]; c: number[] }[] =
      input.showHalos
        ? [
            { nodes: inkBand.rest, layers: [INK_PAINT], s: strokeRest, c: circleRest },
            {
              nodes: inkBand.hover,
              layers: [INK_HALO, INK_KNOCKOUT],
              s: strokeHoverHalo,
              c: circleHoverHalo,
            },
            {
              nodes: inkBand.hover,
              layers: [INK_PAINT],
              s: strokeHoverPaint,
              c: circleHoverPaint,
            },
            {
              nodes: inkBand.lifted,
              layers: [INK_HALO, INK_KNOCKOUT],
              s: strokeLiftedHalo,
              c: circleLiftedHalo,
            },
            {
              nodes: inkBand.lifted,
              layers: [INK_PAINT],
              s: strokeLiftedPaint,
              c: circleLiftedPaint,
            },
          ]
        : [
            { nodes: inkBand.rest, layers: [INK_PAINT], s: strokeRest, c: circleRest },
            { nodes: inkBand.hover, layers: [INK_PAINT], s: strokeHoverPaint, c: circleHoverPaint },
            {
              nodes: inkBand.lifted,
              layers: [INK_PAINT],
              s: strokeLiftedPaint,
              c: circleLiftedPaint,
            },
          ];
    for (const pass of passes) {
      for (const n of pass.nodes) emitInk(n, pass.layers, pass.s, pass.c);
    }

    // --- fills (rest → hover → lifted). A `csg2` tree whose operands are all
    // --- single scalar fields is drawn by the compiled-field pass (no island
    // --- resolution, exact arcs, data-only uploads); everything else — regions,
    // --- polygons, picks — keeps the span pass. Fills are translucent, so the
    // --- two passes are drawn per node in band order (see `fillDraws`), and a
    // --- hot node's halo run is queued *after* its paint run: the halo band
    // --- knocks the fill out rather than being washed by it.
    const fillWrites: { idx: number; value: FillRegionValue }[] = [];
    const fillOrder: number[] = [];
    const fillSegWrites: SpanWrite<FillSegValue>[] = [];
    const fillArcWrites: SpanWrite<FillArcValue>[] = [];
    const fieldQuadWrites: { idx: number; value: FieldQuadValue }[] = [];
    const fieldOrder: number[] = [];
    const fieldLeafWrites: { idx: number; value: FieldLeafValue }[] = [];
    const fieldSegWrites: SpanWrite<FillSegValue>[] = [];
    const fieldArcWrites: SpanWrite<FillArcValue>[] = [];
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
          const draw = emitField(
            n,
            plan,
            color,
            alpha,
            edge,
            halo,
            visible,
            fieldQuadWrites,
            fieldLeafWrites,
            fieldSegWrites,
            fieldArcWrites,
          );
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
        // contiguous runs: one pool allocation per kind, one write sequence.
        const windows = blockWindows(geom.spans);
        const segs = geom.spans.flatMap((block) => block.segs);
        const arcs = geom.spans.flatMap((block) => block.arcs);
        const segStart = fillSegPool.alloc(nodeKey(n), segs.length);
        const arcStart = fillArcPool.alloc(nodeKey(n), arcs.length);
        const regionStart = fillPool.alloc(nodeKey(n), geom.spans.length);
        if (segStart === undefined || arcStart === undefined || regionStart === undefined) continue;
        if (diff(lastFillSegs, nodeKey(n), segStart, encodeSpanSegs(segs))) {
          pushSegWrites(fillSegWrites, segStart, segs);
        }
        if (diff(lastFillArcs, nodeKey(n), arcStart, encodeSpanArcs(arcs))) {
          pushArcWrites(fillArcWrites, arcStart, arcs);
        }
        if (
          diff(
            lastFillRegion,
            nodeKey(n),
            regionStart,
            encodeFillRegions(geom, windows, segStart, arcStart, color, alpha, edge, halo),
          )
        ) {
          geom.bounds.forEach((bounds, i) => {
            const w = windows[i]!;
            fillWrites.push({
              idx: regionStart + i,
              value: FillRegion({
                aabbMin: vec2f(bounds.min.x, bounds.min.y),
                aabbMax: vec2f(bounds.max.x, bounds.max.y),
                segOffset: segStart + w.segOffset,
                segCount: w.segCount,
                arcOffset: arcStart + w.arcOffset,
                arcCount: w.arcCount,
                color: vec3f(color[0], color[1], color[2]),
                alpha,
                flags: 0,
                edge: edge.color,
                edgeWidthPx: edge.halfPx,
                haloRing: halo.ring,
                haloKnock: halo.knock,
                haloHalfPx: halo.halfPx,
              }),
            });
          });
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
    const pointWrites: { idx: number; value: PointInstValue }[] = [];
    const pointOrder: number[] = [];
    const pointBand = splitChrome(
      points,
      (n) => isSelected(n, input.selectedKey),
      (n) => isHot(n, input.hoverKey, input.selectedKey),
    );
    /** Allocate a node's 4 disc slots, write changed discs, and queue the
     * back-to-front subset `layers` (only active discs reach the order). */
    const emitPointLayers = (n: TraceNode, layers: readonly number[]) => {
      const start = pointPool.alloc(nodeKey(n), POINT_DISC_COUNT);
      if (start === undefined) return;
      const discs = pointDiscsOf(
        n,
        input.colors,
        isHot(n, input.hoverKey, input.selectedKey),
        isSelected(n, input.selectedKey),
        input.muted(n) && !isHot(n, input.hoverKey, input.selectedKey),
      );
      if (diff(lastPoint, nodeKey(n), start, encodePoints(discs))) {
        for (let i = 0; i < POINT_DISC_COUNT; i++) {
          pointWrites.push({ idx: start + i, value: discs[i]! });
        }
      }
      for (const layer of layers) {
        if (discs[layer]!.radiusPx > 0) pointOrder.push(start + layer);
      }
    };
    // Back-to-front per SVG PointMark passes: a node's halo/knockout discs are
    // queued *before* its outline+paint so the chrome sits under the paint
    // (a halo disc is a full disc out to R+outline — drawn after the paint it
    // would cover the dot). While dragging, halos are skipped entirely.
    if (input.showHalos) {
      for (const n of pointBand.rest) emitPointLayers(n, [OUTLINE, PAINT]);
      for (const n of pointBand.hover) emitPointLayers(n, [RING, KNOCKOUT]);
      for (const n of pointBand.hover) emitPointLayers(n, [OUTLINE, PAINT]);
      for (const n of pointBand.lifted) emitPointLayers(n, [RING, KNOCKOUT]);
      for (const n of pointBand.lifted) emitPointLayers(n, [OUTLINE, PAINT]);
    } else {
      for (const n of pointBand.rest) emitPointLayers(n, [OUTLINE, PAINT]);
      for (const n of pointBand.hover) emitPointLayers(n, [OUTLINE, PAINT]);
      for (const n of pointBand.lifted) emitPointLayers(n, [OUTLINE, PAINT]);
    }

    return {
      strokes: {
        writes: strokeWrites,
        bands: {
          rest: Uint32Array.from(strokeRest),
          hoverHalo: Uint32Array.from(strokeHoverHalo),
          hoverPaint: Uint32Array.from(strokeHoverPaint),
          liftedHalo: Uint32Array.from(strokeLiftedHalo),
          liftedPaint: Uint32Array.from(strokeLiftedPaint),
        },
      },
      circles: {
        writes: circleWrites,
        bands: {
          rest: Uint32Array.from(circleRest),
          hoverHalo: Uint32Array.from(circleHoverHalo),
          hoverPaint: Uint32Array.from(circleHoverPaint),
          liftedHalo: Uint32Array.from(circleLiftedHalo),
          liftedPaint: Uint32Array.from(circleLiftedPaint),
        },
      },
      fills: {
        writes: fillWrites,
        order: Uint32Array.from(fillOrder),
        count: fillOrder.length,
      },
      fillSegs: { writes: fillSegWrites },
      fillArcs: { writes: fillArcWrites },
      fields: {
        quads: {
          writes: fieldQuadWrites,
          order: Uint32Array.from(fieldOrder),
          count: fieldOrder.length,
        },
        leaves: { writes: fieldLeafWrites },
        segs: { writes: fieldSegWrites },
        arcs: { writes: fieldArcWrites },
      },
      fillDraws,
      points: {
        writes: pointWrites,
        order: Uint32Array.from(pointOrder),
        count: pointOrder.length,
      },
      images: { writes: imageWrites, draws: imageDraws },
      overlay,
      stats: {
        written:
          strokeWrites.length +
          circleWrites.length +
          fillWrites.length +
          fillSegWrites.length +
          fillArcWrites.length +
          fieldQuadWrites.length +
          fieldLeafWrites.length +
          fieldSegWrites.length +
          fieldArcWrites.length +
          imageWrites.length +
          pointWrites.length +
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
    quadWrites: { idx: number; value: FieldQuadValue }[],
    leafWrites: { idx: number; value: FieldLeafValue }[],
    segWrites: SpanWrite<FillSegValue>[],
    arcWrites: SpanWrite<FillArcValue>[],
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
    const leaves = instance.leaves.map((leaf) =>
      FieldLeaf({
        a: vec2f(leaf.a.x, leaf.a.y),
        b: vec2f(leaf.b.x, leaf.b.y),
        r: leaf.r,
        // Span windows are rebased onto the shared arrays; the diff below
        // rewrites them when the pools move the runs.
        segOffset: segStart + leaf.segOffset,
        segCount: leaf.segCount,
        arcOffset: arcStart + leaf.arcOffset,
        arcCount: leaf.arcCount,
      }),
    );
    if (diff(lastFieldLeaf, nodeKey(n), leafStart, encodeFieldLeaves(leaves))) {
      leaves.forEach((value, i) => leafWrites.push({ idx: leafStart + i, value }));
    }
    const { segs, arcs } = instance.spans;
    if (segs.length > 0 && diff(lastFieldSegs, nodeKey(n), segStart, encodeSpanSegs(segs))) {
      pushSegWrites(segWrites, segStart, segs);
    }
    if (arcs.length > 0 && diff(lastFieldArcs, nodeKey(n), arcStart, encodeSpanArcs(arcs))) {
      pushArcWrites(arcWrites, arcStart, arcs);
    }
    const quad = FieldQuad({
      aabbMin: vec2f(box.min.x, box.min.y),
      aabbMax: vec2f(box.max.x, box.max.y),
      leafBase: leafStart,
      color: vec3f(color[0], color[1], color[2]),
      alpha,
      edge: edge.color,
      edgeWidthPx: edge.halfPx,
      haloRing: halo.ring,
      haloKnock: halo.knock,
      haloHalfPx: halo.halfPx,
    });
    if (diff(lastFieldQuad, nodeKey(n), slot, encodeFieldQuad(quad)))
      quadWrites.push({ idx: slot, value: quad });
    return { slot };
  }

  function destroy() {
    lastStroke.clear();
    lastCircle.clear();
    lastFillRegion.clear();
    lastFillSegs.clear();
    lastFillArcs.clear();
    lastPoint.clear();
    lastFieldQuad.clear();
    lastFieldLeaf.clear();
    lastFieldSegs.clear();
    lastFieldArcs.clear();
    lastImage.clear();
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

/** Round-capped two-point instance (lineVariableWidth geometry): endpoints at
 * draw.b → draw.c, radiusPx = half width in CSS px. `radiusPx <= 0` culls the
 * draw. */
function twoPointStroke(
  ends: { a: Vec2; b: Vec2 },
  color: Rgb,
  alpha: number,
  radiusPx: number,
): StrokeDrawValue {
  const ctrl = (p: Vec2) => StrokeCtrl({ position: vec2f(p.x, p.y), radiusPx });
  return StrokeDraw({
    a: ctrl(ends.a),
    b: ctrl(ends.a),
    c: ctrl(ends.b),
    d: ctrl(ends.b),
    run: StrokeRun({
      color: vec3f(color[0], color[1], color[2]),
      alpha,
      start: 0,
      count: 0,
      flags: RUN_GEOM_TWO_POINT,
    }),
  });
}

/** Stroked segment/line payload: one 4-ctrl instance, mirrored neighbors for
 * round caps (SVG `stroke-linecap: round` parity). */
function strokeValue(
  n: TraceNode,
  color: Rgb,
  alpha: number,
  flags: number,
  cam: Camera2,
  size: PaneSize,
  radiusPx: number,
): StrokeDrawValue | undefined {
  const ends = strokeEndpoints(n, cam, size);
  if (!ends) return undefined;
  const { a, b } = ends;
  return StrokeDraw({
    a: StrokeCtrl({ position: vec2f(2 * a.x - b.x, 2 * a.y - b.y), radiusPx }),
    b: StrokeCtrl({ position: vec2f(a.x, a.y), radiusPx }),
    c: StrokeCtrl({ position: vec2f(b.x, b.y), radiusPx }),
    d: StrokeCtrl({ position: vec2f(2 * b.x - a.x, 2 * b.y - a.y), radiusPx }),
    run: StrokeRun({
      color: vec3f(color[0], color[1], color[2]),
      alpha,
      start: 0,
      count: 0,
      flags,
    }),
  });
}

/** The three layered draws of one stroke node: halo ring (hot), knockout
 * (selected), paint. Inactive layers carry radiusPx -1 and never reach the
 * draw order. Undefined when the node has no drawable run. */
function strokeInkDiscs(
  n: TraceNode,
  colors: AdapterInput["colors"],
  halfStrokePx: number,
  outlineHalfPx: number,
  knockoutHalfPx: number,
  cam: Camera2,
  size: PaneSize,
  hot: boolean,
  selected: boolean,
  muted: boolean,
): StrokeDrawValue[] | undefined {
  const ends = strokeEndpoints(n, cam, size);
  if (!ends) return undefined;
  const paint = strokeValue(
    n,
    hot ? colors.selectedPaint : n.editable ? colors.accent : colors.ink,
    muted ? MUTED_ALPHA : 1,
    muted ? RUN_MUTED : 0,
    cam,
    size,
    halfStrokePx,
  );
  if (!paint) return undefined;
  const haloAlpha = selected
    ? DEFAULT_CHROME_METRICS.selectOutlineOpacity
    : DEFAULT_CHROME_METRICS.hoverOutlineOpacity;
  return [
    twoPointStroke(ends, colors.ring, haloAlpha, hot ? outlineHalfPx : -1),
    twoPointStroke(ends, colors.paper, 1, selected ? knockoutHalfPx : -1),
    paint,
  ];
}

/** The three layered annuli of one circle node (halo ring, knockout, paint),
 * all symmetric about the node's own world radius; inactive layers carry
 * `halfPx = -1` so the vertex shader culls them. The band width is CSS px and
 * the fan's piece count is derived from it and the zoom in the shader, so the
 * record holds no scale. */
function circleInkDiscs(
  n: TraceNode,
  colors: AdapterInput["colors"],
  halfPx: number,
  outlineHalfPx: number,
  knockoutHalfPx: number,
  hot: boolean,
  selected: boolean,
  muted: boolean,
): CircleInstValue[] {
  const v = n.value as Circle;
  const r = Math.abs(v.radius);
  const cx = v.center.x;
  const cy = v.center.y;
  const disc = (band: number, color: Rgb, alpha: number, flags = 0): CircleInstValue =>
    CircleInst({
      center: vec2f(cx, cy),
      radius: r,
      halfPx: band,
      a0: 0,
      a1: TAU,
      color: vec3f(color[0], color[1], color[2]),
      alpha,
      flags,
    });
  const haloAlpha = selected
    ? DEFAULT_CHROME_METRICS.selectOutlineOpacity
    : DEFAULT_CHROME_METRICS.hoverOutlineOpacity;
  const paintColor = hot ? colors.selectedPaint : n.editable ? colors.accent : colors.ink;
  return [
    disc(hot ? outlineHalfPx : -1, colors.ring, haloAlpha),
    disc(selected ? knockoutHalfPx : -1, colors.paper, 1),
    disc(halfPx, paintColor, muted ? MUTED_ALPHA : 1, muted ? RUN_MUTED : 0),
  ];
}

// -- point/glider marks (layered discs, mirrors euclid2 PointMark) ------------

/** GPU-only visual tuning over the shared SVG point metrics: paint dots read
 * ~1 CSS px large on the GPU, so each paint radius is trimmed by 1 CSS px
 * (most visible on the wider draggable dots); the always-on paper rim under
 * the paint (the "normal knockout", POINT_STROKE_PX) reads thin on the GPU,
 * so it is widened by 0.5 CSS px. The selected knockout gap and halo ring
 * keep their standard chrome widths. */
const POINT_RADIUS_TRIM_PX = 1;
const POINT_RIM_EXTRA_PX = 0.5;

/** The four concentric discs that compose one point mark, back-to-front
 * (halo ring / knockout first — drawn under the mark). Radii are CSS px; the
 * vertex shader converts them with the frame's zoom. Inactive layers carry
 * radius -1 so the vertex shader culls them; muted fades the mark (paint +
 * paper outline) like the SVG `.muted` element opacity. */
function pointDiscsOf(
  n: TraceNode,
  colors: AdapterInput["colors"],
  hot: boolean,
  selected: boolean,
  muted: boolean,
): PointInstValue[] {
  const v = n.value;
  const at: Vec2 = v.kind === "point" ? { x: v.x, y: v.y } : gliderAt(v as Glider);
  const markR = pointMarkRadius(n.editable) - POINT_RADIUS_TRIM_PX;
  const disc = (radiusPx: number, color: Rgb, alpha: number): PointInstValue =>
    PointInst({
      center: vec2f(at.x, at.y),
      radiusPx,
      color: vec3f(color[0], color[1], color[2]),
      alpha,
    });
  const markAlpha = muted ? MUTED_ALPHA : 1;
  const paintColor = hot ? colors.selectedPaint : n.editable ? colors.accent : colors.ink;
  return [
    // Halo ring: hover at 0.5, selected at 1.0 (chrome pointOutlinePx).
    disc(
      hot ? markR + DEFAULT_CHROME_METRICS.pointOutlinePx / 2 : -1,
      colors.ring,
      selected
        ? DEFAULT_CHROME_METRICS.selectOutlineOpacity
        : DEFAULT_CHROME_METRICS.hoverOutlineOpacity,
    ),
    // Selected knockout gap in paper (chrome pointKnockoutPx).
    disc(selected ? markR + DEFAULT_CHROME_METRICS.pointKnockoutPx / 2 : -1, colors.paper, 1),
    // Normal knockout: paper rim beneath the paint disc (SVG paint stroke,
    // POINT_STROKE_PX + 0.5).
    disc(markR + POINT_STROKE_PX / 2 + POINT_RIM_EXTRA_PX, colors.paper, markAlpha),
    // The paint disc itself.
    disc(markR, paintColor, markAlpha),
  ];
}

// -- payload encoding (canonical float diffs) --------------------------------

function encodeStroke(v: StrokeDrawValue): Float64Array {
  const f = new Float64Array(19);
  let i = 0;
  for (const c of [v.a, v.b, v.c, v.d]) {
    f[i++] = c.position.x;
    f[i++] = c.position.y;
    f[i++] = c.radiusPx;
  }
  f[i++] = v.run.color.r;
  f[i++] = v.run.color.g;
  f[i++] = v.run.color.b;
  f[i++] = v.run.alpha;
  f[i++] = v.run.start;
  f[i++] = v.run.count;
  f[i] = v.run.flags;
  return f;
}

function encodeCircle(v: CircleInstValue): Float64Array {
  const f = new Float64Array(12);
  f[0] = v.center.x;
  f[1] = v.center.y;
  f[2] = v.radius;
  f[3] = v.halfPx;
  f[4] = v.a0;
  f[5] = v.a1;
  f[6] = v.color.r;
  f[7] = v.color.g;
  f[8] = v.color.b;
  f[9] = v.alpha;
  f[10] = v.flags;
  return f;
}

/** Whole-node payload: the three layered draws of an ink stroke node. */
function encodeStrokes(draws: readonly StrokeDrawValue[]): Float64Array {
  const out = new Float64Array(draws.length * 19);
  let at = 0;
  for (const d of draws) {
    out.set(encodeStroke(d), at);
    at += 19;
  }
  return out;
}

/** Whole-node payload: the three layered annuli of a circle node. */
function encodeCircles(discs: readonly CircleInstValue[]): Float64Array {
  const out = new Float64Array(discs.length * 12);
  let at = 0;
  for (const d of discs) {
    out.set(encodeCircle(d), at);
    at += 12;
  }
  return out;
}

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

/** Byte-encoded field quad for the change check: AABB, leaf window, color, halo. */
function encodeFieldQuad(q: FieldQuadValue): Float64Array {
  return Float64Array.of(
    q.aabbMin.x,
    q.aabbMin.y,
    q.aabbMax.x,
    q.aabbMax.y,
    q.leafBase,
    q.color[0],
    q.color[1],
    q.color[2],
    q.alpha,
    q.edge.x,
    q.edge.y,
    q.edge.z,
    q.edge.w,
    q.edgeWidthPx,
    q.haloRing.x,
    q.haloRing.y,
    q.haloRing.z,
    q.haloRing.w,
    q.haloKnock.x,
    q.haloKnock.y,
    q.haloKnock.z,
    q.haloKnock.w,
    q.haloHalfPx.x,
    q.haloHalfPx.y,
  );
}

/** Byte-encoded leaf records for the change check (a, b, r, span windows). */
function encodeFieldLeaves(leaves: readonly FieldLeafValue[]): Float64Array {
  const f = new Float64Array(leaves.length * 9);
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    let j = i * 9;
    f[j++] = leaf.a.x;
    f[j++] = leaf.a.y;
    f[j++] = leaf.b.x;
    f[j++] = leaf.b.y;
    f[j++] = leaf.r;
    f[j++] = leaf.segOffset;
    f[j++] = leaf.segCount;
    f[j++] = leaf.arcOffset;
    f[j] = leaf.arcCount;
  }
  return f;
}

/** Byte-encoded fill regions for the change check: AABB, both span windows,
 * color and halo (a hover recolors the fill *and* lights its ring). */
function encodeFillRegions(
  geom: IslandGeom,
  windows: readonly SpanWindow[],
  segStart: number,
  arcStart: number,
  color: Rgb,
  alpha: number,
  edge: EdgeFields,
  halo: HaloFields,
): Float64Array {
  const f = new Float64Array(geom.spans.length * 28);
  for (let i = 0; i < geom.spans.length; i++) {
    const b = geom.bounds[i]!;
    const w = windows[i]!;
    let j = i * 28;
    f[j++] = b.min.x;
    f[j++] = b.min.y;
    f[j++] = b.max.x;
    f[j++] = b.max.y;
    f[j++] = segStart + w.segOffset;
    f[j++] = w.segCount;
    f[j++] = arcStart + w.arcOffset;
    f[j++] = w.arcCount;
    f[j++] = color[0];
    f[j++] = color[1];
    f[j++] = color[2];
    f[j++] = alpha;
    f[j++] = 0;
    j = encodeEdge(f, j, edge);
    j = encodeHalo(f, j, halo);
  }
  return f;
}

/** Byte-encoded segment records (a, b) — half the doubles the old combined
 * `FillEdge` encode walked, since a segment has no carrier to compare. */
function encodeSpanSegs(segs: readonly SpanSeg[]): Float64Array {
  const f = new Float64Array(segs.length * 4);
  for (let i = 0; i < segs.length; i++) {
    const e = segs[i]!;
    let j = i * 4;
    f[j++] = e.a.x;
    f[j++] = e.a.y;
    f[j++] = e.b.x;
    f[j] = e.b.y;
  }
  return f;
}

function encodeSpanArcs(arcs: readonly SpanArc[]): Float64Array {
  const f = new Float64Array(arcs.length * 8);
  for (let i = 0; i < arcs.length; i++) {
    const e = arcs[i]!;
    let j = i * 8;
    f[j++] = e.a.x;
    f[j++] = e.a.y;
    f[j++] = e.b.x;
    f[j++] = e.b.y;
    f[j++] = e.center.x;
    f[j++] = e.center.y;
    f[j++] = e.radius;
    f[j] = e.span;
  }
  return f;
}

/** One reference quad: the four corners in draw order (`rot`/`flip` already
 * folded in by `eval/image.ts`) plus the fade toward paper. */
function imageInstance(value: ImageValue): ImageInstValue {
  const [a, b, c, d] = imageQuad(value);
  return ImageInst({
    a: vec2f(a.x, a.y),
    b: vec2f(b.x, b.y),
    c: vec2f(c.x, c.y),
    d: vec2f(d.x, d.y),
    fade: value.fade,
  });
}

function encodeImage(inst: ImageInstValue): Float64Array {
  return Float64Array.of(
    inst.a.x,
    inst.a.y,
    inst.b.x,
    inst.b.y,
    inst.c.x,
    inst.c.y,
    inst.d.x,
    inst.d.y,
    inst.fade,
  );
}

function encodePoints(discs: readonly PointInstValue[]): Float64Array {
  const f = new Float64Array(discs.length * 7);
  for (let i = 0; i < discs.length; i++) {
    const v = discs[i]!;
    let j = i * 7;
    f[j++] = v.center.x;
    f[j++] = v.center.y;
    f[j++] = v.radiusPx;
    f[j++] = v.color.r;
    f[j++] = v.color.g;
    f[j++] = v.color.b;
    f[j] = v.alpha;
  }
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
