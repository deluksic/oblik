import { printExpr } from "../../source/expr";
import { asPoint, dist, exprOfPlace, hoverBind, previewCall, round, sameRef } from "./common";
import {
  attachLengthHit,
  lengthLabel,
  lengthValue,
  resolveLengthExpr,
  resolveLengthRef,
} from "./length";
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
import { scopeFromTrace } from "./scope";
import type { Field, PlaceHit, Placed, Preview, Scope, Tool, ToolSession } from "./types";

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
  if (hit.point.kind !== "free" && !sameRef(center.expr, hit.point) && resolveLengthRef(session.typed, scope, session.lengthReuse) == null) {
    return { kind: "call" as const, name: "dist", args: [center.expr, exprOfPlace(hit.point)] };
  }
  const bound = resolveLengthExpr(session, scope, { min: 0.05 });
  if (bound) return bound;
  if (hit.length) return { kind: "ref" as const, name: hit.length.bind };
  const r = Math.max(0.05, dist(hit.point.at, center.at));
  return { kind: "num" as const, value: round(r) };
}

function centerLabel(session: CircleSession, scope: Scope, place: PlaceHit | null): string {
  const t = session.centerRef.trim();
  if (t) return t;
  const placed = centerOf(session, scope);
  if (placed) return printExpr(placed.expr);
  const p = place?.point;
  if (p && p.kind !== "free") return printExpr(exprOfPlace(p));
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
    if (!centerOf(session, scopeFromTrace(ctx.trace))) return hit;
    return attachLengthHit(hit, ctx);
  },
  hover(session, hit, trace) {
    if (!centerOf(session, scopeFromTrace(trace))) return null;
    if (hit.length) return hoverBind(trace, hit.length.bind);
    return null;
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
    if (hit.length && resolveLengthExpr(session, scope) == null) {
      return {
        insert: withBind(session, {
          from: "circle",
          args: [center.expr, { kind: "ref", name: hit.length.bind }],
        }),
      };
    }
    return {
      insert: withBind(session, { from: "circle", args: [center.expr, radiusExpr(session, center, hit, scope)] }),
    };
  },
  commit(session, _place, scope) {
    const center = centerOf(session, scope);
    if (!center) {
      if (session.focus !== "center") return { session: { ...session, focus: "center" } };
      return null;
    }
    const bound = resolveLengthExpr(session, scope, { min: 0.05 });
    if (bound) {
      return { insert: withBind(session, { from: "circle", args: [center.expr, bound] }) };
    }
    if (session.focus === "name") return { session: { ...session, focus: "typed" } };
    if (session.focus === "center") return { session: { ...session, focus: "typed" } };
    return null;
  },
  ghost(session, place, scope) {
    const center = centerOf(session, scope);
    if (!center) {
      const at = place?.point.at;
      return at ? { kind: "point", at } : null;
    }
    if (resolveLengthExpr(session, scope) != null || place?.length) {
      const fallback = place?.length?.value ?? 0.05;
      return { kind: "circle", center: center.at, radius: Math.max(0.05, lengthValue(session, scope, fallback)) };
    }
    if (!place) return { kind: "circle", center: center.at, radius: 0.05 };
    return {
      kind: "circle",
      center: center.at,
      radius: Math.max(0.05, lengthValue(session, scope, dist(place.point.at, center.at))),
    };
  },
  preview(session, place, scope): Preview {
    const spec = circle.spec;
    const bind = previewName(session, spec.prefix);
    const p = place?.point ?? null;
    const r = lengthLabel(session, scope, "radius");
    const name = inSlot(session.focus === "name", bind);
    const radius = inSlot(session.focus === "typed", r);
    const cTok = inSlot(session.focus === "center", centerLabel(session, scope, place));
    const center = centerOf(session, scope);
    if (!center) {
      if (p && p.kind !== "free" && !session.centerRef.trim()) {
        return {
          line: previewCall("circle", [exprOfPlace(p)], scope.used, ([c]) => `circle(${inSlot(session.focus === "center", c)}, ${radius})`, name),
          hint: "Type a point name or click to set the center. Tab for radius or name.",
        };
      }
      return { line: `const ${name} = circle(${cTok}, ${radius})`, hint: spec.hint };
    }
    if (place?.length && resolveLengthExpr(session, scope) == null) {
      return {
        line: previewCall(
          "circle",
          [center.expr, { kind: "ref", name: place.length.bind }],
          scope.used,
          ([c, d]) => `circle(${inSlot(session.focus === "center", c)}, ${d})`,
          name,
        ),
        hint: "Click to reuse that slider. Tab to name it.",
      };
    }
    if (p && p.kind !== "free" && !sameRef(center.expr, p) && resolveLengthExpr(session, scope) == null) {
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
    const bound = resolveLengthExpr(session, scope);
    return {
      line: previewCall(
        "circle",
        [center.expr, ...(bound ? [bound] : [])],
        scope.used,
        ([c, d]) => `circle(${inSlot(session.focus === "center", c)}, ${inSlot(session.focus === "typed", d ?? r)})`,
        name,
      ),
      hint: "Type a radius or slider name, click a slider, measure, or click a point for dist(). Tab to name it.",
    };
  },
};
