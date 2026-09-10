import { asPoint, exprOfPlace, isPinnedPoint, pinnedPointLabel, previewCall } from "./common";
import { inSlot, previewName, slotLabel, withBind } from "./draft";
import { defineSlotTool } from "./slot";
import type { Placed, Preview, Tool, ToolSession, ToolSpec } from "./types";

type TwoPointId = "line" | "segment";
type TwoPointSession = Extract<ToolSession, { verb: TwoPointId }>;

export function defineTwoPoint(spec: ToolSpec & { id: TwoPointId }): Tool<TwoPointSession> {
  return defineSlotTool<TwoPointSession, { a: Placed; b: Placed }>(spec, {
    slots: {
      a: { id: "a", kind: "point", placeholder: "<a>" },
      b: { id: "b", kind: "point", placeholder: "<b>", viaClick: true },
    },
    click(session, hit, _scope, { a }) {
      return { insert: withBind(session, { from: spec.id, args: [a.expr, asPoint(hit).expr] }) };
    },
    commit(session, _place, _scope, { a, b }) {
      return { insert: withBind(session, { from: spec.id, args: [a.expr, b.expr] }) };
    },
    ghost(_session, place, _scope, { a, b }) {
      const cursor = place?.point.at;
      if (a && b) return { kind: spec.id, a: a.at, b: b.at };
      if (!cursor) return a ? { kind: "point", at: a.at } : undefined;
      if (!a) return { kind: "point", at: cursor };
      return { kind: spec.id, a: a.at, b: cursor };
    },
    preview(session, place, scope, { a, b }): Preview {
      const bind = previewName(session, spec.prefix);
      const aTok = inSlot(
        session.focus === "a",
        slotLabel(session.aRef, a, pinnedPointLabel(place), "a"),
      );
      const bTok = inSlot(
        session.focus === "b",
        slotLabel(session.bRef, b, pinnedPointLabel(place), "b"),
      );
      const name = inSlot(session.focus === "name", bind);
      if (a && b) {
        return {
          line: previewCall(
            spec.id,
            [a.expr, b.expr],
            scope.used,
            ([x, y]) =>
              `${spec.id}(${inSlot(session.focus === "a", x)}, ${inSlot(session.focus === "b", y)})`,
            name,
          ),
          hint: "Enter to insert. Tab to name it.",
        };
      }
      if (a) {
        const p = place?.point ?? undefined;
        if (p && isPinnedPoint(p) && !session.bRef.trim()) {
          return {
            line: previewCall(
              spec.id,
              [a.expr, exprOfPlace(p)],
              scope.used,
              ([x, y]) =>
                `${spec.id}(${inSlot(session.focus === "a", x)}, ${inSlot(session.focus === "b", y)})`,
              name,
            ),
            hint: "Type a point name or click a named point or crossing. Tab to name it.",
          };
        }
        return {
          line: previewCall(
            spec.id,
            [a.expr],
            scope.used,
            ([x]) => `${spec.id}(${inSlot(session.focus === "a", x)}, ${bTok})`,
            name,
          ),
          hint: "Type a point name or click a named point or crossing. Tab to name it.",
        };
      }
      const p = place?.point ?? undefined;
      if (p && isPinnedPoint(p) && !session.aRef.trim()) {
        return {
          line: previewCall(
            spec.id,
            [exprOfPlace(p)],
            scope.used,
            ([x]) => `${spec.id}(${inSlot(session.focus === "a", x)}, ${bTok})`,
            name,
          ),
          hint: "Type a point name or click a named point or crossing.",
        };
      }
      return { line: `const ${name} = ${spec.id}(${aTok}, ${bTok})`, hint: spec.hint };
    },
  });
}
