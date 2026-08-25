import type { LineLike } from "../../geom";
import { lineBasis } from "../../geom/ops";
import { add, perp } from "../../geom/vec";
import { printExpr } from "../../source/expr";
import { snapLineCarrier } from "../pick";
import { asPoint, exprOfPlace, hoverBind, previewCall } from "./common";
import { inSlot, nameField, previewName, refField, resolveCarrier, resolvePoint, withBind } from "./draft";
import { scopeFromTrace } from "./scope";
import type { Field, PlaceHit, Preview, Scope, Tool, ToolSession } from "./types";

type PerpSession = Extract<ToolSession, { verb: "perpendicularLine" }>;

const fields: Field<PerpSession>[] = [
  refField(
    "carrier",
    "<line>",
    "carrier",
    (s) => s.carrierRef,
    (s, raw) => ({ ...s, carrierRef: raw }),
  ),
  refField(
    "through",
    "<point>",
    "point",
    (s) => s.throughRef,
    (s, raw) => ({ ...s, throughRef: raw }),
  ),
  nameField(),
];

function carrierOf(session: PerpSession, scope: Scope) {
  return resolveCarrier(session.carrierRef, session.carrier, scope);
}

function throughOf(session: PerpSession, scope: Scope) {
  return resolvePoint(session.throughRef, session.through, scope);
}

function carrierLabel(session: PerpSession, scope: Scope, place: PlaceHit | null): string {
  if (session.carrierRef.trim()) return session.carrierRef.trim();
  const c = carrierOf(session, scope);
  if (c && c.expr.kind === "ref") return c.expr.name;
  if (place?.carrier) return place.carrier.bind;
  return "line";
}

function throughLabel(session: PerpSession, scope: Scope, place: PlaceHit | null): string {
  if (session.throughRef.trim()) return session.throughRef.trim();
  const t = throughOf(session, scope);
  if (t) return printExpr(t.expr);
  const p = place?.point;
  if (p && p.kind !== "free") return printExpr(exprOfPlace(p));
  return "point";
}

function perpGhostLine(carrier: LineLike, through: { x: number; y: number }) {
  const { dir } = lineBasis(carrier);
  const pd = perp(dir);
  return { kind: "line" as const, a: through, b: add(through, pd) };
}

export const perpendicularLine: Tool<PerpSession> = {
  spec: {
    id: "perpendicularLine",
    title: "Perpendicular line",
    hint: "A line, then a point — infinite perpendicular through the point.",
    prefix: "perp",
    aliases: ["perpendicular", "normal"],
  },
  start: () => ({ verb: "perpendicularLine", focus: "carrier", carrierRef: "", throughRef: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as PerpSession["focus"] }),
  hit(session, hit, ctx) {
    if (!carrierOf(session, scopeFromTrace(ctx.trace))) {
      const carrier = snapLineCarrier(ctx.trace, hit.world, ctx.camera, ctx.size);
      return carrier ? { ...hit, carrier } : hit;
    }
    return hit;
  },
  hover(session, hit, trace) {
    if (!carrierOf(session, scopeFromTrace(trace))) {
      if (!hit.carrier) return null;
      return hoverBind(trace, hit.carrier.bind);
    }
    if (hit.point.kind === "ref") return hoverBind(trace, hit.point.bind);
    return null;
  },
  click(session, hit, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier) {
      if (!hit.carrier) return { session };
      return {
        session: {
          ...session,
          carrier: { expr: { kind: "ref", name: hit.carrier.bind }, geom: hit.carrier.geom },
          carrierRef: hit.carrier.bind,
          focus: session.focus === "name" ? "name" : "through",
        },
      };
    }
    return {
      insert: withBind(session, { from: "perpendicularLine", args: [carrier.expr, asPoint(hit).expr] }),
    };
  },
  commit(session, _place, scope) {
    const carrier = carrierOf(session, scope);
    const through = throughOf(session, scope);
    if (!carrier) {
      if (session.focus !== "carrier") return { session: { ...session, focus: "carrier" } };
      return null;
    }
    if (through) {
      return { insert: withBind(session, { from: "perpendicularLine", args: [carrier.expr, through.expr] }) };
    }
    if (session.focus === "name") return { session: { ...session, focus: "through" } };
    if (session.focus === "carrier") return { session: { ...session, focus: "through" } };
    return null;
  },
  ghost(session, place, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier) return null;
    const through = throughOf(session, scope);
    const at = through?.at ?? place?.point.at;
    if (!at) return null;
    return perpGhostLine(carrier.geom, at);
  },
  preview(session, place, scope): Preview {
    const spec = perpendicularLine.spec;
    const bind = previewName(session, spec.prefix);
    const name = inSlot(session.focus === "name", bind);
    const gTok = inSlot(session.focus === "carrier", carrierLabel(session, scope, place));
    const pTok = inSlot(session.focus === "through", throughLabel(session, scope, place));
    const carrier = carrierOf(session, scope);
    const through = throughOf(session, scope);
    if (!carrier) {
      return {
        line: `const ${name} = perpendicularLine(${gTok}, ${pTok})`,
        hint: place?.carrier
          ? `Type a line name or click ${place.carrier.bind}. Tab for point or name.`
          : spec.hint,
      };
    }
    if (through) {
      return {
        line: previewCall(
          "perpendicularLine",
          [carrier.expr, through.expr],
          scope.used,
          ([g, q]) =>
            `perpendicularLine(${inSlot(session.focus === "carrier", g)}, ${inSlot(session.focus === "through", q)})`,
          name,
        ),
        hint: "Enter to insert. Tab to name it.",
      };
    }
    const p = place?.point ?? null;
    if (p && p.kind !== "free" && !session.throughRef.trim()) {
      return {
        line: previewCall(
          "perpendicularLine",
          [carrier.expr, exprOfPlace(p)],
          scope.used,
          ([g, q]) =>
            `perpendicularLine(${inSlot(session.focus === "carrier", g)}, ${inSlot(session.focus === "through", q)})`,
          name,
        ),
        hint: "Type a point name or click it. Tab to name it.",
      };
    }
    return {
      line: previewCall(
        "perpendicularLine",
        [carrier.expr],
        scope.used,
        ([g]) => `perpendicularLine(${inSlot(session.focus === "carrier", g)}, ${pTok})`,
        name,
      ),
      hint: "Type a point name or click it on the perpendicular. Tab to name it.",
    };
  },
};
