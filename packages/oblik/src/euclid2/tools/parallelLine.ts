import type { LineLike } from "../../geom";
import { signedDist } from "../../geom/ops";
import { snapLineCarrier } from "../pick";
import { exprOfPlace, hoverBind, previewCall, round } from "./common";
import {
  inSlot,
  nameField,
  parseNum,
  previewName,
  refField,
  resolveCarrier,
  typedField,
  withBind,
} from "./draft";
import { scopeFromTrace } from "./scope";
import type { Field, PlaceHit, Preview, Scope, Tool, ToolSession } from "./types";

type ParallelSession = Extract<ToolSession, { verb: "parallelLine" }>;

const fields: Field<ParallelSession>[] = [
  refField(
    "carrier",
    "<line>",
    "carrier",
    (s) => s.carrierRef,
    (s, raw) => ({ ...s, carrierRef: raw }),
  ),
  typedField(() => true),
  nameField(),
];

function carrierOf(session: ParallelSession, scope: Scope) {
  return resolveCarrier(session.carrierRef, session.carrier, scope);
}

function distAt(hit: PlaceHit, geom: LineLike): number {
  const at = hit.point.kind === "free" ? hit.world : hit.point.at;
  return signedDist(at, geom);
}

function distExpr(carrier: NonNullable<ReturnType<typeof carrierOf>>, hit: PlaceHit, typed: string) {
  if (hit.point.kind !== "free") {
    return {
      kind: "call" as const,
      name: "signedDist",
      args: [exprOfPlace(hit.point), carrier.expr],
    };
  }
  const n = parseNum(typed);
  if (n != null) return { kind: "num" as const, value: round(n) };
  return { kind: "num" as const, value: round(distAt(hit, carrier.geom)) };
}

function carrierLabel(session: ParallelSession, scope: Scope, place: PlaceHit | null): string {
  if (session.carrierRef.trim()) return session.carrierRef.trim();
  const c = carrierOf(session, scope);
  if (c && c.expr.kind === "ref") return c.expr.name;
  if (place?.carrier) return place.carrier.bind;
  return "carrier";
}

export const parallelLine: Tool<ParallelSession> = {
  spec: {
    id: "parallelLine",
    title: "Parallel line",
    hint: "Type or click a line, then set the signed offset distance.",
    prefix: "par",
    aliases: ["offset", "parallel"],
  },
  start: () => ({ verb: "parallelLine", focus: "carrier", carrierRef: "", typed: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as ParallelSession["focus"] }),
  hit(session, hit, ctx) {
    if (carrierOf(session, scopeFromTrace(ctx.trace))) return hit;
    const carrier = snapLineCarrier(ctx.trace, hit.world, ctx.camera, ctx.size);
    return carrier ? { ...hit, carrier } : hit;
  },
  hover(session, hit, trace) {
    if (carrierOf(session, scopeFromTrace(trace)) || !hit.carrier) return null;
    return hoverBind(trace, hit.carrier.bind);
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
          focus: session.focus === "name" ? "name" : "typed",
        },
      };
    }
    return {
      insert: withBind(session, { from: "parallelLine", args: [carrier.expr, distExpr(carrier, hit, session.typed)] }),
    };
  },
  commit(session, _place, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier) {
      if (session.focus !== "carrier") return { session: { ...session, focus: "carrier" } };
      return null;
    }
    const typed = parseNum(session.typed);
    if (typed != null) {
      return {
        insert: withBind(session, {
          from: "parallelLine",
          args: [carrier.expr, { kind: "num", value: round(typed) }],
        }),
      };
    }
    if (session.focus === "name") return { session: { ...session, focus: "typed" } };
    if (session.focus === "carrier") return { session: { ...session, focus: "typed" } };
    return null;
  },
  ghost(session, place, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier) return null;
    const typed = parseNum(session.typed);
    if (typed != null) return { kind: "parallelLine", geom: carrier.geom, distance: typed };
    if (!place) return null;
    return { kind: "parallelLine", geom: carrier.geom, distance: distAt(place, carrier.geom) };
  },
  preview(session, place, scope): Preview {
    const spec = parallelLine.spec;
    const bind = previewName(session, spec.prefix);
    const p = place?.point ?? null;
    const name = inSlot(session.focus === "name", bind);
    const gTok = inSlot(session.focus === "carrier", carrierLabel(session, scope, place));
    const carrier = carrierOf(session, scope);
    if (!carrier) {
      const d = inSlot(session.focus === "typed", session.typed?.trim() || "distance");
      return {
        line: `const ${name} = parallelLine(${gTok}, ${d})`,
        hint: place?.carrier
          ? `Type a line name or click ${place.carrier.bind}. Tab for distance or name.`
          : spec.hint,
      };
    }
    if (p && p.kind !== "free" && parseNum(session.typed) == null) {
      return {
        line: previewCall(
          "parallelLine",
          [carrier.expr, exprOfPlace(p)],
          scope.used,
          ([g, q]) => `parallelLine(${inSlot(session.focus === "carrier", g)}, signedDist(${q}, ${g}))`,
          name,
        ),
        hint: "Click a point to pin signedDist(), or type a distance. Tab to name it.",
      };
    }
    const shown = session.typed?.trim() || (place ? String(round(distAt(place, carrier.geom))) : "distance");
    return {
      line: previewCall(
        "parallelLine",
        [carrier.expr, ...(parseNum(session.typed) != null ? [{ kind: "num" as const, value: parseNum(session.typed)! }] : [])],
        scope.used,
        ([g, n]) => `parallelLine(${inSlot(session.focus === "carrier", g)}, ${inSlot(session.focus === "typed", n ?? shown)})`,
        name,
      ),
      hint: "Type a distance and Enter, or click to measure. Tab to name it.",
    };
  },
};
