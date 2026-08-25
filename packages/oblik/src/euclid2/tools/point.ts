import { printExpr } from "../../source/expr";
import { hoistIntersections, printHoist } from "../../source/hoist";
import { isCrossing } from "../place";
import { exprOfPlace, intersectionInsert, round } from "./common";
import type { Preview, Tool, ToolSession } from "./types";

export const point: Tool<Extract<ToolSession, { verb: "point" }>> = {
  spec: {
    id: "point",
    title: "Point",
    hint: "Click to place, or snap to a named point or crossing.",
    prefix: "p",
  },
  start: () => ({ verb: "point" }),
  click(session, hit) {
    if (hit.point.kind === "ref") return { session };
    const crossing = intersectionInsert(hit.point);
    if (crossing) return { insert: crossing };
    const at = { x: round(hit.point.at.x), y: round(hit.point.at.y) };
    return {
      insert: {
        from: "point",
        args: [
          { kind: "num", value: at.x },
          { kind: "num", value: at.y },
        ],
      },
    };
  },
  ghost(_session, place) {
    const at = place?.point.at;
    return at ? { kind: "point", at } : null;
  },
  preview(_session, place, usedNames): Preview {
    const spec = point.spec;
    const p = place?.point ?? null;
    if (p?.kind === "ref") {
      return { line: `${p.bind}`, hint: "Already a named point — click does nothing." };
    }
    if (p && isCrossing(p)) {
      const used = new Set(usedNames);
      const { hoists } = hoistIntersections([exprOfPlace(p)], used);
      const line = hoists.map(printHoist).join("\n") || `const ${spec.prefix} = ${printExpr(exprOfPlace(p))}`;
      return { line, hint: "Click to insert the crossing." };
    }
    return { line: `const ${spec.prefix} = point(x, y)`, hint: spec.hint };
  },
};
