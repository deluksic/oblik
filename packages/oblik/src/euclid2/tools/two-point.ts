import { asPoint, exprOfPlace, previewCall } from "./common";
import type { Preview, Tool, ToolSession } from "./types";

type TwoPointId = "line" | "segment";
type TwoPointSession = Extract<ToolSession, { verb: TwoPointId }>;

export function defineTwoPoint(spec: Tool<TwoPointSession>["spec"]): Tool<TwoPointSession> {
  return {
    spec,
    start: () => ({ verb: spec.id }),
    click(session, hit) {
      if (!session.a) return { session: { verb: spec.id, a: asPoint(hit) } };
      return { insert: { from: spec.id, args: [session.a.expr, asPoint(hit).expr] } };
    },
    ghost(session, place) {
      const cursor = place?.point.at;
      if (!cursor) return null;
      if (!session.a) return { kind: "point", at: cursor };
      return { kind: spec.id, a: session.a.at, b: cursor };
    },
    preview(session, place, usedNames): Preview {
      const p = place?.point ?? null;
      if (!session.a) {
        if (p && p.kind !== "free") {
          return {
            line: previewCall(spec.id, [exprOfPlace(p)], usedNames, ([a]) => `${spec.id}(${a}, b)`),
            hint: spec.hint,
          };
        }
        return { line: `const ${spec.prefix} = ${spec.id}(a, b)`, hint: spec.hint };
      }
      if (p && p.kind !== "free") {
        return {
          line: previewCall(
            spec.id,
            [session.a.expr, exprOfPlace(p)],
            usedNames,
            ([a, b]) => `${spec.id}(${a}, ${b})`,
          ),
          hint: "Click the second point.",
        };
      }
      return {
        line: previewCall(spec.id, [session.a.expr], usedNames, ([a]) => `${spec.id}(${a}, b)`),
        hint: "Click the second point.",
      };
    },
  };
}
