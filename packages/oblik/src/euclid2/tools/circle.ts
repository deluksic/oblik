import { asPoint, dist, exprOfPlace, previewCall, round, sameRef } from "./common";
import type { PlaceHit, Placed, Preview, Tool, ToolSession } from "./types";

type CircleSession = Extract<ToolSession, { verb: "circle" }>;

function radiusExpr(center: Placed, hit: PlaceHit) {
  if (hit.point.kind !== "free" && !sameRef(center.expr, hit.point)) {
    return { kind: "call" as const, name: "dist", args: [center.expr, exprOfPlace(hit.point)] };
  }
  const r = Math.max(0.05, dist(hit.point.at, center.at));
  return { kind: "num" as const, value: round(r) };
}

export const circle: Tool<CircleSession> = {
  spec: {
    id: "circle",
    title: "Circle",
    hint: "Center, then radius. A point or crossing pins dist() instead of a literal.",
    prefix: "c",
    draft: true,
  },
  start: () => ({ verb: "circle" }),
  click(session, hit) {
    if (!session.center) return { session: { verb: "circle", center: asPoint(hit), typed: session.typed } };
    return { insert: { from: "circle", args: [session.center.expr, radiusExpr(session.center, hit)] } };
  },
  ghost(session, place) {
    if (!session.center) {
      const at = place?.point.at;
      return at ? { kind: "point", at } : null;
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
    const p = place?.point ?? null;
    if (!session.center) {
      if (p && p.kind !== "free") {
        return {
          line: previewCall("circle", [exprOfPlace(p)], usedNames, ([c]) => `circle(${c}, radius)`),
          hint: "Click to set the center. A crossing is inserted as its own named point.",
        };
      }
      return { line: `const ${spec.prefix} = circle(center, radius)`, hint: spec.hint };
    }
    if (p && p.kind !== "free" && !sameRef(session.center.expr, p)) {
      return {
        line: previewCall(
          "circle",
          [
            session.center.expr,
            { kind: "call", name: "dist", args: [session.center.expr, exprOfPlace(p)] },
          ],
          usedNames,
          ([c, d]) => `circle(${c}, ${d})`,
        ),
        hint: "Click to pin the radius to that distance.",
      };
    }
    return {
      line: previewCall("circle", [session.center.expr], usedNames, ([c]) => `circle(${c}, radius)`),
      hint: "Click the radius, or a point / crossing to pin dist().",
    };
  },
};
