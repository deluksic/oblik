import { formatNum } from "../source/patch";
import type { Expr } from "../source/expr";
import type { SnapPoint, Vec2 } from "./pick";

export type ToolId = "point" | "circle" | "line" | "segment";

export type ToolSpec = {
  id: ToolId;
  title: string;
  hint: string;
  prefix: string;
};

export const TOOLS: readonly ToolSpec[] = [
  { id: "point", title: "Point", hint: "Click to place a free point.", prefix: "p" },
  { id: "circle", title: "Circle", hint: "Center, then radius. Center snaps to a named point.", prefix: "c" },
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
  snap?: SnapPoint;
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

export type InsertJob = { from: ToolId; args: Expr[] };

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function asPoint(hit: PlaceHit): { expr: Expr; at: Vec2 } {
  if (hit.snap) return { expr: { kind: "ref", name: hit.snap.bind }, at: hit.snap.at };
  const at = { x: round(hit.world.x), y: round(hit.world.y) };
  return {
    expr: {
      kind: "call",
      name: "point",
      args: [
        { kind: "num", value: at.x },
        { kind: "num", value: at.y },
      ],
    },
    at,
  };
}

export function startTool(id: ToolId): ToolSession {
  return { verb: id };
}

export function clickTool(session: ToolSession, hit: PlaceHit): { session: ToolSession } | { insert: InsertJob } {
  if (session.verb === "point") {
    if (hit.snap) return { session };
    const at = { x: round(hit.world.x), y: round(hit.world.y) };
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
    const r = Math.max(0.05, Math.hypot(hit.world.x - session.center.at.x, hit.world.y - session.center.at.y));
    return { insert: { from: "circle", args: [session.center.expr, { kind: "num", value: round(r) }] } };
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

export function previewOf(session: ToolSession): { line: string; hint: string } {
  const spec = TOOLS.find((t) => t.id === session.verb)!;
  if (session.verb === "point") return { line: `const ${spec.prefix} = point(x, y)`, hint: spec.hint };
  if (session.verb === "circle") {
    const c = session.center ? printSlot(session.center.expr) : "center";
    return { line: `const ${spec.prefix} = circle(${c}, radius)`, hint: session.center ? "Click the radius." : spec.hint };
  }
  const a = session.a ? printSlot(session.a.expr) : "a";
  const b = "b";
  return { line: `const ${spec.prefix} = ${session.verb}(${a}, ${b})`, hint: session.a ? "Click the second point." : spec.hint };
}

function printSlot(expr: Expr): string {
  if (expr.kind === "ref") return expr.name;
  if (expr.kind === "num") return formatNum(expr.value);
  if (expr.name === "point" && expr.args.length >= 2) {
    return `point(${printSlot(expr.args[0]!)}, ${printSlot(expr.args[1]!)})`;
  }
  return expr.name;
}
