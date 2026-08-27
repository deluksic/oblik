import { describe, expect, test } from "vitest";

import { analyze } from "../../source/analyze";
import { analyzeMentions } from "../../source/mention";
import { point, circle, parallelLine, segment } from "../../eval/constructors";
import { defineScene } from "../../eval/scene";
import { evaluate } from "../../eval/evaluate";
import { assignInv } from "../../eval/inv";
import { printExpr } from "../../source/expr";
import { mutedForScope, scopeFromTrace } from "./scope";

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
    expect(build.liveKeys?.has("o_hid:0")).toBe(true);
    expect(build.liveKeys?.has("o_drill:0")).toBe(true);
    const hidden = trace.find((n) => n.id === "o_hid")!;
    expect(mutedForScope(hidden, build)).toBe(false);
    expect(mutedForScope(hidden, inner)).toBe(false);
  });

  test("a helper invocation draws unnamed holes and private locals; parent snap still hides them", () => {
    const helperSrc = `import { point, circle, parallelLine, segment } from "oblik";
export function plate() {
  const origin = point(0, 0, "o_origin");
  const edge = segment(origin, { x: 1, y: 0 }, "o_edge");
  const hLeft = parallelLine(edge, 0.2, "o_inl");
  const drill = circle(origin, 0.2, "o_drill");
  circle(origin, drill.radius, "o_h1");
  return { origin, drill };
}
`;
    const parentSrc = `import { plate } from "./plate";
import { defineScene } from "oblik";
export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const bag = plate();
  },
});
`;
    const helperFile = "apps/demo/src/layout/plate.ts";
    const parentFile = "apps/demo/src/scenes/t.ts";
    const mentions = [analyzeMentions(helperSrc, helperFile), analyzeMentions(parentSrc, parentFile)];
    const call = mentions[1]!.functions.find((f) => f.name === "build")!.calls[0]!;
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const origin = point(0, 0, "o_origin");
        const edge = segment(origin, { x: 1, y: 0 }, "o_edge");
        parallelLine(edge, 0.2, "o_inl");
        const drill = circle(origin, 0.2, "o_drill");
        circle(origin, 0.2, "o_h1");
      },
    });
    const annotations = {
      ...Object.fromEntries(analyze(helperSrc, helperFile)),
      ...Object.fromEntries(analyze(parentSrc, parentFile)),
    };
    const { trace } = evaluate(scene, { annotations, module: helperFile });
    for (const n of trace) {
      n.module = helperFile;
      n.at = n.at ?? { line: 3, column: 4 };
      n.stack = [
        { file: helperFile, line: n.at?.line ?? 3, column: 4, name: "plate" },
        { file: parentFile, line: call.line, column: call.column, name: "build" },
      ];
    }
    assignInv(trace, mentions);

    const build = scopeFromTrace(trace, { focus: { file: parentFile, name: "build", serial: 0 }, mentions });
    expect(build.prints?.["o_h1:0"]).toBeUndefined();
    expect(build.prints?.["o_drill:0"]).toBeDefined();
    expect(build.liveKeys?.has("o_h1:0")).toBe(true);
    expect(build.liveKeys?.has("o_drill:0")).toBe(true);

    const inner = scopeFromTrace(trace, {
      focus: {
        file: helperFile,
        name: "plate",
        serial: 0,
        callerFile: parentFile,
        callerLine: call.line,
      },
      mentions,
    });
    expect(printExpr(inner.byId["o_drill"]!)).toBe("drill");
    expect(printExpr(inner.byId["o_inl"]!)).toBe("hLeft");
    const hole = trace.find((n) => n.id === "o_h1")!;
    const left = trace.find((n) => n.id === "o_inl")!;
    expect(mutedForScope(hole, inner)).toBe(false);
    expect(mutedForScope(left, inner)).toBe(false);
    expect(mutedForScope(hole, build)).toBe(false);
    expect(inner.prints?.["o_h1:0"]).toBeUndefined();
    expect(inner.prints?.["o_inl:0"]).toBeDefined();
    expect(inner.used).toEqual(expect.arrayContaining(["origin", "hLeft", "drill"]));
  });

  test("two helper calls stay drawn in build; a dive mutes only the sibling", () => {
    const parentSrc = `import { plate } from "./plate";
import { defineScene } from "oblik";
export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const a = plate();
    const b = plate();
  },
});
`;
    const helperFile = "apps/demo/src/layout/plate.ts";
    const parentFile = "apps/demo/src/scenes/t.ts";
    const mentions = [analyzeMentions(helper, helperFile), analyzeMentions(parentSrc, parentFile)];
    const callA = mentions[1]!.functions.find((f) => f.name === "build")!.calls[0]!;
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const origin = point(0, 0, "o_origin");
        const drill = circle(origin, 0.2, "o_drill");
        point(1, 1, "o_hid");
        const originB = point(0, 0, "o_origin");
        const drillB = circle(originB, 0.2, "o_drill");
        point(1, 1, "o_hid");
      },
    });
    const annotations = {
      ...Object.fromEntries(analyze(helper, helperFile)),
      ...Object.fromEntries(analyze(parentSrc, parentFile)),
    };
    const { trace } = evaluate(scene, { annotations, module: helperFile });
    for (const n of trace) {
      n.module = helperFile;
      n.at = n.at ?? { line: 3, column: 4 };
      // Collapsed generated stack: both invocations share the first call site.
      n.stack = [
        { file: helperFile, line: 3, column: 4, name: "plate" },
        { file: parentFile, line: callA.line, column: callA.column, name: "build" },
      ];
    }
    assignInv(trace, mentions);

    const origins = trace.filter((n) => n.id === "o_origin");
    const holes = trace.filter((n) => n.id === "o_hid");
    expect(origins).toHaveLength(2);
    expect(holes).toHaveLength(2);

    const build = scopeFromTrace(trace, { focus: { file: parentFile, name: "build", serial: 0 }, mentions });
    expect(mutedForScope(origins[0]!, build)).toBe(false);
    expect(mutedForScope(origins[1]!, build)).toBe(false);
    expect(mutedForScope(holes[0]!, build)).toBe(false);
    expect(mutedForScope(holes[1]!, build)).toBe(false);
    expect(printExpr(build.prints![`${origins[0]!.id}:${origins[0]!.occ}`]!)).toBe("a.origin");
    expect(printExpr(build.prints![`${origins[1]!.id}:${origins[1]!.occ}`]!)).toBe("b.origin");
    expect(build.prints?.[`${holes[0]!.id}:${holes[0]!.occ}`]).toBeUndefined();

    const inner = scopeFromTrace(trace, {
      focus: {
        file: helperFile,
        name: "plate",
        serial: 0,
        callerFile: parentFile,
        callerLine: callA.line,
      },
      mentions,
    });
    expect(mutedForScope(origins[0]!, inner)).toBe(false);
    expect(mutedForScope(origins[1]!, inner)).toBe(true);
    expect(mutedForScope(holes[0]!, inner)).toBe(false);
    expect(mutedForScope(holes[1]!, inner)).toBe(true);
  });
});
