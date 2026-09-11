import { printExpr, parsePath, type Expr } from "#source/expr";
import { hoistIntersections, printHoist, takeBind } from "#source/hoist";

import { nodeByPrint, traceKey, type SnapFilter, type SnapNode, type Vec2 } from "../pick";
import { isConstructed, isGliderPlace, isPinnedPoint, type PlacePoint } from "../place";
import type { InsertJob, PlaceHit, Placed } from "./types";

const { round: mathRound, sqrt } = Math;
export { isConstructed, isGliderPlace, isPinnedPoint };

export function round(n: number): number {
  return mathRound(n * 100) / 100;
}

export function exprOfPlace(p: PlacePoint): Expr {
  if (p.kind === "ref") return parsePath(p.bind);
  if (p.kind === "lineIntersection") {
    return {
      kind: "call",
      name: "lineIntersection",
      args: [parsePath(p.a), parsePath(p.b)],
    };
  }
  if (p.kind === "circleLineIntersection") {
    return {
      kind: "call",
      name: "circleLineIntersection",
      args: [parsePath(p.circle), parsePath(p.line), { kind: "num", value: p.k }],
    };
  }
  if (p.kind === "circleCircleIntersection") {
    return {
      kind: "call",
      name: "circleCircleIntersection",
      args: [parsePath(p.a), parsePath(p.b), { kind: "num", value: p.k }],
    };
  }
  if (p.kind === "pointOnSegment") {
    return {
      kind: "call",
      name: "pointOnSegment",
      args: [parsePath(p.bind), { kind: "num", value: round(p.t) }],
    };
  }
  if (p.kind === "pointOnLine") {
    return {
      kind: "call",
      name: "pointOnLine",
      args: [parsePath(p.bind), { kind: "num", value: round(p.s) }],
    };
  }
  if (p.kind === "pointOnCircle") {
    return {
      kind: "call",
      name: "pointOnCircle",
      args: [
        parsePath(p.bind),
        { kind: "num", value: round(p.ux) },
        { kind: "num", value: round(p.uy) },
      ],
    };
  }
  return {
    kind: "call",
    name: "point",
    args: [
      { kind: "num", value: round(p.at.x) },
      { kind: "num", value: round(p.at.y) },
    ],
  };
}

export function asPoint(hit: PlaceHit, opts?: { gliders?: boolean }): Placed {
  const p = hit.point;
  if (isGliderPlace(p) && opts?.gliders !== true) {
    const at = { x: round(p.at.x), y: round(p.at.y) };
    return { expr: exprOfPlace({ kind: "free", at }), at };
  }
  if (p.kind === "free") {
    const at = { x: round(p.at.x), y: round(p.at.y) };
    return { expr: exprOfPlace({ kind: "free", at }), at };
  }
  return { expr: exprOfPlace(p), at: p.at };
}

export function sameRef(center: Expr, p: PlacePoint): boolean {
  if (p.kind !== "ref") return false;
  return printExpr(center) === p.bind;
}

export function constructedInsert(p: PlacePoint): InsertJob | undefined {
  if (!isConstructed(p)) return undefined;
  const e = exprOfPlace(p);
  if (e.kind !== "call") return undefined;
  return { from: p.kind, args: e.args };
}

export function hoverPlace(p: PlacePoint, trace: readonly SnapNode[]): string | undefined {
  if (p.kind === "ref") return p.key ?? keyByPrint(trace, p.bind);
  if (isGliderPlace(p)) return p.key ?? keyByPrint(trace, p.bind);
  if (p.kind === "lineIntersection") return p.key ?? keyByPrint(trace, p.a);
  if (p.kind === "circleLineIntersection") return p.key ?? keyByPrint(trace, p.circle);
  if (p.kind === "circleCircleIntersection") return p.key ?? keyByPrint(trace, p.a);
  return undefined;
}

export function previewCall(
  from: string,
  args: Expr[],
  usedNames: readonly string[],
  call: (printed: string[]) => string,
  bind?: string,
): string {
  const used = new Set(usedNames);
  const { exprs, hoists } = hoistIntersections(args, used);
  const id = bind?.trim() ? bind.trim() : takeBind(used, from);
  return [...hoists.map(printHoist), `const ${id} = ${call(exprs.map((e) => printExpr(e)))}`].join(
    "\n",
  );
}

export function exprOfPrint(print: string): Expr {
  return parsePath(print);
}

/** Printed expr of the cursor's pinned point — the hover label for point slots. */
export function pinnedPointLabel(place: PlaceHit | undefined): string | undefined {
  const p = place?.point;
  return p && isPinnedPoint(p) ? printExpr(exprOfPlace(p)) : undefined;
}

/** Trace key (`id:occ`) of the first tape node a printed path names. */
export function keyByPrint(
  trace: readonly SnapNode[],
  print: string,
  filter?: SnapFilter,
): string | undefined {
  const n = nodeByPrint(trace, print, filter);
  return n ? traceKey(n) : undefined;
}

/**
 * Hover identity of a snapped node. The snap records the occurrence it landed
 * on; the print lookup is the fallback for place points rebuilt from a scope
 * expression (region cycle vertices), which never saw a tape node. Highlighting
 * matches on `id:occ`, so a bare id would light up every repeated instance.
 */
export function snapKey(
  pick: { bind: string; key?: string },
  trace: readonly SnapNode[],
): string | undefined {
  return pick.key ?? keyByPrint(trace, pick.bind);
}

export function dist(a: Vec2, b: Vec2): number {
  return sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
}
