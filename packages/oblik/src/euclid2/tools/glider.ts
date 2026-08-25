import type { Circle, LineLike, Segment } from "../../geom";
import {
  circleUnitAt,
  lineSAt,
  pointOnCircleValue,
  pointOnLineValue,
  pointOnSegmentValue,
  segmentTAt,
} from "../../geom/gliders";
import type { Expr } from "../../source/expr";
import { snapCircleCarrier, snapLineCarrier } from "../pick";
import { hoverBind, previewCall, round } from "./common";
import { inSlot, nameField, previewName, refField, withBind } from "./draft";
import { scopeFromTrace } from "./scope";
import type { Field, GliderCarrier, PlaceHit, Preview, Scope, Tool, ToolSession } from "./types";

type GliderSession = Extract<ToolSession, { verb: "glider" }>;

const fields: Field<GliderSession>[] = [
  refField(
    "carrier",
    "<geom>",
    "carrier",
    (s) => s.carrierRef,
    (s, raw) => ({ ...s, carrierRef: raw }),
  ),
  nameField(),
];

function carrierOf(session: GliderSession, scope: Scope): GliderCarrier | undefined {
  if (session.carrier) return session.carrier;
  const t = session.carrierRef.trim();
  if (!t) return undefined;
  const line = scope.carriers[t];
  if (line) {
    const geom = line.geom;
    if (geom.kind === "segment") return { kind: "segment", expr: line.expr, geom };
    return { kind: "line", expr: line.expr, geom };
  }
  const circle = scope.circles[t];
  if (circle) return { kind: "circle", expr: circle.expr, geom: circle.geom };
}

function carrierLabel(session: GliderSession, scope: Scope, place: PlaceHit | null): string {
  if (session.carrierRef.trim()) return session.carrierRef.trim();
  const c = carrierOf(session, scope);
  if (c && c.expr.kind === "ref") return c.expr.name;
  if (place?.carrier) return place.carrier.bind;
  if (place?.circle) return place.circle.bind;
  return "geom";
}

function ctorName(carrier: GliderCarrier): string {
  if (carrier.kind === "segment") return "pointOnSegment";
  if (carrier.kind === "circle") return "pointOnCircle";
  return "pointOnLine";
}

function gliderInsert(carrier: GliderCarrier, at: { x: number; y: number }) {
  if (carrier.kind === "segment") {
    return {
      from: "pointOnSegment" as const,
      args: [carrier.expr, { kind: "num" as const, value: round(segmentTAt(carrier.geom, at)) }],
    };
  }
  if (carrier.kind === "circle") {
    const { ux, uy } = circleUnitAt(carrier.geom, at);
    return {
      from: "pointOnCircle" as const,
      args: [
        carrier.expr,
        { kind: "num" as const, value: round(ux) },
        { kind: "num" as const, value: round(uy) },
      ],
    };
  }
  return {
    from: "pointOnLine" as const,
    args: [carrier.expr, { kind: "num" as const, value: round(lineSAt(carrier.geom, at)) }],
  };
}

function ghostPoint(carrier: GliderCarrier, at: { x: number; y: number }) {
  if (carrier.kind === "segment") {
    const g = pointOnSegmentValue(carrier.geom, segmentTAt(carrier.geom, at));
    return { kind: "point" as const, at: { x: g.x, y: g.y } };
  }
  if (carrier.kind === "circle") {
    const { ux, uy } = circleUnitAt(carrier.geom, at);
    const g = pointOnCircleValue(carrier.geom, ux, uy);
    return { kind: "point" as const, at: { x: g.x, y: g.y } };
  }
  const g = pointOnLineValue(carrier.geom, lineSAt(carrier.geom, at));
  return { kind: "point" as const, at: { x: g.x, y: g.y } };
}

function carrierFromHit(hit: PlaceHit): GliderCarrier | null {
  if (hit.carrier) {
    const geom = hit.carrier.geom;
    const expr: Expr = { kind: "ref", name: hit.carrier.bind };
    if (geom.kind === "segment") return { kind: "segment", expr, geom };
    return { kind: "line", expr, geom };
  }
  if (hit.circle) {
    return { kind: "circle", expr: { kind: "ref", name: hit.circle.bind }, geom: hit.circle.geom };
  }
  return null;
}

export const glider: Tool<GliderSession> = {
  spec: {
    id: "glider",
    title: "Glider",
    hint: "Click a line, segment, or circle, then click where the point should slide.",
    prefix: "g",
    aliases: ["pointOn", "onLine", "onCircle"],
  },
  start: () => ({ verb: "glider", focus: "carrier", carrierRef: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as GliderSession["focus"] }),
  hit(session, hit, ctx) {
    if (carrierOf(session, scopeFromTrace(ctx.trace))) return hit;
    const line = snapLineCarrier(ctx.trace, hit.world, ctx.camera, ctx.size);
    if (line) return { ...hit, carrier: line };
    const circle = snapCircleCarrier(ctx.trace, hit.world, ctx.camera, ctx.size);
    if (circle) return { ...hit, circle };
    return hit;
  },
  hover(session, hit, trace) {
    if (!carrierOf(session, scopeFromTrace(trace))) {
      if (hit.carrier) return hoverBind(trace, hit.carrier.bind);
      if (hit.circle) return hoverBind(trace, hit.circle.bind);
      return null;
    }
    return null;
  },
  click(session, hit, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier) {
      const picked = carrierFromHit(hit);
      if (!picked) return { session };
      return {
        session: {
          ...session,
          carrier: picked,
          carrierRef: picked.expr.kind === "ref" ? picked.expr.name : session.carrierRef,
          focus: session.focus === "name" ? "name" : "carrier",
        },
      };
    }
    const at = hit.point.kind === "free" ? hit.world : hit.point.at;
    return { insert: withBind(session, gliderInsert(carrier, at)) };
  },
  commit(session, place, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier) {
      if (session.focus !== "carrier") return { session: { ...session, focus: "carrier" } };
      return null;
    }
    if (place) {
      const at = place.point.kind === "free" ? place.world : place.point.at;
      return { insert: withBind(session, gliderInsert(carrier, at)) };
    }
    if (session.focus === "name") return { session: { ...session, focus: "carrier" } };
    return null;
  },
  ghost(session, place, scope) {
    const carrier = carrierOf(session, scope);
    if (!carrier || !place) return null;
    return ghostPoint(carrier, place.point.at);
  },
  preview(session, place, scope): Preview {
    const bind = previewName(session, glider.spec.prefix);
    const name = inSlot(session.focus === "name", bind);
    const gTok = inSlot(session.focus === "carrier", carrierLabel(session, scope, place));
    const carrier = carrierOf(session, scope);
    if (!carrier) {
      return {
        line: `const ${name} = pointOnLine(${gTok}, s)`,
        hint: place?.carrier
          ? `Type a geometry name or click ${place.carrier.bind}. Then click where the glider goes.`
          : place?.circle
            ? `Type a geometry name or click ${place.circle.bind}. Then click where the glider goes.`
            : glider.spec.hint,
      };
    }
    const at = place?.point.at ?? { x: 0, y: 0 };
    const job = gliderInsert(carrier, at);
    return {
      line: previewCall(job.from, job.args, scope.used, ([g, a, b]) => {
        if (carrier.kind === "circle") {
          return `${job.from}(${inSlot(session.focus === "carrier", g)}, ${a}, ${b})`;
        }
        return `${job.from}(${inSlot(session.focus === "carrier", g)}, ${a})`;
      }, name),
      hint: "Click on the geometry to place the glider. Tab to name it.",
    };
  },
};
