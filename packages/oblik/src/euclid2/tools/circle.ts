import { asPoint, dist, exprOfPlace, previewCall, round, sameRef } from "./common";
import { inSlot, nameField, parseNum, previewName, typedField, withBind } from "./draft";
import type { Field, PlaceHit, Placed, Preview, Tool, ToolSession } from "./types";

type CircleSession = Extract<ToolSession, { verb: "circle" }>;

const fields: Field<CircleSession>[] = [
  typedField(() => true),
  nameField(),
];

function radiusExpr(session: CircleSession, center: Placed, hit: PlaceHit) {
  if (hit.point.kind !== "free" && !sameRef(center.expr, hit.point)) {
    return { kind: "call" as const, name: "dist", args: [center.expr, exprOfPlace(hit.point)] };
  }
  const typed = parseNum(session.typed);
  if (typed != null) return { kind: "num" as const, value: round(Math.max(0.05, typed)) };
  const r = Math.max(0.05, dist(hit.point.at, center.at));
  return { kind: "num" as const, value: round(r) };
}

export const circle: Tool<CircleSession> = {
  spec: {
    id: "circle",
    title: "Circle",
    hint: "Center, then radius. A point or crossing pins dist() instead of a literal.",
    prefix: "c",
  },
  start: () => ({ verb: "circle", focus: "typed", typed: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as CircleSession["focus"] }),
  click(session, hit) {
    if (!session.center) {
      return {
        session: {
          ...session,
          center: asPoint(hit),
          focus: session.focus === "name" ? "name" : "typed",
        },
      };
    }
    return {
      insert: withBind(session, { from: "circle", args: [session.center.expr, radiusExpr(session, session.center, hit)] }),
    };
  },
  commit(session) {
    if (!session.center) {
      if (session.focus === "name") return { session };
      return null;
    }
    const typed = parseNum(session.typed);
    if (typed != null) {
      return {
        insert: withBind(session, {
          from: "circle",
          args: [session.center.expr, { kind: "num", value: round(Math.max(0.05, typed)) }],
        }),
      };
    }
    if (session.focus === "name") return { session: { ...session, focus: "typed" } };
    return null;
  },
  ghost(session, place) {
    if (!session.center) {
      const at = place?.point.at;
      return at ? { kind: "point", at } : null;
    }
    const typed = parseNum(session.typed);
    if (typed != null) {
      return { kind: "circle", center: session.center.at, radius: Math.max(0.05, typed) };
    }
    if (!place) return { kind: "circle", center: session.center.at, radius: 0.05 };
    return {
      kind: "circle",
      center: session.center.at,
      radius: Math.max(0.05, dist(place.point.at, session.center.at)),
    };
  },
  preview(session, place, usedNames): Preview {
    const spec = circle.spec;
    const bind = previewName(session, spec.prefix);
    const p = place?.point ?? null;
    const r = session.typed?.trim() || "radius";
    const name = inSlot(session.focus === "name", bind);
    const radius = inSlot(session.focus === "typed", r);
    if (!session.center) {
      if (p && p.kind !== "free") {
        return {
          line: previewCall("circle", [exprOfPlace(p)], usedNames, ([c]) => `circle(${c}, ${radius})`, name),
          hint: "Click to set the center. Type a radius, or Tab to name it.",
        };
      }
      return { line: `const ${name} = circle(center, ${radius})`, hint: spec.hint };
    }
    if (p && p.kind !== "free" && !sameRef(session.center.expr, p) && parseNum(session.typed) == null) {
      return {
        line: previewCall(
          "circle",
          [session.center.expr, { kind: "call", name: "dist", args: [session.center.expr, exprOfPlace(p)] }],
          usedNames,
          ([c, d]) => `circle(${c}, ${d})`,
          name,
        ),
        hint: "Click to pin the radius to that distance. Tab to name it.",
      };
    }
    return {
      line: previewCall("circle", [session.center.expr], usedNames, ([c]) => `circle(${c}, ${radius})`, name),
      hint: "Type a radius and Enter, click to measure, or click a point for dist(). Tab to name it.",
    };
  },
};
