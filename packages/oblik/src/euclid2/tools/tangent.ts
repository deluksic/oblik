import type { Branch } from "#geom";
import { commonTangentBasis, tangentBasis } from "#geom/ops";
import { distToLine } from "#geom/vec";
import { printExpr, type Expr } from "#source/expr";

import { snapStrokeCarrier } from "../pick";
import { inSlot, previewName, withBind } from "./draft";
import { defineSlotTool, resolveOperand } from "./slot";
import type {
  PlaceCtx,
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

const snapCircle = (hit: PlaceHit, ctx: PlaceCtx): PlaceHit => {
  const filter = ctx.keys ? { keys: ctx.keys, print: ctx.print } : undefined;
  const picked = snapStrokeCarrier(ctx.trace, hit.world, ctx.camera, ctx.size, { filter });
  if (!picked || picked.geom.kind !== "circle") return hit;
  return { ...hit, carrier: picked };
};

export const tangent: Tool<TangentSession> = defineSlotTool<
  TangentSession,
  { a: TangentOp; b: TangentOp }
>(
  {
    id: "tangent",
    title: "Tangent",
    hint: "Points and circles in any order — every tangent is ghosted; click the one to place.",
    prefix: "tan",
    aliases: ["tangent line"],
  },
  {
    slots: {
      a: { id: "a", kind: "operand", placeholder: "<point or circle>", snap: snapCircle },
      b: {
        id: "b",
        kind: "operand",
        placeholder: "<point or circle>",
        focusAfter: "a",
        snap: snapCircle,
      },
    },
    fill(session, slotId, picked, _refText, _hit, scope) {
      // A second point click just re-places the first point; anything else
      // fills the pair and both tangents are ghosted for the pick click.
      if (slotId !== "b") return undefined;
      const first = resolveOperand(session.aRef, session.a, scope);
      if (first?.kind !== "point" || picked.kind !== "point") return undefined;
      return { ...session, a: picked, b: undefined, focus: "b" };
    },
    click(session, hit, _scope, { a, b }) {
      // Both operands placed — this click picks which tangent to insert.
      const cands = candidatesFor([a, b]);
      if (cands.length === 0) return { session };
      const c = cands[nearestAt(cands, hit.world)]!;
      return { insert: withBind(session, { from: c.ctor, args: c.args }) };
    },
    commit(session, place, _scope, { a, b }) {
      const cands = candidatesFor([a, b]);
      if (cands.length === 0) return undefined;
      const c = place ? cands[nearestAt(cands, place.world)] : cands[0];
      if (!c) return undefined;
      return { insert: withBind(session, { from: c.ctor, args: c.args }) };
    },
    hoverReady: () => undefined,
    ghost(_session, place, _scope, { a, b }) {
      if (!a || !b) return undefined;
      const cands = candidatesFor([a, b]);
      if (cands.length === 0) return undefined;
      return {
        kind: "tangent",
        strokes: cands.map((c) => ({ a: c.a, b: c.b })),
        chosen: place ? nearestAt(cands, place.world) : 0,
      };
    },
    preview(session, place, _scope, { a, b }): Preview {
      const spec = tangent.spec;
      const bind = previewName(session, spec.prefix);
      const name = inSlot(session.focus === "name", bind);
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
  },
);
