import type { TraceNode } from "../eval/context";
import type { Circle, Line, LineLike, ParallelLine, Point, Profile, Segment } from "../geom";
import { gliderAt, isGlider } from "../geom/gliders";
import { lineBasis } from "../geom/ops";
import { distToProfile, isFiniteProfile, isProfile } from "../geom/profile";
import { distToRegion, isFillGeom, isFiniteRegion, isRegion } from "../geom/region";
import { dist, distToLine, distToSegment } from "../geom/vec";
import type { Camera2, PaneSize } from "./camera";

export type Vec2 = { x: number; y: number };

export type SnapPoint = { id: string; bind: string; at: Vec2 };

/** When `keys` is set, only those tape nodes (`id:occ`) are snap-eligible. */
export type SnapFilter = {
  keys?: ReadonlySet<string>;
  print?: (n: TraceNode) => string | undefined;
};

const GEOM_PX = 8;
const POINT_PX = 12;

export function snapEligible(n: TraceNode, filter?: SnapFilter): boolean {
  if (!isFiniteTrace(n)) return false;
  if (filter?.keys) return filter.keys.has(traceKey(n));
  return !!n.bind;
}

export function snapPrint(n: TraceNode, filter?: SnapFilter): string {
  return filter?.print?.(n) ?? n.bind ?? n.id;
}

export function traceKey(n: TraceNode): string {
  return `${n.id}:${n.occ}`;
}

/** Parse `id:occ` from a HUD attr. Bare `id` is legacy. */
export function parseTraceAttr(attr: string): { id: string; occ?: number } {
  const i = attr.lastIndexOf(":");
  if (i <= 0) return { id: attr };
  const rest = attr.slice(i + 1);
  if (!/^\d+$/.test(rest)) return { id: attr };
  return { id: attr.slice(0, i), occ: Number(rest) };
}

export function nodeByTraceAttr(trace: readonly TraceNode[], attr: string): TraceNode | undefined {
  const p = parseTraceAttr(attr);
  if (p.occ != null) return trace.find((n) => n.id === p.id && n.occ === p.occ);
  return trace.find((n) => n.id === p.id);
}

/** First named node whose print or tape bind matches `print` (`plate.origin` or `origin`). */
export function nodeByPrint(
  trace: readonly { occ: number; bind?: string; id: string }[],
  print: string,
  filter?: SnapFilter,
): { id: string } | undefined {
  const last = print.includes(".") ? print.slice(print.lastIndexOf(".") + 1) : print;
  return trace.find((n) => {
    if (filter?.keys && !filter.keys.has(`${n.id}:${n.occ}`)) return false;
    const shown = filter?.print?.(n as TraceNode) ?? n.bind;
    return shown === print || n.bind === print || n.bind === last;
  });
}

export function isFiniteTrace(n: TraceNode): boolean {
  const v = n.value;
  if (v.kind === "style" || v.kind === "paint") return false;
  if (v.kind === "slider") return Number.isFinite(v.n);
  if (v.kind === "point") return Number.isFinite(v.x) && Number.isFinite(v.y);
  if (v.kind === "circle") return Number.isFinite(v.radius) && Number.isFinite(v.center.x);
  if (v.kind === "segment") return Number.isFinite(v.a.x) && Number.isFinite(v.b.x);
  if (v.kind === "line") return Number.isFinite(v.origin.x);
  if (v.kind === "parallelLine") return Number.isFinite(v.distance);
  if (isProfile(v)) return isFiniteProfile(v);
  if (isRegion(v)) return isFiniteRegion(v);
  if (isGlider(v)) return Number.isFinite(v.x) && Number.isFinite(v.y);
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
  if (isProfile(v)) return distToProfile(v, world);
  if (isRegion(v)) return distToRegion(v, world);
  if (isGlider(v)) return dist(world, gliderAt(v));
  return Infinity;
}

/** Nearest finite bound point on the live tape. Distance is in world units. */
export function snapBoundPoint(
  trace: readonly TraceNode[],
  world: Vec2,
  maxDist: number,
  filter?: SnapFilter,
): SnapPoint | null {
  let best: { snap: SnapPoint; d: number } | null = null;
  for (const n of trace) {
    if (!snapEligible(n, filter)) continue;
    if (n.value.kind !== "point" && !isGlider(n.value)) continue;
    const bind = snapPrint(n, filter);
    const p = n.value.kind === "point" ? n.value : gliderAt(n.value);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const d = Math.hypot(p.x - world.x, p.y - world.y);
    if (d > maxDist) continue;
    if (!best || d < best.d) best = { snap: { id: n.id, bind, at: { x: p.x, y: p.y } }, d };
  }
  return best?.snap ?? null;
}

