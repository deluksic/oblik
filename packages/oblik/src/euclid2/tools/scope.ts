import type { TraceNode } from "@/eval/context";
import type { Circle, LineLike, Profile } from "@/geom";
import { gliderAt, isGlider } from "@/geom/gliders";
import { isFiniteTrace } from "../pick";
import type { Placed, Scope } from "./types";

export const EMPTY_SCOPE: Scope = { used: [], points: {}, carriers: {}, circles: {}, profiles: {}, lengths: {} };

export function scopeFromTrace(trace: readonly TraceNode[]): Scope {
  const used: string[] = [];
  const points: Record<string, Placed> = {};
  const carriers: Record<string, Scope["carriers"][string]> = {};
  const circles: Record<string, { expr: import("../../source/expr").Expr; geom: Circle }> = {};
  const profiles: Record<string, { expr: import("../../source/expr").Expr; geom: Profile }> = {};
  const lengths: Record<string, number> = {};
  for (const n of trace) {
    if (n.occ !== 0 || !n.bind || !isFiniteTrace(n)) continue;
    used.push(n.bind);
    if (n.value.kind === "point") {
      points[n.bind] = { expr: { kind: "ref", name: n.bind }, at: { x: n.value.x, y: n.value.y } };
    }
    if (isGlider(n.value)) {
      const at = gliderAt(n.value);
      points[n.bind] = { expr: { kind: "ref", name: n.bind }, at };
    }
    if (n.value.kind === "line" || n.value.kind === "segment" || n.value.kind === "parallelLine") {
      carriers[n.bind] = { expr: { kind: "ref", name: n.bind }, geom: n.value as LineLike };
    }
    if (n.value.kind === "circle") {
      circles[n.bind] = { expr: { kind: "ref", name: n.bind }, geom: n.value as Circle };
    }
    if (n.value.kind === "profile") {
      profiles[n.bind] = { expr: { kind: "ref", name: n.bind }, geom: n.value as Profile };
    }
    if (n.value.kind === "slider") {
      lengths[n.bind] = n.value.n;
    }
  }
  return { used, points, carriers, circles, profiles, lengths };
}

export function scopeOf(x?: Scope | readonly string[]): Scope {
  if (!x) return EMPTY_SCOPE;
  if (Array.isArray(x)) return { used: x, points: {}, carriers: {}, circles: {}, profiles: {}, lengths: {} };
  return x;
}
