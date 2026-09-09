import type { TraceNode } from "#eval/context";
import type { Circle, CsgOperand, Loop, LoopEdge, Polygon, Region, Vec2 } from "#geom";
import { isFillGeom } from "#geom/csg2";
import { evaluateRegions } from "#geom/evaluate-regions";
import { isGlider } from "#geom/gliders";
import { infiniteLineAxis } from "#geom/ops";
import { circleDelta, isCircleWalk, tessellateWalk, walkEdges } from "#geom/region";
import { vec2f, vec3f } from "typegpu/data";

import { infiniteClip, type Camera2, type PaneSize } from "../../euclid2/camera";
import { isFiniteTrace } from "../../euclid2/pick";
import { isHot, isSelected, splitChrome } from "../../euclid2/view/marks";

import type { CircleInstValue, FillEdgeValue, FillRegionValue, StrokeDrawValue } from "./schemas";
import { CircleInst, FillEdge, FillRegion, RUN_MUTED, StrokeCtrl, StrokeDraw, StrokeRun } from "./schemas";
import { createSlotPool } from "./slots";

const TAU = Math.PI * 2;

export type Rgb = readonly [number, number, number];

export type AdapterInput = {
  trace: readonly TraceNode[];
  cam: Camera2;
  size: PaneSize;
  colors: { ink: Rgb; accent: Rgb; selectedPaint: Rgb };
  /** Construction paint width in CSS px (half of it is the ctrl radius). */
  strokePx: number;
  hoverId: string | undefined;
  selectedKey: string | undefined;
  hideFills: boolean;
  muted: (n: TraceNode) => boolean;
};

export type SlotPatch<T> = {
  writes: { idx: number; value: T }[];
  order: Uint32Array;
  count: number;
};

export type TickPatch = {
  strokes: SlotPatch<StrokeDrawValue>;
  circles: SlotPatch<CircleInstValue>;
  fills: SlotPatch<FillRegionValue>;
  /** Edge blocks back the fill regions; no draw list of their own. */
  fillEdges: { writes: { idx: number; value: FillEdgeValue }[] };
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

  /** Last uploaded payload per key, for CPU-side byte diffs. */
  const lastStroke = new Map<object, Float64Array>();
  const lastCircle = new Map<object, Float64Array>();
  const lastFillRegion = new Map<object, Float64Array>();
  const lastFillEdges = new Map<object, Float64Array>();

  function tick(input: AdapterInput): TickPatch {
    const { cam, size, colors, strokePx } = input;
    const scale = cam.scale;
    const halfStroke = strokePx / 2 / scale;

    const finite = input.trace.filter((n) => isFiniteTrace(n) && n.kind !== "slider");
    const fills = input.hideFills ? [] : finite.filter((n) => isFillGeom(n.value));
    const ink = finite.filter(
      (n) => n.kind !== "point" && !isGlider(n.value) && !isFillGeom(n.value),
    );
    const present = new Set<object>([...ink, ...fills]);
    strokePool.sync(present);
    circlePool.sync(present);
    fillPool.sync(present);
    edgePool.sync(present);

    const white = (n: TraceNode) => isHot(n, input.hoverId, input.selectedKey);

    // --- strokes + circles (ink band, rest → hover → lifted) ---
    const strokeWrites: { idx: number; value: StrokeDrawValue }[] = [];
    const strokeOrder: number[] = [];
    const circleWrites: { idx: number; value: CircleInstValue }[] = [];
    const circleOrder: number[] = [];

    const inkBand = splitChrome(ink, (n) => isSelected(n, input.selectedKey), white);
    for (const n of [...inkBand.rest, ...inkBand.hover, ...inkBand.lifted]) {
      const lifted = white(n);
      const muted = input.muted(n) && !lifted;
      const editable = n.editable && !lifted;
      const color = lifted ? colors.selectedPaint : editable ? colors.accent : colors.ink;
      const alpha = muted ? 0.32 : 1;
      const flags = muted ? RUN_MUTED : 0;
      const v = n.value;
      if (v.kind === "circle") {
        const r = Math.abs(v.radius);
        const pieces = Math.max(8, Math.min(128, Math.ceil((TAU * r * scale) / 6)));
        const value = CircleInst({
          center: vec2f(v.center.x, v.center.y),
          r0: r - halfStroke,
          r1: r + halfStroke,
          a0: 0,
          a1: TAU,
          pieces,
          color: vec3f(color[0], color[1], color[2]),
          alpha,
          flags,
        });
        const start = circlePool.alloc(n, 1);
        if (start === undefined) continue;
        if (diff(lastCircle, n, encodeCircle(value))) {
          circleWrites.push({ idx: start, value });
        }
        circleOrder.push(start);
      } else {
        const value = strokeValue(n, color, alpha, flags, cam, size, halfStroke);
        if (!value) continue;
        const start = strokePool.alloc(n, 1);
        if (start === undefined) continue;
        if (diff(lastStroke, n, encodeStroke(value))) {
          strokeWrites.push({ idx: start, value });
        }
        strokeOrder.push(start);
      }
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

    return {
      strokes: {
        writes: strokeWrites,
        order: Uint32Array.from(strokeOrder),
        count: strokeOrder.length,
      },
      circles: {
        writes: circleWrites,
        order: Uint32Array.from(circleOrder),
        count: circleOrder.length,
      },
      fills: {
        writes: fillWrites,
        order: Uint32Array.from(fillOrder),
        count: fillOrder.length,
      },
      fillEdges: { writes: fillEdgeWrites },
      stats: {
        written:
          strokeWrites.length + circleWrites.length + fillWrites.length + fillEdgeWrites.length,
        total: strokePool.used + circlePool.used + fillPool.used + edgePool.used,
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
    strokePool.reset();
    circlePool.reset();
    fillPool.reset();
    edgePool.reset();
  }

  return { tick, destroy };
}

function blockOffset(blocks: FillEdgeValue[][], i: number): number {
  let at = 0;
  for (let k = 0; k < i; k++) at += blocks[k]!.length;
  return at;
}

// -- geometry ---------------------------------------------------------------

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
  const v = n.value;
  let a: Vec2;
  let b: Vec2;
  if (v.kind === "segment") {
    a = v.a;
    b = v.b;
  } else if (v.kind === "line" || v.kind === "parallelLine") {
    const axis = infiniteLineAxis(v);
    if (!axis) return undefined;
    const ends = infiniteClip(axis.origin, axis.dir, cam, size);
    a = ends.a;
    b = ends.b;
  } else {
    return undefined;
  }
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
