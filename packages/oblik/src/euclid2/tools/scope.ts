import type { TraceNode } from "../../eval/context";
import type { LineLike } from "../../geom";
import { isFiniteTrace } from "../pick";
import type { Placed, Scope } from "./types";

export const EMPTY_SCOPE: Scope = { used: [], points: {}, carriers: {} };

export function scopeFromTrace(trace: readonly TraceNode[]): Scope {
  const used: string[] = [];
  const points: Record<string, Placed> = {};
  const carriers: Record<string, Scope["carriers"][string]> = {};
  for (const n of trace) {
    if (n.occ !== 0 || !n.bind || !isFiniteTrace(n)) continue;
    used.push(n.bind);
    if (n.value.kind === "point") {
      points[n.bind] = { expr: { kind: "ref", name: n.bind }, at: { x: n.value.x, y: n.value.y } };
    }
    if (n.value.kind === "line" || n.value.kind === "segment" || n.value.kind === "parallelLine") {
      carriers[n.bind] = { expr: { kind: "ref", name: n.bind }, geom: n.value as LineLike };
    }
  }
  return { used, points, carriers };
}

export function scopeOf(x?: Scope | readonly string[]): Scope {
  if (!x) return EMPTY_SCOPE;
  if (Array.isArray(x)) return { used: x, points: {}, carriers: {} };
  return x;
}
