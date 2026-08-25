import { printExpr, type Expr } from "../../source/expr";
import { hoistIntersections, printHoist, takeBind } from "../../source/hoist";
import { isCrossing, type PlacePoint } from "../place";
import type { Vec2 } from "../pick";
import type { InsertJob, PlaceHit, Placed } from "./types";

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function exprOfPlace(p: PlacePoint): Expr {
  if (p.kind === "ref") return { kind: "ref", name: p.bind };
  if (p.kind === "lineIntersection") {
    return {
      kind: "call",
      name: "lineIntersection",
      args: [
        { kind: "ref", name: p.a },
        { kind: "ref", name: p.b },
      ],
    };
  }
  if (p.kind === "circleLineIntersection") {
    return {
      kind: "call",
      name: "circleLineIntersection",
      args: [
        { kind: "ref", name: p.circle },
        { kind: "ref", name: p.line },
        { kind: "num", value: p.k },
      ],
    };
  }
  if (p.kind === "circleCircleIntersection") {
    return {
      kind: "call",
      name: "circleCircleIntersection",
      args: [
        { kind: "ref", name: p.a },
        { kind: "ref", name: p.b },
        { kind: "num", value: p.k },
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

export function asPoint(hit: PlaceHit): Placed {
  const p = hit.point;
  if (p.kind === "free") {
    const at = { x: round(p.at.x), y: round(p.at.y) };
    return { expr: exprOfPlace({ kind: "free", at }), at };
  }
  return { expr: exprOfPlace(p), at: p.at };
}

export function sameRef(center: Expr, p: PlacePoint): boolean {
  return center.kind === "ref" && p.kind === "ref" && center.name === p.bind;
}

export function intersectionInsert(p: PlacePoint): InsertJob | null {
  if (!isCrossing(p)) return null;
  const e = exprOfPlace(p);
  if (e.kind !== "call") return null;
  return { from: p.kind, args: e.args };
}

export function previewCall(
  from: string,
  args: Expr[],
  usedNames: readonly string[],
  call: (printed: string[]) => string,
): string {
  const used = new Set(usedNames);
  const { exprs, hoists } = hoistIntersections(args, used);
  const bind = takeBind(used, from);
  return [...hoists.map(printHoist), `const ${bind} = ${call(exprs.map((e) => printExpr(e)))}`].join("\n");
}

export function hoverBind(trace: readonly { occ: number; bind?: string; id: string }[], bind: string): string | null {
  return trace.find((n) => n.bind === bind && n.occ === 0)?.id ?? null;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
