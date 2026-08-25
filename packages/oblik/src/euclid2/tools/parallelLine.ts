import type { LineLike } from "../../geom";
import { signedDist } from "../../geom/ops";
import { snapLineCarrier } from "../pick";
import { exprOfPlace, hoverBind, previewCall, round } from "./common";
import { inSlot, nameField, parseNum, previewName, typedField, withBind } from "./draft";
import type { Field, PlaceHit, Preview, Tool, ToolSession } from "./types";

type ParallelSession = Extract<ToolSession, { verb: "parallelLine" }>;
type WithCarrier = ParallelSession & { carrier: NonNullable<ParallelSession["carrier"]> };

const fields: Field<ParallelSession>[] = [
  typedField(() => true),
  nameField(),
];

function distAt(hit: PlaceHit, geom: LineLike): number {
  const at = hit.point.kind === "free" ? hit.world : hit.point.at;
  return signedDist(at, geom);
}

function distExpr(session: WithCarrier, hit: PlaceHit) {
  if (hit.point.kind !== "free") {
    return {
      kind: "call" as const,
      name: "signedDist",
      args: [exprOfPlace(hit.point), session.carrier.expr],
    };
  }
  const typed = parseNum(session.typed);
  if (typed != null) return { kind: "num" as const, value: round(typed) };
  return { kind: "num" as const, value: round(distAt(hit, session.carrier.geom)) };
}

export const parallelLine: Tool<ParallelSession> = {
  spec: {
    id: "parallelLine",
    title: "Parallel line",
    hint: "Click a line or segment, then set the signed offset distance.",
    prefix: "par",
    aliases: ["offset", "parallel"],
  },
  start: () => ({ verb: "parallelLine", focus: "typed", typed: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as ParallelSession["focus"] }),
  hit(session, hit, ctx) {
    if (session.carrier) return hit;
    const carrier = snapLineCarrier(ctx.trace, hit.world, ctx.camera, ctx.size);
    return carrier ? { ...hit, carrier } : hit;
  },
  hover(session, hit, trace) {
    if (session.carrier || !hit.carrier) return null;
    return hoverBind(trace, hit.carrier.bind);
  },
  click(session, hit) {
    if (!session.carrier) {
      if (!hit.carrier) return { session };
      return {
        session: {
          ...session,
          carrier: { expr: { kind: "ref", name: hit.carrier.bind }, geom: hit.carrier.geom },
          focus: session.focus === "name" ? "name" : "typed",
        },
      };
    }
    return {
      insert: withBind(session, { from: "parallelLine", args: [session.carrier.expr, distExpr(session, hit)] }),
    };
  },
  commit(session) {
    if (!session.carrier) {
      if (session.focus === "name") return { session };
      return null;
    }
    const typed = parseNum(session.typed);
    if (typed != null) {
      return {
        insert: withBind(session, {
          from: "parallelLine",
          args: [session.carrier.expr, { kind: "num", value: round(typed) }],
        }),
      };
    }
    if (session.focus === "name") return { session: { ...session, focus: "typed" } };
    return null;
  },
  ghost(session, place) {
    if (!session.carrier) return null;
    const typed = parseNum(session.typed);
    if (typed != null) return { kind: "parallelLine", geom: session.carrier.geom, distance: typed };
    if (!place) return null;
    return { kind: "parallelLine", geom: session.carrier.geom, distance: distAt(place, session.carrier.geom) };
  },
  preview(session, place, usedNames): Preview {
    const spec = parallelLine.spec;
    const bind = previewName(session, spec.prefix);
    const p = place?.point ?? null;
    const name = inSlot(session.focus === "name", bind);
    if (!session.carrier) {
      const d = inSlot(session.focus === "typed", session.typed?.trim() || "distance");
      if (place?.carrier) {
        return {
          line: `const ${name} = parallelLine(${place.carrier.bind}, ${d})`,
          hint: `Click ${place.carrier.bind} to select the carrier. Type a distance, or Tab to name it.`,
        };
      }
      return { line: `const ${name} = parallelLine(carrier, ${d})`, hint: spec.hint };
    }
    if (p && p.kind !== "free" && parseNum(session.typed) == null) {
      return {
        line: previewCall(
          "parallelLine",
          [session.carrier.expr, exprOfPlace(p)],
          usedNames,
          ([g, q]) => `parallelLine(${g}, signedDist(${q}, ${g}))`,
          name,
        ),
        hint: "Click a point to pin signedDist(), or type a distance. Tab to name it.",
      };
    }
    const shown = session.typed?.trim() || (place ? String(round(distAt(place, session.carrier.geom))) : "distance");
    return {
      line: previewCall(
        "parallelLine",
        [session.carrier.expr, ...(parseNum(session.typed) != null ? [{ kind: "num" as const, value: parseNum(session.typed)! }] : [])],
        usedNames,
        ([g, n]) => `parallelLine(${g}, ${inSlot(session.focus === "typed", n ?? shown)})`,
        name,
      ),
      hint: "Type a distance and Enter, or click to measure. Tab to name it.",
    };
  },
};
