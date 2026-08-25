import { asPoint, exprOfPlace, previewCall } from "./common";
import { inSlot, nameField, previewName, withBind } from "./draft";
import type { Field, Preview, Tool, ToolSession } from "./types";

type TwoPointId = "line" | "segment";
type TwoPointSession = Extract<ToolSession, { verb: TwoPointId }>;

export function defineTwoPoint(spec: Tool<TwoPointSession>["spec"]): Tool<TwoPointSession> {
  const fields: Field<TwoPointSession>[] = [nameField()];
  return {
    spec,
    start: () => ({ verb: spec.id, focus: "name", name: "" }),
    fields,
    focus: (s) => s.focus,
    setFocus: (s, id) => ({ ...s, focus: id as TwoPointSession["focus"] }),
    click(session, hit) {
      if (!session.a) return { session: { ...session, a: asPoint(hit) } };
      return { insert: withBind(session, { from: spec.id, args: [session.a.expr, asPoint(hit).expr] }) };
    },
    commit() {
      return null;
    },
    ghost(session, place) {
      const cursor = place?.point.at;
      if (!cursor) return null;
      if (!session.a) return { kind: "point", at: cursor };
      return { kind: spec.id, a: session.a.at, b: cursor };
    },
    preview(session, place, usedNames): Preview {
      const bind = inSlot(true, previewName(session, spec.prefix));
      const p = place?.point ?? null;
      if (!session.a) {
        if (p && p.kind !== "free") {
          return {
            line: previewCall(spec.id, [exprOfPlace(p)], usedNames, ([a]) => `${spec.id}(${a}, b)`, bind),
            hint: "Click the first point. Tab to name it.",
          };
        }
        return { line: `const ${bind} = ${spec.id}(a, b)`, hint: spec.hint };
      }
      if (p && p.kind !== "free") {
        return {
          line: previewCall(spec.id, [session.a.expr, exprOfPlace(p)], usedNames, ([a, b]) => `${spec.id}(${a}, ${b})`, bind),
          hint: "Click the second point. Tab to name it.",
        };
      }
      return {
        line: previewCall(spec.id, [session.a.expr], usedNames, ([a]) => `${spec.id}(${a}, b)`, bind),
        hint: "Click the second point. Tab to name it.",
      };
    },
  };
}
