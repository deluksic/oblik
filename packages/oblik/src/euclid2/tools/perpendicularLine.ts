import type { Expr } from "#source/expr";
import type { LineLike } from "#geom";
import { lineBasis } from "#geom/ops";
import { add, perp } from "#geom/vec";

import { snapLineCarrier } from "../pick";
import { asPoint, exprOfPlace, isPinnedPoint, pinnedPointLabel, previewCall } from "./common";
import { inSlot, previewName, slotLabel, withBind } from "./draft";
import { defineSlotTool } from "./slot";
import type { PlaceCtx, PlaceHit, Placed, Preview, Tool, ToolSession } from "./types";

type PerpSession = Extract<ToolSession, { verb: "perpendicularLine" }>;

function perpGhostLine(carrier: LineLike, through: { x: number; y: number }) {
  const { dir } = lineBasis(carrier);
  const pd = perp(dir);
  return { kind: "line" as const, a: through, b: add(through, pd) };
}

const snapCarrier = (hit: PlaceHit, ctx: PlaceCtx): PlaceHit => {
  const filter = ctx.keys ? { keys: ctx.keys, print: ctx.print } : undefined;
  const carrier = snapLineCarrier(ctx.trace, hit.world, ctx.camera, ctx.size, undefined, filter);
  return carrier ? { ...hit, carrier } : hit;
};

export const perpendicularLine: Tool<PerpSession> = defineSlotTool<
  PerpSession,
  { carrier: { expr: Expr; geom: LineLike }; through: Placed }
>(
  {
    id: "perpendicularLine",
    title: "Perpendicular line",
    hint: "A line, then a point — infinite perpendicular through the point.",
    prefix: "perp",
    aliases: ["perpendicular", "normal"],
  },
  {
    slots: {
      carrier: { id: "carrier", kind: "carrier", placeholder: "<line>", snap: snapCarrier },
      through: { id: "through", kind: "point", placeholder: "<point>", viaClick: true },
    },
    click(session, hit, _scope, { carrier }) {
      return {
        insert: withBind(session, {
          from: "perpendicularLine",
          args: [carrier.expr, asPoint(hit).expr],
        }),
      };
    },
    commit(session, _place, _scope, { carrier, through }) {
      return {
        insert: withBind(session, {
          from: "perpendicularLine",
          args: [carrier.expr, through.expr],
        }),
      };
    },
    ghost(_session, place, _scope, { carrier, through }) {
      if (!carrier) return undefined;
      const at = through?.at ?? place?.point.at;
      if (!at) return undefined;
      return perpGhostLine(carrier.geom, at);
    },
    preview(session, place, scope, { carrier, through }): Preview {
      const spec = perpendicularLine.spec;
      const bind = previewName(session, spec.prefix);
      const name = inSlot(session.focus === "name", bind);
      const gTok = inSlot(
        session.focus === "carrier",
        slotLabel(session.carrierRef, carrier, place?.carrier?.bind, "line"),
      );
      const pTok = inSlot(
        session.focus === "through",
        slotLabel(session.throughRef, through, pinnedPointLabel(place), "point"),
      );
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
      const p = place?.point ?? undefined;
      if (p && isPinnedPoint(p) && !session.throughRef.trim()) {
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
  },
);
