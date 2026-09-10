import { vec2f, vec3f } from "typegpu/data";

import type { TraceNode } from "#eval/context";
import type { Circle, CsgOperand, Loop, LoopEdge, Polygon, Region, Vec2 } from "#geom";
import { isFillGeom } from "#geom/csg2";
import { evaluateRegions } from "#geom/evaluate-regions";
import { gliderAt, isGlider, type Glider } from "#geom/gliders";
import { infiniteLineAxis } from "#geom/ops";
import { circleDelta, isCircleWalk, tessellateWalk, walkEdges } from "#geom/region";

import { infiniteClip, type Camera2, type PaneSize } from "../../euclid2/camera";
import { isFiniteTrace } from "../../euclid2/pick";
import type { Ghost, PlaceHit } from "../../euclid2/tool";
import { DEFAULT_CHROME_METRICS, overlayBands, POINT_STROKE_PX } from "../../euclid2/view/chrome";
import { isHot, isSelected, splitChrome } from "../../euclid2/view/marks";
import { pointMarkRadius } from "../../euclid2/view/pointMark";
import { buildOverlay } from "./overlay";
import type { OverlayPatch } from "./overlay";
import type {
  CircleInstValue,
  FillEdgeValue,
  FillRegionValue,
  PointInstValue,
  StrokeDrawValue,
} from "./schemas";
import {
  CircleInst,
  FillEdge,
  FillRegion,
  MAX_POINTS,
  PointInst,
  RUN_GEOM_TWO_POINT,
  RUN_MUTED,
  StrokeCtrl,
  StrokeDraw,
  StrokeRun,
} from "./schemas";
import { createSlotPool } from "./slots";

const TAU = Math.PI * 2;
/** Muted (chrome.mutePoints/scope) opacity — matches the SVG `.muted` rule. */
const MUTED_ALPHA = 0.32;

/** Layered disc slots of one point/glider node, back-to-front: halo ring,
 * selected knockout, paper outline, paint. Culled layers carry radius <= 0. */
const POINT_DISC_COUNT = 4;
const RING = 0;
const KNOCKOUT = 1;
const OUTLINE = 2;
const PAINT = 3;

/** Layered draw slots of one ink (stroke/circle) node, back-to-front: halo
 * ring, selected knockout, paint. Culled layers carry radius <= 0. */
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
  hoverId: string | undefined;
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

export type TickPatch = {
  strokes: { writes: { idx: number; value: StrokeDrawValue }[]; bands: InkBands };
  circles: { writes: { idx: number; value: CircleInstValue }[]; bands: InkBands };
  fills: SlotPatch<FillRegionValue>;
  /** Edge blocks back the fill regions; no draw list of their own. */
  fillEdges: { writes: { idx: number; value: FillEdgeValue }[] };
  points: SlotPatch<PointInstValue>;
  /** Tool overlay (ghost previews + snap markers), rebuilt every tick. */
  overlay: OverlayPatch;
  stats: { written: number; total: number };
};

export type Adapter = {
  tick(input: AdapterInput): TickPatch;
  destroy(): void;
};

/** Fill geometry for one node: edge blocks (one per island) plus the island
 * AABB quad each block is drawn in. */
type IslandGeom = { edges: FillEdgeValue[][]; bounds: { min: Vec2; max: Vec2 }[] };

/** Track the last uploaded payload per key; true when the bytes changed. */
function diff(map: Map<object, Float64Array>, key: object, next: Float64Array): boolean {
  const prev = map.get(key);
  if (prev && prev.length === next.length) {
    let same = true;
    for (let i = 0; i < next.length; i++) {
      if (prev[i] !== next[i]) {
        same = false;
        break;
      }
    }
    if (same) return false;
  }
  map.set(key, next);
  return true;
}

