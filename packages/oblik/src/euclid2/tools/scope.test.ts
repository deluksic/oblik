import { describe, expect, test } from "vitest";

import { analyze } from "../../source/analyze";
import { analyzeMentions } from "../../source/mention";
import { point, circle } from "../../eval/constructors";
import { defineScene } from "../../eval/scene";
import { evaluate } from "../../eval/evaluate";
import { assignInv } from "../../eval/inv";
import { printExpr } from "../../source/expr";
import { scopeFromTrace } from "./scope";

const helper = `import { point, circle } from "oblik";
export function plate() {
  const origin = point(0, 0, "o_origin");
  const drill = circle(origin, 0.2, "o_drill");
  const hidden = point(1, 1, "o_hid");
  return { origin, drill };
}
`;

const parent = `import { plate } from "./plate";
import { defineScene } from "oblik";
export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const bag = plate();
  },
});
`;

describe("scopeFromTrace mentions", () => {
  test("build sees bag.drill; plate sees hidden; build does not", () => {
    const helperFile = "apps/demo/src/layout/plate.ts";
    const parentFile = "apps/demo/src/scenes/t.ts";
    const mentions = [analyzeMentions(helper, helperFile), analyzeMentions(parent, parentFile)];
    const call = mentions[1]!.functions.find((f) => f.name === "build")!.calls[0]!;
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const origin = point(0, 0, "o_origin");
        const drill = circle(origin, 0.2, "o_drill");
        point(1, 1, "o_hid");
        return { origin, drill };
      },
    });
    const annotations = {
      ...Object.fromEntries(analyze(helper, helperFile)),
      ...Object.fromEntries(analyze(parent, parentFile)),
    };
    const { trace } = evaluate(scene, { annotations, module: helperFile });
    for (const n of trace) {
      n.module = helperFile;
      n.at = n.at ?? { line: 3, column: 4 };
      n.stack = [
        { file: helperFile, line: 3, column: 4, name: "plate" },
        { file: parentFile, line: call.line, column: call.column, name: "build" },
      ];
    }
    assignInv(trace, mentions);

    const build = scopeFromTrace(trace, { focus: { file: parentFile, name: "build", serial: 0 }, mentions });
    expect(printExpr(build.byId["o_drill"]!)).toBe("bag.drill");
    expect(printExpr(build.byId["o_origin"]!)).toBe("bag.origin");
    expect(build.byId["o_hid"]).toBeUndefined();
    expect(build.circles["bag.drill"]).toBeDefined();

    const inner = scopeFromTrace(trace, { focus: { file: helperFile, name: "plate", serial: 0 }, mentions });
    expect(printExpr(inner.byId["o_drill"]!)).toBe("drill");
    expect(printExpr(inner.byId["o_hid"]!)).toBe("hidden");
    expect(inner.used).toEqual(expect.arrayContaining(["origin", "drill", "hidden"]));
    expect(build.prints?.["o_drill:0"]).toBeDefined();
    expect(build.prints?.["o_hid:0"]).toBeUndefined();
  });
});
