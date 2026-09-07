import type { Branch, Circle } from "#geom";
import { commonTangentBasis, tangentBasis } from "#geom/ops";
import { distToLine } from "#geom/vec";
import { printExpr, type Expr } from "#source/expr";

import { snapStrokeCarrier } from "../pick";
import { asPoint, exprOfPrint, hoverBind, hoverPlace } from "./common";
import { hitRef, inSlot, nameField, previewName, refField, withBind } from "./draft";
import { scopeFromTrace, toolScope } from "./scope";
import type {
  Field,
  PlaceHit,
  Placed,
  Preview,
  Scope,
  Tool,
  ToolSession,
  TangentOp,
} from "./types";

type TangentSession = Extract<ToolSession, { verb: "tangent" }>;
type CircleRef = Scope["circles"][string];

const fields: Field<TangentSession>[] = [
  refField(
    "a",
    "<point or circle>",
    "operand",
    (s) => s.aRef,
    (s, raw) => ({ ...s, aRef: raw }),
  ),
  refField(
    "b",
    "<point or circle>",
    "operand",
    (s) => s.bRef,
    (s, raw) => ({ ...s, bRef: raw }),
  ),
  nameField(),
];

/** Resolve a typed operand name: a point or a circle in scope. */
function opByName(name: string, scope: Scope): TangentOp | undefined {
  const t = name.trim();
  if (!t) return undefined;
  const p = scope.points[t];
  if (p) return { kind: "point", placed: p };
  const c = scope.circles[t];
  if (c) return { kind: "circle", circle: c };
  return undefined;
}

/** Typed ref beats a placed operand; a placed operand beats nothing. */
function resolveOp(
  ref: string,
  placed: TangentOp | undefined,
  scope: Scope,
): TangentOp | undefined {
  const t = ref.trim();
  if (t) {
    const byName = opByName(t, scope);
    if (byName) return byName;
    if (placed) {
      const printed =
        placed.kind === "point" ? printExpr(placed.placed.expr) : printExpr(placed.circle.expr);
      if (printed === t) return placed;
    }
    return undefined;
  }
  return placed;
}

function opOf(session: TangentSession, i: 0 | 1, scope: Scope): TangentOp | undefined {
  return resolveOp(i === 0 ? session.aRef : session.bRef, session.ops[i], scope);
}

/** The operand the cursor is on: a circle stroke, else a point. */
function opAtHit(hit: PlaceHit): TangentOp {
  if (hit.carrier && hit.carrier.geom.kind === "circle") {
    return {
      kind: "circle",
      circle: { expr: exprOfPrint(hit.carrier.bind), geom: hit.carrier.geom as Circle },
    };
  }
  return { kind: "point", placed: asPoint(hit) };
}

type Candidate = {
  ctor: "tangentPointCircle" | "tangentCircleCircleOuter" | "tangentCircleCircleInner";
  k: Branch;
  args: Expr[];
  /** Any point on the carrier plus its unit direction — for cursor metrics. */
  origin: { x: number; y: number };
  dir: { x: number; y: number };
  /** Ghost stroke: p → contact, or contact A → contact B. */
  a: { x: number; y: number };
  b: { x: number; y: number };
};

function pointCircleCandidates(p: Placed, c: CircleRef): Candidate[] {
  const out: Candidate[] = [];
  for (const k of [1, -1] as const) {
    const t = tangentBasis(c.geom, p.at, k);
    if (!t) continue;
    out.push({
      ctor: "tangentPointCircle",
      k,
      args: [p.expr, c.expr, { kind: "num", value: k }],
      origin: t.origin,
      dir: t.direction,
      a: { x: p.at.x, y: p.at.y },
      b: t.contact,
    });
  }
  return out;
}

function circleCircleCandidates(a: CircleRef, b: CircleRef): Candidate[] {
  const out: Candidate[] = [];
  for (const family of ["outer", "inner"] as const) {
    for (const k of [1, -1] as const) {
      const t = commonTangentBasis(a.geom, b.geom, family, k);
      if (!t) continue;
      out.push({
        ctor: family === "outer" ? "tangentCircleCircleOuter" : "tangentCircleCircleInner",
        k,
        args: [a.expr, b.expr, { kind: "num", value: k }],
        origin: t.origin,
        dir: t.direction,
        a: t.contactA,
        b: t.contactB,
      });
    }
  }
  return out;
}

/** Every candidate tangent of a resolved operand pair. */
function candidatesFor(ops: [TangentOp, TangentOp]): Candidate[] {
  const [a, b] = ops;
  const point = a.kind === "point" ? a : b.kind === "point" ? b : undefined;
  const circle = a.kind === "circle" ? a : b.kind === "circle" ? b : undefined;
  if (point && circle) return pointCircleCandidates(point.placed, circle.circle);
  if (a.kind === "circle" && b.kind === "circle") return circleCircleCandidates(a.circle, b.circle);
  return []; // two points: no tangent
}

function bothOps(session: TangentSession, scope: Scope): [TangentOp, TangentOp] | undefined {
  const a = opOf(session, 0, scope);
  if (!a) return undefined;
  const b = opOf(session, 1, scope);
  return b ? [a, b] : undefined;
}