export function createAdapter(): Adapter {
  const strokePool = createSlotPool(4096);
  const circlePool = createSlotPool(512);
  const fillPool = createSlotPool(256);
  const edgePool = createSlotPool(4096);
  const pointPool = createSlotPool(MAX_POINTS);

  /** Last uploaded payload per key, for CPU-side byte diffs. */
  const lastStroke = new Map<object, Float64Array>();
  const lastCircle = new Map<object, Float64Array>();
  const lastFillRegion = new Map<object, Float64Array>();
  const lastFillEdges = new Map<object, Float64Array>();
  const lastPoint = new Map<object, Float64Array>();

  function tick(input: AdapterInput): TickPatch {
    const { cam, size, colors, strokePx } = input;
    const scale = cam.scale;
    const halfStroke = strokePx / 2 / scale;

    const overlay = buildOverlay({
      ghost: input.ghost,
      snap:
        input.placing && !input.hideSnap && input.place && input.place.point.kind !== "free"
          ? input.place
          : undefined,
      cam,
      size,
      scale,
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
    const ink = finite.filter(
      (n) => n.kind !== "point" && !isGlider(n.value) && !isFillGeom(n.value),
    );
    // Mirrors the SVG view's `points()` memo: point nodes and gliders, never sliders.
    const points = finite.filter((n) => n.kind === "point" || isGlider(n.value));
    const present = new Set<object>([...ink, ...fills, ...points]);
    strokePool.sync(present);
    circlePool.sync(present);
    fillPool.sync(present);
    edgePool.sync(present);
    pointPool.sync(present);

    const white = (n: TraceNode) => isHot(n, input.hoverId, input.selectedKey);

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
    // Chrome bands sit at the same CSS px widths regardless of state (the
    // selected overlayBands pass is what points/ink chrome share upstream).
    const outlineHalf = overlayBands(strokePx, { selected: true }).outline / 2 / scale;
    const knockoutHalf = overlayBands(strokePx, { selected: true }).knockout / 2 / scale;

    const emitStrokeLayers = (n: TraceNode, layers: readonly number[], into: number[]): void => {
      const start = strokePool.alloc(n, INK_DISC_COUNT);
      if (start === undefined) return;
      const hot = white(n);
      const selected = isSelected(n, input.selectedKey);
      const discs = strokeInkDiscs(
        n,
        colors,
        halfStroke,
        outlineHalf,
        knockoutHalf,
        cam,
        size,
        hot,
        selected,
        input.muted(n) && !hot,
      );
      if (!discs) return;
      if (diff(lastStroke, n, encodeStrokes(discs))) {
        for (let i = 0; i < INK_DISC_COUNT; i++) {
          strokeWrites.push({ idx: start + i, value: discs[i]! });
        }
      }
      for (const layer of layers) {
        if (discs[layer]!.a.radius > 0) into.push(start + layer);
      }
    };
    const emitCircleLayers = (n: TraceNode, layers: readonly number[], into: number[]): void => {
      const start = circlePool.alloc(n, INK_DISC_COUNT);
      if (start === undefined) return;
      const hot = white(n);
      const selected = isSelected(n, input.selectedKey);
      const discs = circleInkDiscs(
        n,
        colors,
        halfStroke,
        outlineHalf,
        knockoutHalf,
        scale,
        hot,
        selected,
        input.muted(n) && !hot,
      );
      if (diff(lastCircle, n, encodeCircles(discs))) {
        for (let i = 0; i < INK_DISC_COUNT; i++) {
          circleWrites.push({ idx: start + i, value: discs[i]! });
        }
      }
      for (const layer of layers) {
        if (discs[layer]!.r1 > discs[layer]!.r0) into.push(start + layer);
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

    // --- fills (rest → hover → lifted) ---
    const fillWrites: { idx: number; value: FillRegionValue }[] = [];
    const fillOrder: number[] = [];
    const fillEdgeWrites: { idx: number; value: FillEdgeValue }[] = [];

    const fillBand = splitChrome(fills, (n) => isSelected(n, input.selectedKey), white);
    for (const n of [...fillBand.rest, ...fillBand.hover, ...fillBand.lifted]) {
      const lifted = white(n);
      const color = lifted ? colors.selectedPaint : colors.ink;
      const alpha = lifted ? 0.28 : 0.16;
      const geom = islandGeom(n, scale);
      if (geom.edges.length === 0) {
        fillPool.alloc(n, 0);
        edgePool.alloc(n, 0);
        continue;
      }
      const edgeTotal = geom.edges.reduce((sum, block) => sum + block.length, 0);
      const edgeStart = edgePool.alloc(n, edgeTotal);
      const regionStart = fillPool.alloc(n, geom.edges.length);
      if (edgeStart === undefined || regionStart === undefined) continue;
      if (diff(lastFillEdges, n, encodeFillEdges(geom.edges.flat()))) {
        let at = edgeStart;
        for (const block of geom.edges) {
          for (const e of block) {
            fillEdgeWrites.push({ idx: at, value: e });
            at++;
          }
        }
      }
      if (diff(lastFillRegion, n, encodeFillRegions(geom, color, alpha, edgeStart))) {
        geom.bounds.forEach((bounds, i) =>
          fillWrites.push({
            idx: regionStart + i,
            value: FillRegion({
              aabbMin: vec2f(bounds.min.x, bounds.min.y),
              aabbMax: vec2f(bounds.max.x, bounds.max.y),
              edgeOffset: edgeStart + blockOffset(geom.edges, i),
              edgeCount: geom.edges[i]!.length,
              color: vec3f(color[0], color[1], color[2]),
              alpha,
              flags: 0,
            }),
          }),
        );
      }
      for (let i = 0; i < geom.edges.length; i++) fillOrder.push(regionStart + i);
    }

    // --- points (SVG PointMark passes: rest dots, hover halo, hover dot,
    // --- lifted halos, lifted dots — each node's discs stack back-to-front)
    const pointWrites: { idx: number; value: PointInstValue }[] = [];
    const pointOrder: number[] = [];
    const pointBand = splitChrome(
      points,
      (n) => isSelected(n, input.selectedKey),
      (n) => isHot(n, input.hoverId, input.selectedKey),
    );
    /** Allocate a node's 4 disc slots, write changed discs, and queue the
     * back-to-front subset `layers` (only active discs reach the order). */
    const emitPointLayers = (n: TraceNode, layers: readonly number[]) => {
      const start = pointPool.alloc(n, POINT_DISC_COUNT);
      if (start === undefined) return;
      const discs = pointDiscsOf(
        n,
        input.colors,
        scale,
        isHot(n, input.hoverId, input.selectedKey),
        isSelected(n, input.selectedKey),
        input.muted(n) && !isHot(n, input.hoverId, input.selectedKey),
      );
      if (diff(lastPoint, n, encodePoints(discs))) {
        for (let i = 0; i < POINT_DISC_COUNT; i++) {
          pointWrites.push({ idx: start + i, value: discs[i]! });
        }
      }
      for (const layer of layers) {
        if (discs[layer]!.radius > 0) pointOrder.push(start + layer);
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
      fillEdges: { writes: fillEdgeWrites },
      points: {
        writes: pointWrites,
        order: Uint32Array.from(pointOrder),
        count: pointOrder.length,
      },
      overlay,
      stats: {
        written:
          strokeWrites.length +
          circleWrites.length +
          fillWrites.length +
          fillEdgeWrites.length +
          pointWrites.length +
          overlay.under.strokes.length +
          overlay.under.circles.length +
          overlay.under.fills.length +
          overlay.over.strokes.length +
          overlay.over.circles.length +
          overlay.over.disks.length +
          overlay.over.markers.length +
          overlay.over.fills.length,
        total: strokePool.used + circlePool.used + fillPool.used + edgePool.used + pointPool.used,
      },
    };
  }

  function encodeFillRegions(
    geom: IslandGeom,
    color: Rgb,
    alpha: number,
    edgeStart: number,
  ): Float64Array {
    const f = new Float64Array(geom.edges.length * 11);
    for (let i = 0; i < geom.edges.length; i++) {
      const b = geom.bounds[i]!;
      let j = i * 11;
      f[j++] = b.min.x;
      f[j++] = b.min.y;
      f[j++] = b.max.x;
      f[j++] = b.max.y;
      f[j++] = edgeStart + blockOffset(geom.edges, i);
      f[j++] = geom.edges[i]!.length;
      f[j++] = color[0];
      f[j++] = color[1];
      f[j++] = color[2];
      f[j++] = alpha;
      f[j] = 0;
    }
    return f;
  }

  function destroy() {
    lastStroke.clear();
    lastCircle.clear();
    lastFillRegion.clear();
    lastFillEdges.clear();
    lastPoint.clear();
    strokePool.reset();
    circlePool.reset();
    fillPool.reset();
    edgePool.reset();
    pointPool.reset();
  }

  return { tick, destroy };
}

function blockOffset(blocks: FillEdgeValue[][], i: number): number {
  let at = 0;
  for (let k = 0; k < i; k++) at += blocks[k]!.length;
  return at;
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
 * draw.b → draw.c, radius = half width. `radius <= 0` culls the draw. */
function twoPointStroke(
  ends: { a: Vec2; b: Vec2 },
  color: Rgb,
  alpha: number,
  radius: number,
): StrokeDrawValue {
  const ctrl = (p: Vec2) => StrokeCtrl({ position: vec2f(p.x, p.y), radius });
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
  radius: number,
): StrokeDrawValue | undefined {
  const ends = strokeEndpoints(n, cam, size);
  if (!ends) return undefined;
  const { a, b } = ends;
  return StrokeDraw({
    a: StrokeCtrl({ position: vec2f(2 * a.x - b.x, 2 * a.y - b.y), radius }),
    b: StrokeCtrl({ position: vec2f(a.x, a.y), radius }),
    c: StrokeCtrl({ position: vec2f(b.x, b.y), radius }),
    d: StrokeCtrl({ position: vec2f(2 * b.x - a.x, 2 * b.y - a.y), radius }),
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
 * (selected), paint. Inactive layers carry radius -1 and never reach the
 * draw order. Undefined when the node has no drawable run. */
function strokeInkDiscs(
  n: TraceNode,
  colors: AdapterInput["colors"],
  halfStroke: number,
  outlineHalf: number,
  knockoutHalf: number,
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
    halfStroke,
  );
  if (!paint) return undefined;
  const haloAlpha = selected
    ? DEFAULT_CHROME_METRICS.selectOutlineOpacity
    : DEFAULT_CHROME_METRICS.hoverOutlineOpacity;
  return [
    twoPointStroke(ends, colors.ring, haloAlpha, hot ? outlineHalf : -1),
    twoPointStroke(ends, colors.paper, 1, selected ? knockoutHalf : -1),
    paint,
  ];
}

/** The three layered annuli of one circle node (halo ring, knockout, paint);
 * inactive layers carry r1 <= r0 so the vertex shader culls them. */
function circleInkDiscs(
  n: TraceNode,
  colors: AdapterInput["colors"],
  halfStroke: number,
  outlineHalf: number,
  knockoutHalf: number,
  scale: number,
  hot: boolean,
  selected: boolean,
  muted: boolean,
): CircleInstValue[] {
  const v = n.value as Circle;
  const r = Math.abs(v.radius);
  const cx = v.center.x;
  const cy = v.center.y;
  const pieces = Math.max(32, Math.min(128, Math.ceil((TAU * r * scale) / 6)));
  const disc = (r0: number, r1: number, color: Rgb, alpha: number, flags = 0): CircleInstValue =>
    CircleInst({
      center: vec2f(cx, cy),
      r0,
      r1,
      a0: 0,
      a1: TAU,
      pieces,
      color: vec3f(color[0], color[1], color[2]),
      alpha,
      flags,
    });
  const haloAlpha = selected
    ? DEFAULT_CHROME_METRICS.selectOutlineOpacity
    : DEFAULT_CHROME_METRICS.hoverOutlineOpacity;
  const paintColor = hot ? colors.selectedPaint : n.editable ? colors.accent : colors.ink;
  return [
    disc(hot ? Math.max(0, r - outlineHalf) : 0, hot ? r + outlineHalf : 0, colors.ring, haloAlpha),
    disc(
      selected ? Math.max(0, r - knockoutHalf) : 0,
      selected ? r + knockoutHalf : 0,
      colors.paper,
      1,
    ),
    disc(
      r - halfStroke,
      r + halfStroke,
      paintColor,
      muted ? MUTED_ALPHA : 1,
      muted ? RUN_MUTED : 0,
    ),
  ];
}

/** Fill islands for a node: polygon nodes build their own region; everything
 * else compiles through evaluateRegions (WeakMap-cached). */
function islandsOf(n: TraceNode): Region[] {
  const v = n.value;
  if (v.kind === "polygon") {
    const p = v as Polygon;
    const outer: LoopEdge[] = chainEdges(p.boundary);
    if (outer.length === 0) return [];
    return [{ kind: "region", outer, holes: p.holes as Loop[] }];
  }
  return evaluateRegions(v as CsgOperand);
}

function chainEdges(points: readonly Vec2[]): LoopEdge[] {
  if (points.length < 2) return [];
  const edges: LoopEdge[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    edges.push({ a, b, carrier: { kind: "segment", a, b } });
  }
  return edges;
}

/** Normalized edges (outer CCW, holes CW) + padded AABB per island. */
function islandGeom(n: TraceNode, scale: number): IslandGeom {
  const pad = 2 / scale;
  const edges: FillEdgeValue[][] = [];
  const bounds: { min: Vec2; max: Vec2 }[] = [];
  for (const island of islandsOf(n)) {
    const loops = [island.outer, ...island.holes];
    const block: FillEdgeValue[] = [];
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i]!;
      const wantCw = i > 0;
      for (const edge of normalizedLoop(loop, wantCw)) {
        block.push(edge);
        grow(box, edge.a);
        grow(box, edge.b);
        if (edge.radius > 0) {
          grow(box, { x: edge.center.x - edge.radius, y: edge.center.y - edge.radius });
          grow(box, { x: edge.center.x + edge.radius, y: edge.center.y + edge.radius });
        }
      }
    }
    if (block.length === 0 || !Number.isFinite(box.minX)) continue;
    edges.push(block);
    bounds.push({
      min: { x: box.minX - pad, y: box.minY - pad },
      max: { x: box.maxX + pad, y: box.maxY + pad },
    });
  }
  return { edges, bounds };
}

function grow(box: { minX: number; minY: number; maxX: number; maxY: number }, p: Vec2) {
  box.minX = Math.min(box.minX, p.x);
  box.minY = Math.min(box.minY, p.y);
  box.maxX = Math.max(box.maxX, p.x);
  box.maxY = Math.max(box.maxY, p.y);
}

/** One island loop → fill edges, normalized: outer CCW, holes CW. */
function normalizedLoop(loop: Loop, wantCw: boolean): FillEdgeValue[] {
  if (isCircleWalk(loop)) {
    const r = Math.abs(loop.radius);
    const anchor = { x: loop.center.x + r, y: loop.center.y };
    // Full circle: positive sweep = CCW outer, negative = CW hole.
    return [
      FillEdge({
        a: vec2f(anchor.x, anchor.y),
        b: vec2f(anchor.x, anchor.y),
        center: vec2f(loop.center.x, loop.center.y),
        radius: r,
        span: wantCw ? -TAU : TAU,
      }),
    ];
  }
  const edges = walkEdges(loop);
  if (edges.length === 0) return [];
  const area = shoelace(tessellateWalk(loop));
  const reversed = area < 0 !== wantCw;
  const ordered = reversed ? reverseLoop(edges) : edges;
  return ordered.map((e) => fillEdge(e));
}

/** CCW-positive polygon area of a closed walk. */
function shoelace(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - a.y * b.x;
  }
  return sum / 2;
}

function reverseLoop(edges: readonly LoopEdge[]): LoopEdge[] {
  return edges.toReversed().map((e) => ({
    a: e.b,
    b: e.a,
    carrier: e.carrier,
    k: e.k === undefined ? undefined : e.k === 1 ? -1 : 1,
  }));
}

function fillEdge(e: LoopEdge): FillEdgeValue {
  if (e.carrier.kind === "circle") {
    const carrier = e.carrier as Circle;
    return FillEdge({
      a: vec2f(e.a.x, e.a.y),
      b: vec2f(e.b.x, e.b.y),
      center: vec2f(carrier.center.x, carrier.center.y),
      radius: Math.abs(carrier.radius),
      span: circleDelta(carrier, e.a, e.b, e.k ?? 1),
    });
  }
  return FillEdge({
    a: vec2f(e.a.x, e.a.y),
    b: vec2f(e.b.x, e.b.y),
    center: vec2f(0, 0),
    radius: -1,
    span: 0,
  });
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
 * (halo ring / knockout first — drawn under the mark). Radii are CSS px
 * converted to world units (1 CSS px = 1 / scale world units, matching
 * euclid2/camera.ts worldToScreen). Inactive layers carry radius -1 so the
 * vertex shader culls them; muted fades the mark (paint + paper outline)
 * like the SVG `.muted` element opacity. */
function pointDiscsOf(
  n: TraceNode,
  colors: AdapterInput["colors"],
  scale: number,
  hot: boolean,
  selected: boolean,
  muted: boolean,
): PointInstValue[] {
  const v = n.value;
  const at: Vec2 = v.kind === "point" ? { x: v.x, y: v.y } : gliderAt(v as Glider);
  const markR = (pointMarkRadius(n.editable) - POINT_RADIUS_TRIM_PX) / scale;
  const px = (half: number) => half / scale;
  const disc = (radius: number, color: Rgb, alpha: number): PointInstValue =>
    PointInst({
      center: vec2f(at.x, at.y),
      radius,
      color: vec3f(color[0], color[1], color[2]),
      alpha,
    });
  const markAlpha = muted ? MUTED_ALPHA : 1;
  const paintColor = hot ? colors.selectedPaint : n.editable ? colors.accent : colors.ink;
  return [
    // Halo ring: hover at 0.5, selected at 1.0 (chrome pointOutlinePx).
    disc(
      hot ? markR + px(DEFAULT_CHROME_METRICS.pointOutlinePx / 2) : -1,
      colors.ring,
      selected
        ? DEFAULT_CHROME_METRICS.selectOutlineOpacity
        : DEFAULT_CHROME_METRICS.hoverOutlineOpacity,
    ),
    // Selected knockout gap in paper (chrome pointKnockoutPx).
    disc(selected ? markR + px(DEFAULT_CHROME_METRICS.pointKnockoutPx / 2) : -1, colors.paper, 1),
    // Normal knockout: paper rim beneath the paint disc (SVG paint stroke,
    // POINT_STROKE_PX + 0.5).
    disc(markR + px(POINT_STROKE_PX / 2 + POINT_RIM_EXTRA_PX), colors.paper, markAlpha),
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
    f[i++] = c.radius;
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
  const f = new Float64Array(13);
  f[0] = v.center.x;
  f[1] = v.center.y;
  f[2] = v.r0;
  f[3] = v.r1;
  f[4] = v.a0;
  f[5] = v.a1;
  f[6] = v.pieces;
  f[7] = v.color.r;
  f[8] = v.color.g;
  f[9] = v.color.b;
  f[10] = v.alpha;
  f[11] = v.flags;
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
  const out = new Float64Array(discs.length * 13);
  let at = 0;
  for (const d of discs) {
    out.set(encodeCircle(d), at);
    at += 13;
  }
  return out;
}

function encodeFillEdges(edges: readonly FillEdgeValue[]): Float64Array {
  const f = new Float64Array(edges.length * 8);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
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

function encodePoints(discs: readonly PointInstValue[]): Float64Array {
  const f = new Float64Array(discs.length * 7);
  for (let i = 0; i < discs.length; i++) {
    const v = discs[i]!;
    let j = i * 7;
    f[j++] = v.center.x;
    f[j++] = v.center.y;
    f[j++] = v.radius;
    f[j++] = v.color.r;
    f[j++] = v.color.g;
    f[j++] = v.color.b;
    f[j] = v.alpha;
  }
  return f;
}
