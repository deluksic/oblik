import type { LineLike } from "../../geom";
import { signedDist } from "../../geom/ops";
import { snapLineCarrier } from "../pick";
import { exprOfPlace, hoverBind, previewCall, round } from "./common";
import type { PlaceHit, Preview, Tool, ToolSession } from "./types";

type ParallelSession = Extract<ToolSession, { verb: "parallelLine" }>;
type WithCarrier = ParallelSession & { carrier: NonNullable<ParallelSession["carrier"]> };

function distAt(hit: PlaceHit, geom: LineLike): number {
  const at = hit.point.kind === "free" ? hit.world : hit.point.at;
  return signedDist(at, geom);
}

function distExpr(session: WithCarrier, hit: PlaceHit) {
  if (hit.point.kind === "free") {
    return { kind: "num" as const, value: round(distAt(hit, session.carrier.geom)) };
  }
  return {
    kind: "call" as const,
    name: "signedDist",
    args: [exprOfPlace(hit.point), session.carrier.expr],
  };
}

export const parallelLine: Tool<ParallelSession> = {
  spec: {
    id: "parallelLine",
    title: "Parallel line",
    hint: "Click a line or segment, then set the signed offset distance.",
    prefix: "par",
    aliases: ["offset", "parallel"],
    draft: true,
  },
  start: () => ({ verb: "parallelLine" }),
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
          verb: "parallelLine",
          carrier: { expr: { kind: "ref", name: hit.carrier.bind }, geom: hit.carrier.geom },
          typed: session.typed,
        },
      };
    }
    return {
      insert: { from: "parallelLine", args: [session.carrier.expr, distExpr(session, hit)] },
    };
  },
  ghost(session, place) {
    if (!session.carrier || !place) return null;
    return { kind: "parallelLine", geom: session.carrier.geom, distance: distAt(place, session.carrier.geom) };
  },
  preview(session, place, usedNames): Preview {
    const spec = parallelLine.spec;
    const p = place?.point ?? null;
    if (!session.carrier) {
      if (place?.carrier) {
        return {
          line: `const ${spec.prefix} = parallelLine(${place.carrier.bind}, distance)`,
          hint: `Click ${place.carrier.bind} to select the carrier.`,
        };
      }
      return { line: `const ${spec.prefix} = parallelLine(carrier, distance)`, hint: spec.hint };
    }
    if (p && p.kind !== "free") {
      return {
        line: previewCall(
          "parallelLine",
          [session.carrier.expr, exprOfPlace(p)],
          usedNames,
          ([g, q]) => `parallelLine(${g}, signedDist(${q}, ${g}))`,
        ),
        hint: "Click a point or crossing to pin signedDist(), or click the offset distance.",
      };
    }
    const d = place ? round(distAt(place, session.carrier.geom)) : null;
    return {
      line:
        d != null
          ? previewCall(
              "parallelLine",
              [session.carrier.expr, { kind: "num", value: d }],
              usedNames,
              ([g, n]) => `parallelLine(${g}, ${n})`,
            )
          : previewCall("parallelLine", [session.carrier.expr], usedNames, ([g]) => `parallelLine(${g}, distance)`),
      hint: "Click the signed offset distance from the carrier.",
    };
  },
};
