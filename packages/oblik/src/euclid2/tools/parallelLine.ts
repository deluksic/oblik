import type { LineLike } from "#geom";
import { signedDist } from "#geom/ops";
import { printExpr } from "#source/expr";

import { snapLineCarrier } from "../pick";
import {
  exprOfPlace,
  exprOfPrint,
  hoverBind,
  hoverPlace,
  isPinnedPoint,
  previewCall,
  round,
} from "./common";
import {
  inSlot,
  lengthField,
  nameField,
  previewName,
  refField,
  resolveCarrier,
  withBind,
} from "./draft";
import {
  attachLengthHit,
  lengthHover,
  lengthLabel,
  lengthValue,
  resolveLengthExpr,
} from "./length";
import { scopeFromTrace, toolScope } from "./scope";
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
  lengthField("<distance>"),
  nameField(),
];

function carrierOf(session: ParallelSession, scope: Scope) {
  return resolveCarrier(session.carrierRef, session.carrier, scope);
}

function distAt(hit: PlaceHit, geom: LineLike): number {
  const at = hit.point.kind === "free" ? hit.world : hit.point.at;
  return signedDist(at, geom);
}

function distExpr(
  session: ParallelSession,
  carrier: NonNullable<ReturnType<typeof carrierOf>>,
  hit: PlaceHit,
  scope: Scope,
) {
  const bound = resolveLengthExpr(session, scope);
  if (isPinnedPoint(hit.point)) {
    if (!bound || bound.kind === "num") {
      return {
        kind: "call" as const,
        name: "signedDist",
        args: [exprOfPlace(hit.point), carrier.expr],
      };
    }
    return bound;
  }
  if (hit.length) return hit.length.expr;
  if (bound) return bound;
  return { kind: "num" as const, value: round(distAt(hit, carrier.geom)) };
}

function carrierLabel(session: ParallelSession, scope: Scope, place: PlaceHit | undefined): string {
  if (session.carrierRef.trim()) return session.carrierRef.trim();
  const c = carrierOf(session, scope);
  if (c) return printExpr(c.expr);
  if (place?.carrier) return place.carrier.bind;
  return "carrier";
}

