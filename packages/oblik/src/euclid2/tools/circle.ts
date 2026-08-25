import { printExpr } from "../../source/expr";
import { asPoint, dist, exprOfPlace, previewCall, round, sameRef } from "./common";
import {
  hitRef,
  inSlot,
  nameField,
  parseNum,
  previewName,
  refField,
  resolvePoint,
  typedField,
  withBind,
} from "./draft";
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
  typedField(() => true),
  nameField(),
];

function centerOf(session: CircleSession, scope: Scope): Placed | undefined {
  return resolvePoint(session.centerRef, session.center, scope);
}

function radiusExpr(session: CircleSession, center: Placed, hit: PlaceHit) {
  if (hit.point.kind !== "free" && !sameRef(center.expr, hit.point)) {
    return { kind: "call" as const, name: "dist", args: [center.expr, exprOfPlace(hit.point)] };
  }
  const typed = parseNum(session.typed);
  if (typed != null) return { kind: "num" as const, value: round(Math.max(0.05, typed)) };
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
    hint: "Center, then radius. Type a point name, or click. A point pins dist() instead of a literal.",
    prefix: "c",
  },
  start: () => ({ verb: "circle", focus: "center", centerRef: "", typed: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as CircleSession["focus"] }),
  click(session, hit, scope) {
    const center = centerOf(session, scope);
    if (!center) {
      return {
        session: {
          ...session,
          center: asPoint(hit),
          centerRef: hitRef(hit) || session.centerRef,
          focus: session.focus === "name" ? "name" : "typed",
        },
      };
    }
    return {
      insert: withBind(session, { from: "circle", args: [center.expr, radiusExpr(session, center, hit)] }),
    };
  },
  commit(session, _place, scope) {
    const center = centerOf(session, scope);
    if (!center) {
      if (session.focus !== "center") return { session: { ...session, focus: "center" } };
      return null;
    }
    const typed = parseNum(session.typed);
    if (typed != null) {
      return {
        insert: withBind(session, {
          from: "circle",
          args: [center.expr, { kind: "num", value: round(Math.max(0.05, typed)) }],
        }),
      };
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
    const typed = parseNum(session.typed);
    if (typed != null) {
      return { kind: "circle", center: center.at, radius: Math.max(0.05, typed) };
    }
    if (!place) return { kind: "circle", center: center.at, radius: 0.05 };
    return {
      kind: "circle",
      center: center.at,
      radius: Math.max(0.05, dist(place.point.at, center.at)),
    };
  },
  preview(session, place, scope): Preview {
    const spec = circle.spec;
    const bind = previewName(session, spec.prefix);
    const p = place?.point ?? null;
    const r = session.typed?.trim() || "radius";
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
    if (p && p.kind !== "free" && !sameRef(center.expr, p) && parseNum(session.typed) == null) {
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
    return {
      line: previewCall(
        "circle",
        [center.expr],
        scope.used,
        ([c]) => `circle(${inSlot(session.focus === "center", c)}, ${radius})`,
        name,
      ),
      hint: "Type a radius and Enter, click to measure, or click a point for dist(). Tab to name it.",
    };
  },
};