/** Index of the candidate whose carrier is nearest `world`. */
function nearestAt(cands: readonly Candidate[], world: { x: number; y: number }): number {
  let best = 0;
  let bestD = Infinity;
  cands.forEach((c, i) => {
    const d = distToLine(world, c.origin, c.dir);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function opLabel(op: TangentOp): string {
  return op.kind === "point" ? printExpr(op.placed.expr) : printExpr(op.circle.expr);
}

export const tangent: Tool<TangentSession> = {
  spec: {
    id: "tangent",
    title: "Tangent",
    hint: "Points and circles in any order — every tangent is ghosted; click the one to place.",
    prefix: "tan",
    aliases: ["tangent line"],
  },
  start: () => ({
    verb: "tangent",
    focus: "a",
    ops: [undefined, undefined],
    aRef: "",
    bRef: "",
    name: "",
  }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as TangentSession["focus"] }),
  hit(session, hit, ctx) {
    if (bothOps(session, toolScope(ctx))) return hit;
    const filter = ctx.keys ? { keys: ctx.keys, print: ctx.print } : undefined;
    const picked = snapStrokeCarrier(ctx.trace, hit.world, ctx.camera, ctx.size, { filter });
    if (!picked || picked.geom.kind !== "circle") return hit;
    return { ...hit, carrier: picked };
  },
  hover(session, hit, trace, scope) {
    if (bothOps(session, scope ?? scopeFromTrace(trace))) return undefined;
    if (hit.carrier && hit.carrier.geom.kind === "circle")
      return hoverBind(trace, hit.carrier.bind);
    return hoverPlace(hit.point, trace);
  },
  click(session, hit, scope) {
    const ops = bothOps(session, scope);
    if (ops) {
      // Both operands placed — this click picks which tangent to insert.
      const cands = candidatesFor(ops);
      if (cands.length === 0) return { session };
      const c = cands[nearestAt(cands, hit.world)]!;
      return { insert: withBind(session, { from: c.ctor, args: c.args }) };
    }
    const first = opOf(session, 0, scope);
    const picked = opAtHit(hit);
    if (!first) {
      // First operand — a point or a circle.
      return { session: { ...session, ops: [picked, undefined], focus: "b" } };
    }
    // Second operand. Every pair is valid except point + point; a second point
    // click just re-places the first point, anything else fills the pair and
    // both are ghosted for the pick click / Enter.
    if (first.kind === "point" && picked.kind === "point") {
      return {
        session: {
          ...session,
          ops: [picked, undefined],
          aRef: session.aRef,
          focus: "b",
        },
      };
    }
    return {
      session: {
        ...session,
        ops: [first, picked],
        bRef:
          picked.kind === "circle"
            ? (hit.carrier?.bind ?? session.bRef)
            : hitRef(hit) || session.bRef,
        focus: session.focus === "name" ? "name" : "a",
      },
    };
  },
  commit(session, place, scope) {
    const ops = bothOps(session, scope);
    if (!ops) {
      if (session.focus !== "name") {
        const need = opOf(session, 0, scope) ? "b" : "a";
        if (session.focus !== need) return { session: { ...session, focus: need } };
      }
      return undefined;
    }
    const cands = candidatesFor(ops);
    if (cands.length === 0) return undefined;
    const c = place ? cands[nearestAt(cands, place.world)] : cands[0];
    if (!c) return undefined;
    return { insert: withBind(session, { from: c.ctor, args: c.args }) };
  },
  ghost(session, place, scope) {
    const ops = bothOps(session, scope);
    if (!ops) return undefined;
    const cands = candidatesFor(ops);
    if (cands.length === 0) return undefined;
    return {
      kind: "tangent",
      strokes: cands.map((c) => ({ a: c.a, b: c.b })),
      chosen: place ? nearestAt(cands, place.world) : 0,
    };
  },
  preview(session, place, scope): Preview {
    const spec = tangent.spec;
    const bind = previewName(session, spec.prefix);
    const name = inSlot(session.focus === "name", bind);
    const a = opOf(session, 0, scope);
    const b = opOf(session, 1, scope);
    const aTok = inSlot(session.focus === "a", a ? opLabel(a) : session.aRef.trim() || "<a>");
    const bTok = inSlot(session.focus === "b", b ? opLabel(b) : session.bRef.trim() || "<b>");
    if (a && b) {
      const cands = candidatesFor([a, b]);
      if (cands.length > 0) {
        const c = place ? cands[nearestAt(cands, place.world)] : cands[0];
        if (c) {
          const args = c.args.slice(0, 2).map(printExpr);
          return {
            line: `const ${name} = ${c.ctor}(${[...args, String(c.k)].join(", ")})`,
            hint: "Click the tangent line to place, or Enter to place the highlighted one.",
          };
        }
      }
      return {
        line: `const ${name} = tangent(${aTok}, ${bTok}, k)`,
        hint: "No tangent between these two.",
      };
    }
    const hint = a
      ? "Click a second point or circle — every tangent is ghosted, click one to place."
      : spec.hint;
    return { line: `const ${name} = tangent(${aTok}, ${bTok}, k)`, hint };
  },
};