export const parallelLine: Tool<ParallelSession> = {
  spec: {
    id: "parallelLine",
    title: "Parallel line",
    hint: "Type or click a line, then set the signed offset distance or a slider.",
    prefix: "par",
    aliases: ["offset", "parallel"],
  },
  start: () => ({ verb: "parallelLine", focus: "carrier", carrierRef: "", typed: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as ParallelSession["focus"] }),
  hit(session, hit, ctx) {
    if (!carrierOf(session, toolScope(ctx))) {
      const filter = ctx.keys ? { keys: ctx.keys, print: ctx.print } : undefined;
      const carrier = snapLineCarrier(
        ctx.trace,
        hit.world,
        ctx.camera,
        ctx.size,
        undefined,
        filter,
      );
      return carrier ? { ...hit, carrier } : hit;
    }
    return attachLengthHit(hit, ctx, session, ["distance"]);
  },
  hover(session, hit, trace, scope) {
    if (!carrierOf(session, scope ?? scopeFromTrace(trace))) {
      if (!hit.carrier) return undefined;
      return hoverBind(trace, hit.carrier.bind);
    }
    return lengthHover(hit, trace) ?? hoverPlace(hit.point, trace);
  },
  click(session, hit, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier) {
      if (!hit.carrier || hit.carrier.geom.kind === "circle") return { session };
      return {
        session: {
          ...session,
          carrier: { expr: exprOfPrint(hit.carrier.bind), geom: hit.carrier.geom },
          carrierRef: hit.carrier.bind,
          focus: session.focus === "name" ? "name" : "typed",
        },
      };
    }
    if (
      hit.length &&
      resolveLengthExpr(session, scope) === undefined &&
      !isPinnedPoint(hit.point)
    ) {
      return {
        insert: withBind(session, {
          from: "parallelLine",
          args: [carrier.expr, hit.length.expr],
        }),
      };
    }
    return {
      insert: withBind(session, {
        from: "parallelLine",
        args: [carrier.expr, distExpr(session, carrier, hit, scope)],
      }),
    };
  },
  commit(session, _place, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier) {
      if (session.focus !== "carrier") return { session: { ...session, focus: "carrier" } };
      return undefined;
    }
    const bound = resolveLengthExpr(session, scope);
    if (bound) {
      return { insert: withBind(session, { from: "parallelLine", args: [carrier.expr, bound] }) };
    }
    if (session.focus === "name") return { session: { ...session, focus: "typed" } };
    if (session.focus === "carrier") return { session: { ...session, focus: "typed" } };
    return undefined;
  },
  ghost(session, place, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier) return undefined;
    if (resolveLengthExpr(session, scope) !== undefined) {
      const fallback = place?.length?.value ?? 0;
      return {
        kind: "parallelLine",
        geom: carrier.geom,
        distance: lengthValue(session, scope, fallback),
      };
    }
    if (place && isPinnedPoint(place.point)) {
      return { kind: "parallelLine", geom: carrier.geom, distance: distAt(place, carrier.geom) };
    }
    if (place?.length) {
      return {
        kind: "parallelLine",
        geom: carrier.geom,
        distance: lengthValue(session, scope, place.length.value),
      };
    }
    if (!place) return undefined;
    return { kind: "parallelLine", geom: carrier.geom, distance: distAt(place, carrier.geom) };
  },
  preview(session, place, scope): Preview {
    const spec = parallelLine.spec;
    const bind = previewName(session, spec.prefix);
    const p = place?.point ?? undefined;
    const name = inSlot(session.focus === "name", bind);
    const gTok = inSlot(session.focus === "carrier", carrierLabel(session, scope, place));
    const dLabel = lengthLabel(session, scope, "distance");
    const carrier = carrierOf(session, scope);
    if (!carrier) {
      const d = inSlot(session.focus === "typed", dLabel);
      return {
        line: `const ${name} = parallelLine(${gTok}, ${d})`,
        hint: place?.carrier
          ? `Type a line name or click ${place.carrier.bind}. Tab for distance or name.`
          : spec.hint,
      };
    }
    if (p && isPinnedPoint(p) && resolveLengthExpr(session, scope) === undefined) {
      return {
        line: previewCall(
          "parallelLine",
          [carrier.expr, exprOfPlace(p)],
          scope.used,
          ([g, q]) =>
            `parallelLine(${inSlot(session.focus === "carrier", g)}, signedDist(${q}, ${g}))`,
          name,
        ),
        hint: "Click a point to pin signedDist(), or type a distance. Tab to name it.",
      };
    }
    if (place?.length && resolveLengthExpr(session, scope) === undefined) {
      return {
        line: previewCall(
          "parallelLine",
          [carrier.expr, place.length.expr],
          scope.used,
          ([g, d]) => `parallelLine(${inSlot(session.focus === "carrier", g)}, ${d})`,
          name,
        ),
        hint: "Click to reuse that length. Tab to name it.",
      };
    }
    const bound = resolveLengthExpr(session, scope);
    const shown =
      dLabel !== "distance"
        ? dLabel
        : place
          ? String(round(distAt(place, carrier.geom)))
          : "distance";
    return {
      line: previewCall(
        "parallelLine",
        [carrier.expr, ...(bound ? [bound] : [])],
        scope.used,
        ([g, n]) =>
          `parallelLine(${inSlot(session.focus === "carrier", g)}, ${inSlot(session.focus === "typed", n ?? shown)})`,
        name,
      ),
      hint: "Type a distance, slider, or field (-shelf.distance), click to reuse, measure, or click a point for signedDist(). Tab to name it.",
    };
  },
};
