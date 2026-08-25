import { printExpr, type Expr } from "../source/expr";
import { hoistIntersections, printHoist, takeBind } from "../source/hoist";
import { isCrossing, type PlacePoint } from "./place";
import type { Vec2 } from "./pick";

export type ToolId = "point" | "circle" | "line" | "segment";

export type ToolSpec = {
  id: ToolId;
  title: string;
  hint: string;
  prefix: string;
};

export const TOOLS: readonly ToolSpec[] = [
  { id: "point", title: "Point", hint: "Click to place, or snap to a named point or crossing.", prefix: "p" },
  {
    id: "circle",
    title: "Circle",
    hint: "Center, then radius. A point or crossing pins dist() instead of a literal.",
    prefix: "c",
  },
  { id: "line", title: "Line", hint: "Two points — infinite.", prefix: "l" },
  { id: "segment", title: "Segment", hint: "Two points — finite.", prefix: "s" },
];

export function filterTools(query: string): ToolSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...TOOLS];
  return TOOLS.filter((t) => t.title.toLowerCase().includes(q) || t.id.includes(q));
}

export type PlaceHit = {
  world: Vec2;
  point: PlacePoint;
};

export type ToolSession =
  | { verb: "point" }
  | { verb: "circle"; center?: { expr: Expr; at: Vec2 } }
  | { verb: "line"; a?: { expr: Expr; at: Vec2 } }
  | { verb: "segment"; a?: { expr: Expr; at: Vec2 } };

export type Ghost =
  | { kind: "point"; at: Vec2 }
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "line" | "segment"; a: Vec2; b: Vec2 };

export type InsertJob = {
  from: ToolId | "lineIntersection" | "circleLineIntersection" | "circleCircleIntersection";
  args: Expr[];
};

function round(n: number): number {
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

function asPoint(hit: PlaceHit): { expr: Expr; at: Vec2 } {
  const p = hit.point;
  if (p.kind === "free") {
    const at = { x: round(p.at.x), y: round(p.at.y) };
    return { expr: exprOfPlace({ kind: "free", at }), at };
  }
  return { expr: exprOfPlace(p), at: p.at };
}

function radiusExpr(center: { expr: Expr; at: Vec2 }, hit: PlaceHit): Expr {
  if (hit.point.kind !== "free" && !sameRef(center.expr, hit.point)) {
    return { kind: "call", name: "dist", args: [center.expr, exprOfPlace(hit.point)] };
  }
  const r = Math.max(0.05, Math.hypot(hit.point.at.x - center.at.x, hit.point.at.y - center.at.y));
  return { kind: "num", value: round(r) };
}

function sameRef(center: Expr, p: PlacePoint): boolean {
  return center.kind === "ref" && p.kind === "ref" && center.name === p.bind;
}

function intersectionInsert(p: PlacePoint): InsertJob | null {
  if (!isCrossing(p)) return null;
  const e = exprOfPlace(p);
  if (e.kind !== "call") return null;
  return { from: p.kind, args: e.args };
}

export function startTool(id: ToolId): ToolSession {
  return { verb: id };
}

export function clickTool(session: ToolSession, hit: PlaceHit): { session: ToolSession } | { insert: InsertJob } {
  if (session.verb === "point") {
    if (hit.point.kind === "ref") return { session };
    const crossing = intersectionInsert(hit.point);
    if (crossing) return { insert: crossing };
    const at = { x: round(hit.point.at.x), y: round(hit.point.at.y) };
    return {
      insert: {
        from: "point",
        args: [
          { kind: "num", value: at.x },
          { kind: "num", value: at.y },
        ],
      },
    };
  }
  if (session.verb === "circle") {
    if (!session.center) return { session: { verb: "circle", center: asPoint(hit) } };
    return { insert: { from: "circle", args: [session.center.expr, radiusExpr(session.center, hit)] } };
  }
  if (!session.a) return { session: { ...session, a: asPoint(hit) } };
  return { insert: { from: session.verb, args: [session.a.expr, asPoint(hit).expr] } };
}

export function ghostOf(session: ToolSession, cursor: Vec2 | null): Ghost | null {
  if (!cursor) {
    if (session.verb === "circle" && session.center) {
      return { kind: "circle", center: session.center.at, radius: 0.05 };
    }
    return null;
  }
  if (session.verb === "point") return { kind: "point", at: cursor };
  if (session.verb === "circle") {
    if (!session.center) return { kind: "point", at: cursor };
    return {
      kind: "circle",
      center: session.center.at,
      radius: Math.max(0.05, Math.hypot(cursor.x - session.center.at.x, cursor.y - session.center.at.y)),
    };
  }
  if (!session.a) return { kind: "point", at: cursor };
  return { kind: session.verb, a: session.a.at, b: cursor };
}

function previewCall(
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

export function previewOf(
  session: ToolSession,
  place: PlacePoint | null = null,
  usedNames: readonly string[] = [],
): { line: string; hint: string } {
  const spec = TOOLS.find((t) => t.id === session.verb)!;
  if (session.verb === "point") {
    if (place?.kind === "ref") {
      return { line: `${place.bind}`, hint: "Already a named point — click does nothing." };
    }
    if (place && isCrossing(place)) {
      const used = new Set(usedNames);
      const { hoists } = hoistIntersections([exprOfPlace(place)], used);
      const line = hoists.map(printHoist).join("\n") || `const ${spec.prefix} = ${printExpr(exprOfPlace(place))}`;
      return { line, hint: "Click to insert the crossing." };
    }
    return { line: `const ${spec.prefix} = point(x, y)`, hint: spec.hint };
  }
  if (session.verb === "circle") {
    if (!session.center) {
      if (place && place.kind !== "free") {
        return {
          line: previewCall("circle", [exprOfPlace(place)], usedNames, ([c]) => `circle(${c}, radius)`),
          hint: "Click to set the center. A crossing is inserted as its own named point.",
        };
      }
      return { line: `const ${spec.prefix} = circle(center, radius)`, hint: spec.hint };
    }
    if (place && place.kind !== "free" && !sameRef(session.center.expr, place)) {
      return {
        line: previewCall(
          "circle",
          [session.center.expr, exprOfPlace(place)],
          usedNames,
          ([c, p]) => `circle(${c}, dist(${c}, ${p}))`,
        ),
        hint: "Click to pin the radius to that distance.",
      };
    }
    return {
      line: previewCall("circle", [session.center.expr], usedNames, ([c]) => `circle(${c}, radius)`),
      hint: "Click the radius, or a point / crossing to pin dist().",
    };
  }
  if (!session.a) {
    if (place && place.kind !== "free") {
      return {
        line: previewCall(session.verb, [exprOfPlace(place)], usedNames, ([a]) => `${session.verb}(${a}, b)`),
        hint: spec.hint,
      };
    }
    return { line: `const ${spec.prefix} = ${session.verb}(a, b)`, hint: spec.hint };
  }
  if (place && place.kind !== "free") {
    return {
      line: previewCall(
        session.verb,
        [session.a.expr, exprOfPlace(place)],
        usedNames,
        ([a, b]) => `${session.verb}(${a}, ${b})`,
      ),
      hint: "Click the second point.",
    };
  }
  return {
    line: previewCall(session.verb, [session.a.expr], usedNames, ([a]) => `${session.verb}(${a}, b)`),
    hint: "Click the second point.",
  };
}
