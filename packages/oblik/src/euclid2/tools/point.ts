import { printExpr } from "../../source/expr";
import { hoistIntersections, printHoist } from "../../source/hoist";
import { isCrossing } from "../place";
import { exprOfPlace, intersectionInsert, round } from "./common";
import { nameField, parseNum, previewName, withBind } from "./draft";
import type { Field, Preview, Tool, ToolSession } from "./types";

type PointSession = Extract<ToolSession, { verb: "point" }>;

const fields: Field<PointSession>[] = [
  {
    id: "x",
    kind: "number",
    placeholder: "<x>",
    open: () => true,
    get: (s) => s.x,
    set: (s, raw) => ({ ...s, x: raw }),
  },
  {
    id: "y",
    kind: "number",
    placeholder: "<y>",
    open: () => true,
    get: (s) => s.y,
    set: (s, raw) => ({ ...s, y: raw }),
  },
  nameField<PointSession>(),
];

function coords(session: PointSession, hitAt: { x: number; y: number }): { x: number; y: number } {
  return {
    x: round(parseNum(session.x) ?? hitAt.x),
    y: round(parseNum(session.y) ?? hitAt.y),
  };
}

function insertAt(session: PointSession, at: { x: number; y: number }) {
  return withBind(session, {
    from: "point",
    args: [
      { kind: "num", value: at.x },
      { kind: "num", value: at.y },
    ],
  });
}

export const point: Tool<PointSession> = {
  spec: {
    id: "point",
    title: "Point",
    hint: "Click to place, or snap to a named point or crossing.",
    prefix: "p",
  },
  start: () => ({ verb: "point", focus: "x", x: "", y: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as PointSession["focus"] }),
  click(session, hit) {
    if (hit.point.kind === "ref") return { session };
    const locked = parseNum(session.x) != null || parseNum(session.y) != null;
    if (!locked) {
      const crossing = intersectionInsert(hit.point);
      if (crossing) return { insert: withBind(session, crossing) };
    }
    return { insert: insertAt(session, coords(session, hit.point.at)) };
  },
  commit(session) {
    const x = parseNum(session.x);
    const y = parseNum(session.y);
    if (x != null && y != null) return { insert: insertAt(session, { x: round(x), y: round(y) }) };
    if (session.focus === "name") return { session: { ...session, focus: "x" } };
    return null;
  },
  ghost(session, place) {
    const x = parseNum(session.x);
    const y = parseNum(session.y);
    if (x != null && y != null) return { kind: "point", at: { x, y } };
    const at = place?.point.at;
    if (!at) return null;
    return { kind: "point", at: { x: x ?? at.x, y: y ?? at.y } };
  },
  preview(session, place, usedNames): Preview {
    const spec = point.spec;
    const p = place?.point ?? null;
    const bind = previewName(session, spec.prefix);
    if (p?.kind === "ref" && parseNum(session.x) == null && parseNum(session.y) == null) {
      return { line: `${p.bind}`, hint: "Already a named point — click does nothing." };
    }
    if (p && isCrossing(p) && parseNum(session.x) == null && parseNum(session.y) == null) {
      const used = new Set(usedNames);
      const { hoists } = hoistIntersections([exprOfPlace(p)], used);
      const line = hoists.map(printHoist).join("\n") || `const ${bind} = ${printExpr(exprOfPlace(p))}`;
      return { line, hint: "Click to insert the crossing. Tab to name it." };
    }
    const x = session.x.trim() || "x";
    const y = session.y.trim() || "y";
    return {
      line: `const ${bind} = point(${x}, ${y})`,
      hint: "Click to place. Type an x or y to lock that axis; Tab for name. Enter if both are typed.",
    };
  },
};
