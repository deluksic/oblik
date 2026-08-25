import type { TraceNode } from "../eval/context";
import type { Branch, Circle, LineLike } from "../geom";
import {
  circleCircleIntersectionValue,
  circleLineIntersectionValue,
  lineIntersectionValue,
} from "../geom/ops";
import { dist } from "../geom/vec";
import { isFiniteTrace, snapBoundPoint, type Vec2 } from "./pick";

export type PlacePoint =
  | { kind: "free"; at: Vec2 }
  | { kind: "ref"; bind: string; id: string; at: Vec2 }
  | { kind: "lineIntersection"; a: string; b: string; at: Vec2 }
  | { kind: "circleLineIntersection"; circle: string; line: string; k: Branch; at: Vec2 }
  | { kind: "circleCircleIntersection"; a: string; b: string; k: Branch; at: Vec2 };

export type Crossing = Exclude<PlacePoint, { kind: "free" } | { kind: "ref" }>;

export const PLACE_SNAP_PX = 16;

export function placeSnapWorld(scale: number): number {
  return PLACE_SNAP_PX / Math.max(8, scale);
}

export function isCrossing(p: PlacePoint): p is Crossing {
  return (
    p.kind === "lineIntersection" ||
    p.kind === "circleLineIntersection" ||
    p.kind === "circleCircleIntersection"
  );
}

/** Named bound point, then nearest finite crossing, else a free point at `world`. */
export function resolvePlacePoint(
  trace: readonly TraceNode[],
  world: Vec2,
  maxDist: number,
): PlacePoint {
  const named = snapBoundPoint(trace, world, maxDist);
  if (named) {
    return { kind: "ref", bind: named.bind, id: named.id, at: named.at };
  }
  const cands: { point: PlacePoint; d: number; rank: number }[] = [];
  const cc = nearestCircleCircle(trace, world, maxDist);
  if (cc) cands.push({ point: cc.point, d: cc.d, rank: 1 });
  const cl = nearestCircleLine(trace, world, maxDist);
  if (cl) cands.push({ point: cl.point, d: cl.d, rank: 1 });
  const ll = nearestLineLine(trace, world, maxDist);
  if (ll) cands.push({ point: ll.point, d: ll.d, rank: 2 });
  if (cands.length === 0) return { kind: "free", at: { x: world.x, y: world.y } };
  cands.sort((a, b) => a.d - b.d || a.rank - b.rank);
  const best = cands[0]!;
  const atCrossing = snapBoundPoint(trace, best.point.at, maxDist);
  if (atCrossing) {
    return { kind: "ref", bind: atCrossing.bind, id: atCrossing.id, at: atCrossing.at };
  }
  return best.point;
}

function boundOf(
  trace: readonly TraceNode[],
  kinds: ReadonlySet<string>,
): TraceNode[] {
  return trace.filter(
    (n) => n.occ === 0 && n.bind && isFiniteTrace(n) && kinds.has(n.value.kind),
  );
}

const LINE_LIKE = new Set(["line", "segment", "parallelLine"]);
const CIRCLE = new Set(["circle"]);

function asLineLike(n: TraceNode): LineLike | null {
  const v = n.value;
  if (v.kind === "line" || v.kind === "segment" || v.kind === "parallelLine") return v;
  return null;
}

function nearestLineLine(
  trace: readonly TraceNode[],
  world: Vec2,
  maxDist: number,
): { point: PlacePoint; d: number } | null {
  const likes = boundOf(trace, LINE_LIKE);
  let best: { point: PlacePoint; d: number } | null = null;
  for (let i = 0; i < likes.length; i++) {
    const a = likes[i]!;
    const la = asLineLike(a);
    if (!la) continue;
    for (let j = i + 1; j < likes.length; j++) {
      const b = likes[j]!;
      if (a.bind === b.bind) continue;
      const lb = asLineLike(b);
      if (!lb) continue;
      const at = lineIntersectionValue(la, lb);
      if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
      const d = dist(world, at);
      if (d > maxDist) continue;
      if (!best || d < best.d) {
        best = {
          point: { kind: "lineIntersection", a: a.bind!, b: b.bind!, at },
          d,
        };
      }
    }
  }
  return best;
}

function nearestCircleLine(
  trace: readonly TraceNode[],
  world: Vec2,
  maxDist: number,
): { point: PlacePoint; d: number } | null {
  const circs = boundOf(trace, CIRCLE);
  const likes = boundOf(trace, LINE_LIKE);
  let best: { point: PlacePoint; d: number } | null = null;
  for (const c of circs) {
    if (c.value.kind !== "circle") continue;
    const circle = c.value as Circle;
    for (const ln of likes) {
      if (c.bind === ln.bind) continue;
      const line = asLineLike(ln);
      if (!line) continue;
      for (const k of [1, -1] as const) {
        const at = circleLineIntersectionValue(circle, line, k);
        if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
        const d = dist(world, at);
        if (d > maxDist) continue;
        if (!best || d < best.d) {
          best = {
            point: {
              kind: "circleLineIntersection",
              circle: c.bind!,
              line: ln.bind!,
              k,
              at,
            },
            d,
          };
        }
      }
    }
  }
  return best;
}

function nearestCircleCircle(
  trace: readonly TraceNode[],
  world: Vec2,
  maxDist: number,
): { point: PlacePoint; d: number } | null {
  const circs = boundOf(trace, CIRCLE);
  let best: { point: PlacePoint; d: number } | null = null;
  for (let i = 0; i < circs.length; i++) {
    const a = circs[i]!;
    if (a.value.kind !== "circle") continue;
    for (let j = i + 1; j < circs.length; j++) {
      const b = circs[j]!;
      if (a.bind === b.bind || b.value.kind !== "circle") continue;
      for (const k of [1, -1] as const) {
        const at = circleCircleIntersectionValue(a.value, b.value, k);
        if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
        const d = dist(world, at);
        if (d > maxDist) continue;
        if (!best || d < best.d) {
          best = {
            point: {
              kind: "circleCircleIntersection",
              a: a.bind!,
              b: b.bind!,
              k,
              at,
            },
            d,
          };
        }
      }
    }
  }
  return best;
}
