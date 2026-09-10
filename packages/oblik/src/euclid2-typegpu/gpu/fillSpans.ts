import type { CsgOperand, Loop, LoopEdge, Polygon, Region, Vec2 } from "#geom";
import { evaluateRegions } from "#geom/evaluate-regions";
import { circleDelta, isCircleWalk, tessellateWalk, walkEdges } from "#geom/region";

/** One fill boundary span, in world space: an arc on a circle carrier when
 * `radius > 0` (signed sweep `span`), a straight segment when `radius <= 0`.
 * Field-compatible with the GPU `FillEdge` struct — same names, plain `Vec2`s. */
export type SpanEdge = {
  a: Vec2;
  b: Vec2;
  center: Vec2;
  radius: number;
  span: number;
};

export type Box = {
  min: { x: number; y: number };
  max: { x: number; y: number };
};

export type IslandGeom = { edges: SpanEdge[][]; bounds: Box[] };

export function grow(box: Box, p: Vec2): void {
  box.min.x = Math.min(box.min.x, p.x);
  box.min.y = Math.min(box.min.y, p.y);
  box.max.x = Math.max(box.max.x, p.x);
  box.max.y = Math.max(box.max.y, p.y);
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
    const p = value as Polygon;
    const outer = chainEdges(p.boundary);
    if (outer.length === 0) return [];
    return [{ kind: "region", outer, holes: p.holes as Loop[] }];
  }
  return evaluateRegions(value as CsgOperand);
}

/** One island's loops → fill spans, normalized: outer CCW, holes CW. */
export function islandSpans(island: Region): SpanEdge[] {
  const loops = [island.outer, ...island.holes];
  const out: SpanEdge[] = [];
  for (let i = 0; i < loops.length; i++) out.push(...normalizedLoop(loops[i]!, i > 0));
  return out;
}

/** Normalized spans (outer CCW, holes CW) + padded AABB per island. */
export function islandGeomOf(value: Region | Polygon | CsgOperand, pad: number): IslandGeom {
  const edges: SpanEdge[][] = [];
  const bounds: Box[] = [];
  for (const island of islandsOfValue(value)) {
    const spans = islandSpans(island);
    if (spans.length === 0) continue;
    const box: Box = {
      min: { x: Infinity, y: Infinity },
      max: { x: -Infinity, y: -Infinity },
    };
    for (const edge of spans) {
      grow(box, edge.a);
      grow(box, edge.b);
      if (edge.radius > 0) {
        grow(box, { x: edge.center.x - edge.radius, y: edge.center.y - edge.radius });
        grow(box, { x: edge.center.x + edge.radius, y: edge.center.y + edge.radius });
      }
    }
    if (!Number.isFinite(box.min.x)) continue;
    edges.push(spans);
    bounds.push({
      min: { x: box.min.x - pad, y: box.min.y - pad },
      max: { x: box.max.x + pad, y: box.max.y + pad },
    });
  }
  return { edges, bounds };
}

/** Running edge count before block `i` — the GPU `edgeOffset` of each island. */
export function blockOffset(blocks: readonly SpanEdge[][], i: number): number {
  let at = 0;
  for (let k = 0; k < i; k++) at += blocks[k]!.length;
  return at;
}

// -- loop normalization ------------------------------------------------------

/** One island loop → fill spans, normalized: outer CCW, holes CW. */
export function normalizedLoop(loop: Loop, wantCw: boolean): SpanEdge[] {
  if (isCircleWalk(loop)) {
    const r = Math.abs(loop.radius);
    const anchor = { x: loop.center.x + r, y: loop.center.y };
    // Full circle: positive sweep = CCW outer, negative = CW hole.
    return [
      {
        a: anchor,
        b: anchor,
        center: loop.center,
        radius: r,
        span: wantCw ? -Math.PI * 2 : Math.PI * 2,
      },
    ];
  }
  const edges = walkEdges(loop);
  if (edges.length === 0) return [];
  const area = shoelace(tessellateWalk(loop));
  const reversed = area < 0 !== wantCw;
  const ordered = reversed ? reverseLoop(edges) : edges;
  return ordered.map((e) => spanOf(e));
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

function spanOf(e: LoopEdge): SpanEdge {
  if (e.carrier.kind === "circle") {
    const carrier = e.carrier;
    return {
      a: e.a,
      b: e.b,
      center: carrier.center,
      radius: Math.abs(carrier.radius),
      span: circleDelta(carrier, e.a, e.b, e.k ?? 1),
    };
  }
  return { a: e.a, b: e.b, center: { x: 0, y: 0 }, radius: -1, span: 0 };
}
