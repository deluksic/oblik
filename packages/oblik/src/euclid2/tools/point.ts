import type { Expr } from "@/source/expr";
import { printExpr } from "@/source/expr";
import { hoistIntersections, printHoist } from "@/source/hoist";
import { isConstructed } from "../place";
import { constructedInsert, exprOfPlace, hoverPlace, round } from "./common";
import {
  attachLengthHit,
  hasNumberBinding,
  lengthHover,
  lengthRefName,
  numberField,
  numberValue,
  resolveNumberExpr,
} from "./length";
import { inSlot, nameField, previewName, withBind } from "./draft";
import type { Field, PlaceHit, Preview, Scope, Tool, ToolSession } from "./types";

type PointSession = Extract<ToolSession, { verb: "point" }>;

const fields: Field<PointSession>[] = [
  numberField("x", "<x>", (s) => s.x, (s, raw) => ({ ...s, x: raw })),
  numberField("y", "<y>", (s) => s.y, (s, raw) => ({ ...s, y: raw })),
  nameField<PointSession>(),
];

function axisExpr(raw: string, scope: Scope, fallback: number): Expr {
  return resolveNumberExpr(raw, scope, fallback) ?? { kind: "num", value: round(fallback) };
}

function pointArgs(session: PointSession, at: { x: number; y: number }, scope: Scope): Expr[] {
  return [axisExpr(session.x, scope, at.x), axisExpr(session.y, scope, at.y)];
}

function applyLengthToAxis(session: PointSession, hit: PlaceHit, scope: Scope): PointSession | { insert: ReturnType<typeof withBind> } {
  const bind = lengthRefName(hit.length!.expr);
  if (!bind) return session;
  if (session.focus === "x") {
    const next = { ...session, x: bind };
    const yExpr = resolveNumberExpr(session.y, scope);
    if (yExpr) return { insert: withBind(next, { from: "point", args: [{ kind: "ref", name: bind }, yExpr] }) };
    return next;
  }
  if (session.focus === "y") {
    const next = { ...session, y: bind };
    const xExpr = resolveNumberExpr(session.x, scope);
    if (xExpr) return { insert: withBind(next, { from: "point", args: [xExpr, { kind: "ref", name: bind }] }) };
    return next;
  }
  return session;
}

export const point: Tool<PointSession> = {
  spec: {
    id: "point",
    title: "Point",
    hint: "Click to place, or snap to a named point, a crossing, or a line, segment, or circle.",
    prefix: "p",
    aliases: ["glider", "pointOn", "onLine", "onCircle"],
  },
  start: () => ({ verb: "point", focus: "x", x: "", y: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as PointSession["focus"] }),
  hit(session, hit, ctx) {
    if (session.focus !== "x" && session.focus !== "y") return hit;
    return attachLengthHit(hit, ctx, { typed: session.focus === "x" ? session.x : session.y });
  },
  hover(session, hit, trace) {
    if (hit.length && (session.focus === "x" || session.focus === "y")) {
      return lengthHover(hit, trace);
    }
    return hoverPlace(hit.point, trace);
  },
  click(session, hit, scope) {
    if (hit.point.kind === "ref") return { session };
    if (hit.length && (session.focus === "x" || session.focus === "y")) {
      const next = applyLengthToAxis(session, hit, scope);
      if ("insert" in next) return next;
      return { session: next };
    }
    const locked = hasNumberBinding(session.x, scope) || hasNumberBinding(session.y, scope);
    if (!locked) {
      const constructed = constructedInsert(hit.point);
      if (constructed) return { insert: withBind(session, constructed) };
    }
    return { insert: withBind(session, { from: "point", args: pointArgs(session, hit.point.at, scope) }) };
  },
  commit(session, _place, scope) {
    const xExpr = resolveNumberExpr(session.x, scope);
    const yExpr = resolveNumberExpr(session.y, scope);
    if (xExpr && yExpr) return { insert: withBind(session, { from: "point", args: [xExpr, yExpr] }) };
    if (session.focus === "name") return { session: { ...session, focus: "x" } };
    return null;
  },
  ghost(session, place, scope) {
    const at = place?.point.at;
    if (!at) return null;
    return {
      kind: "point",
      at: {
        x: numberValue(session.x, scope, at.x),
        y: numberValue(session.y, scope, at.y),
      },
    };
  },
  preview(session, place, scope): Preview {
    const spec = point.spec;
    const p = place?.point ?? null;
    const bind = previewName(session, spec.prefix);
    if (p?.kind === "ref" && !hasNumberBinding(session.x, scope) && !hasNumberBinding(session.y, scope)) {
      return { line: `${p.bind}`, hint: "Already a named point — click does nothing." };
    }
    if (p && isConstructed(p) && !hasNumberBinding(session.x, scope) && !hasNumberBinding(session.y, scope)) {
      const used = new Set(scope.used);
      const { hoists } = hoistIntersections([exprOfPlace(p)], used);
      const line = hoists.map(printHoist).join("\n") || `const ${bind} = ${printExpr(exprOfPlace(p))}`;
      return {
        line: line.replace(/const (\S+) = ([^\n]*)$/, (_m, id: string, call: string) =>
          `const ${inSlot(session.focus === "name", previewName(session, id))} = ${call}`,
        ),
        hint: p.kind.startsWith("pointOn")
          ? "Click to place a point on that geometry. Tab to name it."
          : "Click to insert the crossing. Tab to name it.",
      };
    }
    const x = session.x.trim() || "x";
    const y = session.y.trim() || "y";
    return {
      line: `const ${inSlot(session.focus === "name", bind)} = point(${inSlot(session.focus === "x", x)}, ${inSlot(session.focus === "y", y)})`,
      hint: "Click to place. Snap to a line, circle, or crossing. Type x / y or a slider name. Tab for name.",
    };
  },
};
