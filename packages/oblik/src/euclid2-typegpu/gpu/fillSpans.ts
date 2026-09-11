import type { Circle, CsgOperand, Loop, LoopEdge, Polygon, Region, Vec2 } from "#geom";
import { evaluateRegions } from "#geom/evaluate-regions";
import { circleDelta, isCircleWalk, tessellateWalk, walkEdges } from "#geom/region";

const TAU = Math.PI * 2;

/** One straight boundary span: `a → b`. 16 B on the GPU, and nothing to test —
 * the record the fill walks spend nearly all their bandwidth on. */
export type SpanSeg = { a: Vec2; b: Vec2 };

/** One arc boundary span on a circle carrier: signed sweep `span`, `radius > 0`. */
export type SpanArc = { a: Vec2; b: Vec2; center: Vec2; radius: number; span: number };

/**
 * A fill's boundary, split by record kind — the two arrays the shaders loop
 * over. Neither the winding sum nor the nearest-boundary `min` depends on the
 * order spans are visited in, and nothing couples a segment to an arc, so the
 * split is free: a segment loop reads 16 B records and never branches on a
 * carrier it does not have.
 */
export type SpanSet = { segs: SpanSeg[]; arcs: SpanArc[] };

/** A window into a `SpanSet`'s arrays — exactly the GPU window fields. */
export type SpanWindow = {
  segOffset: number;
  segCount: number;
  arcOffset: number;
  arcCount: number;
};

export type Box = {
  min: { x: number; y: number };
  max: { x: number; y: number };
};

export type IslandGeom = { spans: SpanSet[]; bounds: Box[] };

export function emptySpans(): SpanSet {
  return { segs: [], arcs: [] };
}

/** An empty box (`min` above `max`); `grow` fills it in. */
export function newBox(): Box {
  return { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
}

export function grow(box: Box, p: Vec2): void {
  box.min.x = Math.min(box.min.x, p.x);
  box.min.y = Math.min(box.min.y, p.y);
  box.max.x = Math.max(box.max.x, p.x);
  box.max.y = Math.max(box.max.y, p.y);
}

/** Grow `box` over a span set — or one window of it. An arc covers its whole
 * carrier disc, which is what the fill quad has to enclose. */
export function growSpanBox(box: Box, spans: SpanSet, window?: SpanWindow): void {
  const segStart = window?.segOffset ?? 0;
  const segEnd = segStart + (window?.segCount ?? spans.segs.length);
  for (let i = segStart; i < segEnd; i++) {
    const e = spans.segs[i]!;
    grow(box, e.a);
    grow(box, e.b);
  }
  const arcStart = window?.arcOffset ?? 0;
  const arcEnd = arcStart + (window?.arcCount ?? spans.arcs.length);
  for (let i = arcStart; i < arcEnd; i++) {
    const e = spans.arcs[i]!;
    grow(box, e.a);
    grow(box, e.b);
    grow(box, { x: e.center.x - e.radius, y: e.center.y - e.radius });
    grow(box, { x: e.center.x + e.radius, y: e.center.y + e.radius });
  }
}

/** Push one loop edge as a fill span; `reversed` flips the record's direction
 * (outer CCW vs hole CW) and leaves the carrier alone. */
export function pushLoopSpan(out: SpanSet, e: LoopEdge, reversed = false): void {
  if (e.carrier.kind === "circle") {
    const carrier = e.carrier;
    const span = circleDelta(carrier, e.a, e.b, e.k ?? 1);
    out.arcs.push({
      a: reversed ? e.b : e.a,
      b: reversed ? e.a : e.b,
      center: carrier.center,
      radius: Math.abs(carrier.radius),
      span: reversed ? -span : span,
    });
    return;
  }
  out.segs.push(reversed ? { a: e.b, b: e.a } : { a: e.a, b: e.b });
}

/** Points of a polygon boundary as a closed chain of segment edges. */
export function chainEdges(points: readonly Vec2[]): LoopEdge[] {
  if (points.length < 2) return [];
  const edges: LoopEdge[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    edges.push({ a, b, carrier: { kind: "segment", a, b } });
  }
  return edges;
}

/** Fill islands for a fill value: polygon nodes build their own region,
 * everything else compiles through `evaluateRegions` (WeakMap-cached). */
export function islandsOfValue(value: Region | Polygon | CsgOperand): Region[] {
  if (value.kind === "polygon") {
    const p = value;
    const outer = chainEdges(p.boundary);
    if (outer.length === 0) return [];
    return [{ kind: "region", outer, holes: p.holes }];
  }
  return evaluateRegions(value);
}

/** One island's loops → fill spans, normalized: outer CCW, holes CW. */
export function islandSpans(island: Region): SpanSet {
  const out = emptySpans();
  const loops = [island.outer, ...island.holes];
  for (let i = 0; i < loops.length; i++) pushLoop(out, loops[i]!, i > 0);
  return out;
}

/** Normalized spans (outer CCW, holes CW) + tight AABB per island. The AA
 * skirt is deliberately not baked in: it is a screen-space width, so the quad
 * vertex shader grows the box instead (`QUAD_PAD_PX`), which keeps the bounds
 * pure world geometry that no zoom can move. */
export function islandGeomOf(value: Region | Polygon | CsgOperand): IslandGeom {
  const spans: SpanSet[] = [];
  const bounds: Box[] = [];
  for (const island of islandsOfValue(value)) {
    const islandSet = islandSpans(island);
    if (islandSet.segs.length === 0 && islandSet.arcs.length === 0) continue;
    const box = newBox();
    growSpanBox(box, islandSet);
    if (!Number.isFinite(box.min.x)) continue;
    spans.push(islandSet);
    bounds.push(box);
  }
  return { spans, bounds };
}

/** Window of each block in the concatenation of the blocks per kind — the GPU
 * `segOffset`/`arcOffset` pair an island's region record carries. */
export function blockWindows(blocks: readonly SpanSet[]): SpanWindow[] {
  const out: SpanWindow[] = [];
  let seg = 0;
  let arc = 0;
  for (const block of blocks) {
    out.push({
      segOffset: seg,
      segCount: block.segs.length,
      arcOffset: arc,
      arcCount: block.arcs.length,
    });
    seg += block.segs.length;
    arc += block.arcs.length;
  }
  return out;
}

// -- loop normalization ------------------------------------------------------

/** One island loop → fill spans, normalized: outer CCW, holes CW. */
function pushLoop(out: SpanSet, loop: Loop, wantCw: boolean): void {
  if (isCircleWalk(loop)) {
    pushCircleWalk(out, loop, wantCw);
    return;
  }
  const edges = walkEdges(loop);
  if (edges.length === 0) return;
  const area = shoelace(tessellateWalk(loop));
  const reversed = area < 0 !== wantCw;
  for (const e of edges) pushLoopSpan(out, e, reversed);
}

/** Full circle: positive sweep = CCW outer, negative = CW hole. */
function pushCircleWalk(out: SpanSet, circle: Circle, wantCw: boolean): void {
  const radius = Math.abs(circle.radius);
  const anchor = { x: circle.center.x + radius, y: circle.center.y };
  out.arcs.push({
    a: anchor,
    b: anchor,
    center: circle.center,
    radius,
    span: wantCw ? -TAU : TAU,
  });
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
