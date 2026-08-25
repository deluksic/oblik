import type { TraceNode } from "../eval/context";

export type Vec2 = { x: number; y: number };

export type SnapPoint = { id: string; bind: string; at: Vec2 };

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
