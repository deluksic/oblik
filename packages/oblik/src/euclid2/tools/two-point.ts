import { printExpr } from "@/source/expr";
import { asPoint, exprOfPlace, hoverPlace, isPinnedPoint, previewCall } from "./common";
import { hitRef, inSlot, nameField, previewName, refField, resolvePoint, withBind } from "./draft";
import type { Field, PlaceHit, Placed, Preview, Tool, ToolSession, ToolSpec } from "./types";

type TwoPointId = "line" | "segment";
type TwoPointSession = Extract<ToolSession, { verb: TwoPointId }>;

function label(ref: string, placed: Placed | undefined, fallback: string, place: PlaceHit | null): string {
  if (ref.trim()) return ref.trim();
  if (placed) return printExpr(placed.expr);
  const p = place?.point;
  if (p && isPinnedPoint(p)) return printExpr(exprOfPlace(p));
  return fallback;
}

export function defineTwoPoint(spec: ToolSpec & { id: TwoPointId }): Tool<TwoPointSession> {
  const fields: Field<TwoPointSession>[] = [
    refField("a", "<a>", "point", (s) => s.aRef, (s, raw) => ({ ...s, aRef: raw })),
    refField("b", "<b>", "point", (s) => s.bRef, (s, raw) => ({ ...s, bRef: raw })),
    nameField(),
  ];
  return {
    spec,
    start: () => ({ verb: spec.id, focus: "a", aRef: "", bRef: "", name: "" }),
    fields,
    focus: (s) => s.focus,
    setFocus: (s, id) => ({ ...s, focus: id as TwoPointSession["focus"] }),
    hover(_session, hit, trace) {
      return hoverPlace(hit.point, trace);
    },
    click(session, hit, scope) {
      const a = resolvePoint(session.aRef, session.a, scope);
      if (!a) {
        return {
          session: {
            ...session,
            a: asPoint(hit),
            aRef: hitRef(hit) || session.aRef,
            focus: session.focus === "name" ? "name" : "b",
          },
        };
      }
      return {
        insert: withBind(session, { from: spec.id, args: [a.expr, asPoint(hit).expr] }),
      };
    },
    commit(session, _place, scope) {
      const a = resolvePoint(session.aRef, session.a, scope);
      const b = resolvePoint(session.bRef, session.b, scope);
      if (a && b) return { insert: withBind(session, { from: spec.id, args: [a.expr, b.expr] }) };
      if (session.focus === "name" || (session.focus === "b" && !a) || (session.focus === "a" && a && !b)) {
        return { session: { ...session, focus: a ? "b" : "a" } };
      }
      return null;
    },
    ghost(session, place, scope) {
      const cursor = place?.point.at;
      const a = resolvePoint(session.aRef, session.a, scope);
      const b = resolvePoint(session.bRef, session.b, scope);
      if (a && b) return { kind: spec.id as "line" | "segment", a: a.at, b: b.at };
      if (!cursor) {
        if (a) return { kind: "point", at: a.at };
        return null;
      }
      if (!a) return { kind: "point", at: cursor };
      return { kind: spec.id as "line" | "segment", a: a.at, b: cursor };
    },
    preview(session, place, scope): Preview {
      const bind = previewName(session, spec.prefix);
      const a = resolvePoint(session.aRef, session.a, scope);
      const b = resolvePoint(session.bRef, session.b, scope);
      const aTok = inSlot(session.focus === "a", label(session.aRef, a, "a", !a ? place : null));
      const bTok = inSlot(session.focus === "b", label(session.bRef, b, "b", a && !b ? place : null));
      const name = inSlot(session.focus === "name", bind);
      if (a && b) {
        return {
          line: previewCall(spec.id, [a.expr, b.expr], scope.used, ([x, y]) => `${spec.id}(${inSlot(session.focus === "a", x)}, ${inSlot(session.focus === "b", y)})`, name),
          hint: "Enter to insert. Tab to name it.",
        };
      }
      if (a) {
        const p = place?.point ?? null;
        if (p && isPinnedPoint(p) && !session.bRef.trim()) {
          return {
            line: previewCall(spec.id, [a.expr, exprOfPlace(p)], scope.used, ([x, y]) => `${spec.id}(${inSlot(session.focus === "a", x)}, ${inSlot(session.focus === "b", y)})`, name),
            hint: "Type a point name or click a named point or crossing. Tab to name it.",
          };
        }
        return {
          line: previewCall(spec.id, [a.expr], scope.used, ([x]) => `${spec.id}(${inSlot(session.focus === "a", x)}, ${bTok})`, name),
          hint: "Type a point name or click a named point or crossing. Tab to name it.",
        };
      }
      const p = place?.point ?? null;
      if (p && isPinnedPoint(p) && !session.aRef.trim()) {
        return {
          line: previewCall(spec.id, [exprOfPlace(p)], scope.used, ([x]) => `${spec.id}(${inSlot(session.focus === "a", x)}, ${bTok})`, name),
          hint: "Type a point name or click a named point or crossing.",
        };
      }
      return { line: `const ${name} = ${spec.id}(${aTok}, ${bTok})`, hint: spec.hint };
    },
  };
}
