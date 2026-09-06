import { printExpr } from "#source/expr";

import {
  asPoint,
  dist,
  exprOfPlace,
  hoverPlace,
  isPinnedPoint,
  previewCall,
  round,
  sameRef,
} from "./common";
import {
  hitRef,
  inSlot,
  lengthField,
  nameField,
  previewName,
  refField,
  resolvePoint,
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
import type { Field, PlaceHit, Placed, Preview, Scope, Tool, ToolSession } from "./types";

const { max } = Math;
type CircleSession = Extract<ToolSession, { verb: "circle" }>;

const fields: Field<CircleSession>[] = [
  refField(
    "center",
    "<center>",
    "point",
    (s) => s.centerRef,
    (s, raw) => ({ ...s, centerRef: raw }),
  ),
  lengthField("<radius>"),
  nameField(),
];

function centerOf(session: CircleSession, scope: Scope): Placed | undefined {
  return resolvePoint(session.centerRef, session.center, scope);
}

function radiusExpr(session: CircleSession, center: Placed, hit: PlaceHit, scope: Scope) {
  const bound = resolveLengthExpr(session, scope, { min: 0.05 });
  if (isPinnedPoint(hit.point) && !sameRef(center.expr, hit.point)) {
    if (!bound || bound.kind === "num") {
      return { kind: "call" as const, name: "dist", args: [center.expr, exprOfPlace(hit.point)] };
    }
    return bound;
  }
  if (hit.length) return hit.length.expr;
  if (bound) return bound;
  const r = max(0.05, dist(hit.point.at, center.at));
  return { kind: "num" as const, value: round(r) };
}

function centerLabel(session: CircleSession, scope: Scope, place: PlaceHit | undefined): string {
  const t = session.centerRef.trim();
  if (t) return t;
  const placed = centerOf(session, scope);
  if (placed) return printExpr(placed.expr);
  const p = place?.point;
  if (p && isPinnedPoint(p)) return printExpr(exprOfPlace(p));
  return "center";
}

export const circle: Tool<CircleSession> = {
  spec: {
    id: "circle",
    title: "Circle",
    hint: "Center, then radius, a slider, a length, or a point.",
    prefix: "c",
  },
  start: () => ({ verb: "circle", focus: "center", centerRef: "", typed: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as CircleSession["focus"] }),
  hit(session, hit, ctx) {
    if (!centerOf(session, toolScope(ctx))) return hit;
    return attachLengthHit(hit, ctx, session, ["radius"]);
  },
  hover(session, hit, trace, scope) {
    if (!centerOf(session, scope ?? scopeFromTrace(trace))) return hoverPlace(hit.point, trace);
    return lengthHover(hit, trace) ?? hoverPlace(hit.point, trace);
  },
  click(session, hit, scope) {
    const center = centerOf(session, scope);
    if (!center) {
      if (hit.length) return { session };
      return {
        session: {
          ...session,
          center: asPoint(hit),
          centerRef: hitRef(hit) || session.centerRef,
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
          from: "circle",
          args: [center.expr, hit.length.expr],
        }),
      };
    }
    return {
      insert: withBind(session, {
        from: "circle",
        args: [center.expr, radiusExpr(session, center, hit, scope)],
      }),
    };
  },
  commit(session, _place, scope) {
    const center = centerOf(session, scope);
    if (!center) {
      if (session.focus !== "center") return { session: { ...session, focus: "center" } };
      return undefined;
    }
    const bound = resolveLengthExpr(session, scope, { min: 0.05 });
    if (bound) {
      return { insert: withBind(session, { from: "circle", args: [center.expr, bound] }) };
    }
    if (session.focus === "name") return { session: { ...session, focus: "typed" } };
    if (session.focus === "center") return { session: { ...session, focus: "typed" } };
    return undefined;
  },
  ghost(session, place, scope) {
    const center = centerOf(session, scope);
    if (!center) {
      const at = place?.point.at;
      return at ? { kind: "point", at } : undefined;
    }
    if (resolveLengthExpr(session, scope) !== undefined) {
      const fallback = place?.length?.value ?? 0.05;
      return {
        kind: "circle",
        center: center.at,
        radius: max(0.05, lengthValue(session, scope, fallback)),
      };
    }
    if (place && isPinnedPoint(place.point) && !sameRef(center.expr, place.point)) {
      return {
        kind: "circle",
        center: center.at,
        radius: max(0.05, dist(place.point.at, center.at)),
      };
    }
    if (place?.length) {
      return {
        kind: "circle",
        center: center.at,
        radius: max(0.05, lengthValue(session, scope, place.length.value)),
      };
    }
    if (!place) return { kind: "circle", center: center.at, radius: 0.05 };
    return {
      kind: "circle",
      center: center.at,
      radius: max(0.05, lengthValue(session, scope, dist(place.point.at, center.at))),
    };
  },
  preview(session, place, scope): Preview {
    const spec = circle.spec;
    const bind = previewName(session, spec.prefix);
    const p = place?.point ?? undefined;
    const r = lengthLabel(session, scope, "radius");
    const name = inSlot(session.focus === "name", bind);
    const radius = inSlot(session.focus === "typed", r);
    const cTok = inSlot(session.focus === "center", centerLabel(session, scope, place));
    const center = centerOf(session, scope);
    if (!center) {
      if (p && isPinnedPoint(p) && !session.centerRef.trim()) {
        return {
          line: previewCall(
            "circle",
            [exprOfPlace(p)],
            scope.used,
            ([c]) => `circle(${inSlot(session.focus === "center", c)}, ${radius})`,
            name,
          ),
          hint: "Type a point name or click to set the center. Tab for radius or name.",
        };
      }
      return { line: `const ${name} = circle(${cTok}, ${radius})`, hint: spec.hint };
    }
    if (
      p &&
      isPinnedPoint(p) &&
      !sameRef(center.expr, p) &&
      resolveLengthExpr(session, scope) === undefined
    ) {
      return {
        line: previewCall(
          "circle",
          [center.expr, { kind: "call", name: "dist", args: [center.expr, exprOfPlace(p)] }],
          scope.used,
          ([c, d]) => `circle(${inSlot(session.focus === "center", c)}, ${d})`,
          name,
        ),
        hint: "Click to pin the radius to that distance. Tab to name it.",
      };
    }
    if (place?.length && resolveLengthExpr(session, scope) === undefined) {
      return {
        line: previewCall(
          "circle",
          [center.expr, place.length.expr],
          scope.used,
          ([c, d]) => `circle(${inSlot(session.focus === "center", c)}, ${d})`,
          name,
        ),
        hint: "Click to reuse that length. Tab to name it.",
      };
    }
    const bound = resolveLengthExpr(session, scope);
    return {
      line: previewCall(
        "circle",
        [center.expr, ...(bound ? [bound] : [])],
        scope.used,
        ([c, d]) =>
          `circle(${inSlot(session.focus === "center", c)}, ${inSlot(session.focus === "typed", d ?? r)})`,
        name,
      ),
      hint: "Type a radius, slider, or field (reach.radius), click to reuse, measure, or click a point for dist(). Tab to name it.",
    };
  },
};
