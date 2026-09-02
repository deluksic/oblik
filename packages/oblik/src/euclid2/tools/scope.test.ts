import { describe, expect, test } from "vitest";

import { point, circle, parallelLine, segment } from "../../eval/constructors";
import { evaluate } from "../../eval/evaluate";
import { assignInv } from "../../eval/inv";
import { defineScene } from "../../eval/scene";
import { analyze } from "../../source/analyze";
import { printExpr } from "../../source/expr";
import { analyzeMentions } from "../../source/mention";
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

    const build = scopeFromTrace(trace, {
      focus: { file: parentFile, name: "build", serial: 0 },
      mentions,
    });
    expect(printExpr(build.byId["o_drill"]!)).toBe("bag.drill");
    expect(printExpr(build.byId["o_origin"]!)).toBe("bag.origin");
    expect(build.byId["o_hid"]).toBeUndefined();
    expect(build.circles["bag.drill"]).toBeDefined();

    const inner = scopeFromTrace(trace, {
      focus: { file: helperFile, name: "plate", serial: 0 },
      mentions,
    });
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
    const mentions = [
      analyzeMentions(helperSrc, helperFile),
      analyzeMentions(parentSrc, parentFile),
    ];
    const call = mentions[1]!.functions.find((f) => f.name === "build")!.calls[0]!;
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const origin = point(0, 0, "o_origin");
        const edge = segment(origin, { x: 1, y: 0 }, "o_edge");
        parallelLine(edge, 0.2, "o_inl");
        circle(origin, 0.2, "o_drill");
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

    const build = scopeFromTrace(trace, {
      focus: { file: parentFile, name: "build", serial: 0 },
      mentions,
    });
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
        circle(origin, 0.2, "o_drill");
        point(1, 1, "o_hid");
        const originB = point(0, 0, "o_origin");
        circle(originB, 0.2, "o_drill");
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

    const build = scopeFromTrace(trace, {
      focus: { file: parentFile, name: "build", serial: 0 },
      mentions,
    });
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

  test("a fillet in a helper does not unmute sibling invocations", () => {
    const helperSrc = `import { point, circle, fillet, region, segment } from "oblik";
export function plate() {
  const origin = point(0, 0, "o_origin");
  const drill = circle(origin, 0.2, "o_drill");
  const hidden = point(1, 1, "o_hid");
  const B = point(1, 0, "o_b");
  const C = point(0, 1, "o_c");
  const ab = segment(origin, B, "o_ab");
  const bc = segment(B, C, "o_bc");
  const ca = segment(C, origin, "o_ca");
  region([fillet(origin, 0.1), ab, B, bc, C, ca], [], "o_mix");
  return { origin, drill };
}
`;
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
    const mentions = [
      analyzeMentions(helperSrc, helperFile),
      analyzeMentions(parentSrc, parentFile),
    ];
    expect(
      mentions[0]!.functions.find((f) => f.name === "plate")!.calls.map((c) => c.callee),
    ).toEqual([]);
    const callA = mentions[1]!.functions.find((f) => f.name === "build")!.calls[0]!;
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const origin = point(0, 0, "o_origin");
        circle(origin, 0.2, "o_drill");
        point(1, 1, "o_hid");
        const originB = point(0, 0, "o_origin");
        circle(originB, 0.2, "o_drill");
        point(1, 1, "o_hid");
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
        { file: helperFile, line: 3, column: 4, name: "plate" },
        { file: parentFile, line: callA.line, column: callA.column, name: "build" },
      ];
    }
    assignInv(trace, mentions);

    const origins = trace.filter((n) => n.id === "o_origin");
    const holes = trace.filter((n) => n.id === "o_hid");
    expect(origins).toHaveLength(2);

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

  test("two-level helpers stay drawn from build; the inner bead is not mentionable there", () => {
    const layoutSrc = `import { circle, point } from "oblik";
export function petal(center: { x: number; y: number }, radius: number) {
  const rim = circle(center, radius, "o_nest_rim");
  circle(center, 0.2, "o_nest_bead");
  return { rim };
}
export function nestedCircles() {
  const origin = point(0, 0, "o_nest");
  const hub = circle(origin, 0.4, "o_nest_hub");
  circle(origin, 1.5, "o_nest_halo");
  const inner = petal(origin, 0.9);
  return { origin, hub };
}
`;
    const parentSrc = `import { nestedCircles } from "./nested-circles";
import { defineScene } from "oblik";
export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const nest = nestedCircles();
  },
});
`;
    const layoutFile = "apps/demo/src/layout/nested-circles.ts";
    const parentFile = "apps/demo/src/scenes/nested-circles.ts";
    const mentions = [
      analyzeMentions(layoutSrc, layoutFile),
      analyzeMentions(parentSrc, parentFile),
    ];
    const petalCall = mentions[0]!.functions.find((f) => f.name === "nestedCircles")!.calls[0]!;
    const nestCall = mentions[1]!.functions.find((f) => f.name === "build")!.calls[0]!;
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const origin = point(0, 0, "o_nest");
        circle(origin, 0.4, "o_nest_hub");
        circle(origin, 1.5, "o_nest_halo");
        circle(origin, 0.9, "o_nest_rim");
        circle(origin, 0.2, "o_nest_bead");
      },
    });
    const annotations = {
      ...Object.fromEntries(analyze(layoutSrc, layoutFile)),
      ...Object.fromEntries(analyze(parentSrc, parentFile)),
    };
    const { trace } = evaluate(scene, { annotations, module: layoutFile });
    const petalIds = new Set(["o_nest_rim", "o_nest_bead"]);
    for (const n of trace) {
      n.module = layoutFile;
      n.at = n.at ?? { line: 3, column: 4 };
      n.stack = petalIds.has(n.id)
        ? [
            { file: layoutFile, line: n.at.line, column: 4, name: "petal" },
            {
              file: layoutFile,
              line: petalCall.line,
              column: petalCall.column,
              name: "nestedCircles",
            },
            { file: parentFile, line: nestCall.line, column: nestCall.column, name: "build" },
          ]
        : [
            { file: layoutFile, line: n.at.line, column: 4, name: "nestedCircles" },
            { file: parentFile, line: nestCall.line, column: nestCall.column, name: "build" },
          ];
    }
    assignInv(trace, mentions);

    const bead = trace.find((n) => n.id === "o_nest_bead")!;
    const halo = trace.find((n) => n.id === "o_nest_halo")!;
    const hub = trace.find((n) => n.id === "o_nest_hub")!;
    const rim = trace.find((n) => n.id === "o_nest_rim")!;

    const build = scopeFromTrace(trace, {
      focus: { file: parentFile, name: "build", serial: 0 },
      mentions,
    });
    expect(mutedForScope(bead, build)).toBe(false);
    expect(mutedForScope(halo, build)).toBe(false);
    expect(mutedForScope(hub, build)).toBe(false);
    expect(printExpr(build.prints![`${hub.id}:${hub.occ}`]!)).toBe("nest.hub");
    expect(build.prints?.[`${bead.id}:${bead.occ}`]).toBeUndefined();
    expect(build.prints?.[`${halo.id}:${halo.occ}`]).toBeUndefined();

    const cluster = scopeFromTrace(trace, {
      focus: { file: layoutFile, name: "nestedCircles", serial: 0 },
      mentions,
    });
    expect(mutedForScope(bead, cluster)).toBe(false);
    expect(printExpr(cluster.prints![`${rim.id}:${rim.occ}`]!)).toBe("inner.rim");
    expect(cluster.prints?.[`${bead.id}:${bead.occ}`]).toBeUndefined();
    expect(printExpr(cluster.byId["o_nest_hub"]!)).toBe("hub");

    const petal = scopeFromTrace(trace, {
      focus: { file: layoutFile, name: "petal", serial: 0 },
      mentions,
    });
    expect(mutedForScope(bead, petal)).toBe(false);
    expect(mutedForScope(halo, petal)).toBe(true);
    expect(printExpr(petal.byId["o_nest_rim"]!)).toBe("rim");
  });
});
