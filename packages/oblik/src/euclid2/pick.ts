import type { TraceNode } from "../eval/context";
import { lineBasis } from "../geom/ops";
import type { Circle, Line, OffsetLine, Point, Segment } from "../geom";
import { dist, distToLine, distToSegment } from "../geom/vec";
import type { Camera2, PaneSize } from "./camera";

export type Vec2 = { x: number; y: number };

export type SnapPoint = { id: string; bind: string; at: Vec2 };

const GEOM_PX = 8;

export function traceKey(n: TraceNode): string {
  return `${n.id}:${n.occ}`;
}

export function isFiniteTrace(n: TraceNode): boolean {
  const v = n.value;
  if (v.kind === "point") return Number.isFinite(v.x) && Number.isFinite(v.y);
  if (v.kind === "circle") return Number.isFinite(v.radius) && Number.isFinite(v.center.x);
  if (v.kind === "segment") return Number.isFinite(v.a.x) && Number.isFinite(v.b.x);
  if (v.kind === "line") return Number.isFinite(v.origin.x);
  if (v.kind === "offsetLine") return Number.isFinite(v.distance);
  return false;
}

function geomDistWorld(world: Vec2, n: TraceNode): number {
  const v = n.value;
  if (v.kind === "point") return dist(world, v as Point);
  if (v.kind === "segment") {
    const s = v as Segment;
    return distToSegment(world, s.a, s.b);
  }
  if (v.kind === "line") {
    const l = v as Line;
    return distToLine(world, l.origin, l.direction);
  }
  if (v.kind === "offsetLine") {
    const { origin, dir } = lineBasis(v as OffsetLine);
    return distToLine(world, origin, dir);
  }
  if (v.kind === "circle") {
    const c = v as Circle;
    return Math.abs(dist(world, c.center) - Math.abs(c.radius));
  }
  return Infinity;
}

/** Nearest finite bound point on the live tape. Distance is in world units. */
export function snapBoundPoint(trace: readonly TraceNode[], world: Vec2, maxDist: number): SnapPoint | null {
  let best: { snap: SnapPoint; d: number } | null = null;
  for (const n of trace) {
    if (n.occ !== 0 || n.value.kind !== "point" || !n.bind) continue;
    const p = n.value;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const d = Math.hypot(p.x - world.x, p.y - world.y);
    if (d > maxDist) continue;
    if (!best || d < best.d) best = { snap: { id: n.id, bind: n.bind, at: { x: p.x, y: p.y } }, d };
  }
  return best?.snap ?? null;
}

/** All trace nodes within pick radius of `world`, nearest first. */
export function hitsNear(
  trace: readonly TraceNode[],
  world: Vec2,
  camera: Camera2,
  _size: PaneSize,
  maxPx = GEOM_PX,
): TraceNode[] {
  const maxWorld = maxPx / Math.max(8, camera.scale);
  const out: { node: TraceNode; d: number }[] = [];
  for (const n of trace) {
    if (!isFiniteTrace(n)) continue;
    const d = geomDistWorld(world, n);
    if (d <= maxWorld) out.push({ node: n, d });
  }
  out.sort((a, b) => {
    const pa = a.node.value.kind === "point" ? 0 : 1;
    const pb = b.node.value.kind === "point" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.d !== b.d) return a.d - b.d;
    return stackRank(a.node) - stackRank(b.node);
  });
  return out.map((x) => x.node);
}

/** Tie-break equal distances using the innermost user frame. */
function stackRank(n: TraceNode): number {
  const leaf = n.stack[0];
  if (!leaf) return 0;
  return leaf.line * 10_000 + leaf.column;
}

/** Nearest pick target at `world`, if any. */
export function hitTest(
  trace: readonly TraceNode[],
  world: Vec2,
  camera: Camera2,
  size: PaneSize,
): TraceNode | null {
  return hitsNear(trace, world, camera, size)[0] ?? null;
}

function occSiblings(hits: readonly TraceNode[], id: string): TraceNode[] {
  return hits.filter((n) => n.id === id).toSorted((a, b) => a.occ - b.occ);
}

/**
 * First click takes the nearest hit. Re-click cycles `occ` for that same id
 * (the same constructor ran more than once) and ignores other overlapping ink.
 */
export function pickAmong(hits: readonly TraceNode[], priorKey: string | null): TraceNode | null {
  if (hits.length === 0) return null;
  const prior = priorKey ? hits.find((n) => traceKey(n) === priorKey) : undefined;
  if (!prior) return hits[0]!;
  const siblings = occSiblings(hits, prior.id);
  if (siblings.length === 0) return hits[0]!;
  const idx = siblings.findIndex((n) => traceKey(n) === priorKey);
  if (idx < 0) return siblings[0]!;
  return siblings[(idx + 1) % siblings.length]!;
}

export const PICK_CLICK_PX = 4;

export function movedPastClick(fromX: number, fromY: number, toX: number, toY: number): boolean {
  return Math.hypot(toX - fromX, toY - fromY) >= PICK_CLICK_PX;
}