function pickRadiusWorld(n: TraceNode, camera: Camera2, maxPx: number): number {
  const px = n.value.kind === "point" ? POINT_PX : maxPx;
  return px / Math.max(8, camera.scale);
}

function pickRank(n: TraceNode): number {
  if (n.value.kind === "point" || isGlider(n.value)) return 0;
  if (isRegion(n.value)) return 2;
  if (isProfile(n.value)) return 3;
  return 1;
}

/** All trace nodes within pick radius of `world`, nearest first. Points, then ink, then fills. */
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
    const insideFill = isFillGeom(n.value) && d === 0;
    if (insideFill || d <= pickRadiusWorld(n, camera, maxPx)) out.push({ node: n, d });
  }
  out.sort((a, b) => {
    const ra = pickRank(a.node);
    const rb = pickRank(b.node);
    if (ra !== rb) return ra - rb;
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
  _size: PaneSize,
  maxPx = GEOM_PX,
  filter?: SnapFilter,
): { bind: string; geom: LineLike } | null {
  let best: { bind: string; geom: LineLike; d: number } | null = null;
  for (const n of trace) {
    if (!snapEligible(n, filter)) continue;
    if (!LINE_LIKE.has(n.value.kind)) continue;
    const d = geomDistWorld(world, n);
    if (d > pickRadiusWorld(n, camera, maxPx)) continue;
    if (!best || d < best.d) best = { bind: snapPrint(n, filter), geom: n.value as LineLike, d };
  }
  return best ? { bind: best.bind, geom: best.geom } : null;
}

/** Nearest named profile under the pointer (ignores points and strokes). Inside a fill always wins. */
export function snapProfile(
  trace: readonly TraceNode[],
  world: Vec2,
  camera: Camera2,
  _size: PaneSize,
  maxPx = GEOM_PX,
  filter?: SnapFilter,
): { bind: string; geom: Profile; id: string } | null {
  let best: {
    bind: string;
    geom: Profile;
    id: string;
    inside: boolean;
    d: number;
    i: number;
  } | null = null;
  let i = 0;
  for (const n of trace) {
    const idx = i++;
    if (!snapEligible(n, filter)) continue;
    if (!isProfile(n.value)) continue;
    const d = geomDistWorld(world, n);
    const inside = d === 0;
    if (!inside && d > pickRadiusWorld(n, camera, maxPx)) continue;
    if (
      !best ||
      (inside && !best.inside) ||
      (inside === best.inside && d < best.d) ||
      (inside === best.inside && d === best.d && idx > best.i)
    ) {
      best = { bind: snapPrint(n, filter), geom: n.value, id: n.id, inside, d, i: idx };
    }
  }
  return best ? { bind: best.bind, geom: best.geom, id: best.id } : null;
}

const STROKE = new Set(["line", "segment", "parallelLine", "circle"]);

export type StrokeCarrier = { bind: string; geom: LineLike | Circle };

function isNamedStroke(n: TraceNode, filter?: SnapFilter): boolean {
  return snapEligible(n, filter) && STROKE.has(n.value.kind);
}

function strokeWithin(n: TraceNode, at: Vec2, camera: Camera2, maxPx: number): boolean {
  return geomDistWorld(at, n) <= pickRadiusWorld(n, camera, maxPx);
}

/** Named strokes/circles that pass near `at` (same pick radius as a hover). */
export function namedStrokesThrough(
  trace: readonly TraceNode[],
  at: Vec2,
  camera: Camera2,
  maxPx = GEOM_PX,
  filter?: SnapFilter,
): Set<string> {
  const out = new Set<string>();
  for (const n of trace) {
    if (!isNamedStroke(n, filter)) continue;
    if (strokeWithin(n, at, camera, maxPx)) out.add(snapPrint(n, filter));
  }
  return out;
}

/** Nearest named stroke or circle under the pointer (ignores points and fills). */
export function snapStrokeCarrier(
  trace: readonly TraceNode[],
  world: Vec2,
  camera: Camera2,
  _size: PaneSize,
  opts?: { maxPx?: number; through?: Vec2; filter?: SnapFilter },
): StrokeCarrier | null {
  const maxPx = opts?.maxPx ?? GEOM_PX;
  const filter = opts?.filter;
  let best: { bind: string; geom: LineLike | Circle; d: number } | null = null;
  for (const n of trace) {
    if (!isNamedStroke(n, filter)) continue;
    if (opts?.through && !strokeWithin(n, opts.through, camera, maxPx)) continue;
    const d = geomDistWorld(world, n);
    if (d > pickRadiusWorld(n, camera, maxPx)) continue;
    if (!best || d < best.d)
      best = { bind: snapPrint(n, filter), geom: n.value as LineLike | Circle, d };
  }
  return best ? { bind: best.bind, geom: best.geom } : null;
}
