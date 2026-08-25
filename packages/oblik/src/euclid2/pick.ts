import type { TraceNode } from "../eval/context";
import type { LineLike } from "../geom";
import { lineBasis } from "../geom/ops";
import type { Circle, Line, ParallelLine, Point, Segment } from "../geom";
import { dist, distToLine, distToSegment } from "../geom/vec";
import type { Camera2, PaneSize } from "./camera";

export type Vec2 = { x: number; y: number };

export type SnapPoint = { id: string; bind: string; at: Vec2 };

const GEOM_PX = 8;
const POINT_PX = 12;

export function traceKey(n: TraceNode): string {
  return `${n.id}:${n.occ}`;
}

export function isFiniteTrace(n: TraceNode): boolean {
  const v = n.value;
  if (v.kind === "slider") return Number.isFinite(v.n);
  if (v.kind === "point") return Number.isFinite(v.x) && Number.isFinite(v.y);
  if (v.kind === "circle") return Number.isFinite(v.radius) && Number.isFinite(v.center.x);
  if (v.kind === "segment") return Number.isFinite(v.a.x) && Number.isFinite(v.b.x);
  if (v.kind === "line") return Number.isFinite(v.origin.x);
  if (v.kind === "parallelLine") return Number.isFinite(v.distance);
  return false;
}

function geomDistWorld(world: Vec2, n: TraceNode): number {
  const v = n.value;
  if (v.kind === "slider") return Infinity;
  if (v.kind === "point") return dist(world, v as Point);
  if (v.kind === "segment") {
    const s = v as Segment;
    return distToSegment(world, s.a, s.b);
  }
  if (v.kind === "line") {
    const l = v as Line;
    return distToLine(world, l.origin, l.direction);
  }
  if (v.kind === "parallelLine") {
    const { origin, dir } = lineBasis(v as ParallelLine);
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

function pickRadiusWorld(n: TraceNode, camera: Camera2, maxPx: number): number {
  const px = n.value.kind === "point" ? POINT_PX : maxPx;
  return px / Math.max(8, camera.scale);
}

/** All trace nodes within pick radius of `world`, nearest first. Points always sort ahead of ink. */
export function hitsNear(
  trace: readonly TraceNode[],
  world: Vec2,
  camera: Camera2,
  _size: PaneSize,
  maxPx = GEOM_PX,
): TraceNode[] {
  const out: { node: TraceNode; d: number }[] = [];
  for (const n of trace) {
    if (!isFiniteTrace(n)) continue;
    const d = geomDistWorld(world, n);
    if (d <= pickRadiusWorld(n, camera, maxPx)) out.push({ node: n, d });
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

export const PICK_CLICK_PX = 4;

export function movedPastClick(fromX: number, fromY: number, toX: number, toY: number): boolean {
  return Math.hypot(toX - fromX, toY - fromY) >= PICK_CLICK_PX;
}

const LINE_LIKE = new Set(["line", "segment", "parallelLine"]);

/** Nearest named line-like stroke under the pointer (ignores points). */
export function snapLineCarrier(
  trace: readonly TraceNode[],
  world: Vec2,
  camera: Camera2,
  size: PaneSize,
  maxPx = GEOM_PX,
): { bind: string; geom: LineLike } | null {
  let best: { bind: string; geom: LineLike; d: number } | null = null;
  for (const n of trace) {
    if (n.occ !== 0 || !n.bind || !isFiniteTrace(n)) continue;
    if (!LINE_LIKE.has(n.value.kind)) continue;
    const d = geomDistWorld(world, n);
    if (d > pickRadiusWorld(n, camera, maxPx)) continue;
    if (!best || d < best.d) best = { bind: n.bind, geom: n.value as LineLike, d };
  }
  return best ? { bind: best.bind, geom: best.geom } : null;
}
