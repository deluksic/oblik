import { describe, expect, test } from "vitest";

import { analyze } from "../source/analyze";
import { analyzeMentions } from "../source/mention";
import { defineScene } from "./scene";
import { circle, point } from "./constructors";
import { evaluate } from "./evaluate";
import { assignInv } from "./inv";

const src = `import { point, circle } from "oblik";
function plate() {
  const origin = point(0, 0, "o_origin");
  for (let i = 0; i < 2; i++) circle(origin, 0.1, "o_hole");
  const drill = circle(origin, 0.2, "o_drill");
}
export default {
  build() {
    plate();
    plate();
  }
}
`;

function plate() {
  const origin = point(0, 0, "o_origin");
  for (let i = 0; i < 2; i++) circle(origin, 0.1, "o_hole");
  const drill = circle(origin, 0.2, "o_drill");
  return { origin, drill };
}

function bolts() {
  for (let i = 0; i < 3; i++) circle({ x: i, y: 0 }, 0.1, "o_bolt");
}

describe("assignInv", () => {
  test("splits two plate() calls; holes follow the surrounding origin/drill", () => {
    const file = "apps/demo/src/scenes/t.ts";
    const mentions = analyzeMentions(src, file);
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        plate();
        plate();
      },
    });
    const { trace } = evaluate(scene, { annotations: analyze(src, file), module: file });
    for (const n of trace) {
      n.module = file;
      n.stack = [
        { file, line: n.at?.line ?? 3, column: 4, name: "plate" },
        { file, line: 9, column: 4, name: "build" },
      ];
    }
    assignInv(trace, [mentions]);
    const origin = trace.filter((n) => n.id === "o_origin");
    expect(origin.map((n) => n.inv?.serial)).toEqual([0, 1]);
    const holes = trace.filter((n) => n.id === "o_hole");
    expect(holes.map((n) => n.inv?.serial)).toEqual([0, 0, 1, 1]);
    const drills = trace.filter((n) => n.id === "o_drill");
    expect(drills.map((n) => n.inv?.serial)).toEqual([0, 1]);
    expect(origin[0]?.inv?.name).toBe("plate");
  });

  test("a loop-only helper is one invocation per caller site", () => {
    const src2 = `import { circle } from "oblik";
function bolts() {
  for (let i = 0; i < 3; i++) circle({ x: i, y: 0 }, 0.1, "o_bolt");
}
`;
    const file = "apps/demo/src/layout/bolts.ts";
    const mentions = analyzeMentions(src2, file);
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        bolts();
        bolts();
      },
    });
    const { trace } = evaluate(scene, { annotations: analyze(src2, file), module: file });
    for (const n of trace) {
      n.module = file;
      n.stack = [
        { file, line: 3, column: 4, name: "bolts" },
        { file, line: n.occ < 3 ? 8 : 9, column: 4, name: "build" },
      ];
    }
    assignInv(trace, [mentions]);
    expect(trace.filter((n) => n.inv?.callerLine === 8).every((n) => n.inv?.serial === 0)).toBe(true);
    expect(trace.filter((n) => n.inv?.callerLine === 9).every((n) => n.inv?.serial === 0)).toBe(true);
    expect(new Set(trace.map((n) => n.inv?.callerLine)).size).toBe(2);
  });

  test("generated same-file frames still share one caller outside the helper", () => {
    const src2 = `import { point } from "oblik";
export function plate() {
  const origin = point(0, 0, "o_origin");
  point(1, 0, "o_hid");
}
`;
    const helperFile = "apps/demo/src/layout/plate.ts";
    const parentFile = "apps/demo/src/scenes/t.ts";
    const mentions = [
      analyzeMentions(src2, helperFile),
      analyzeMentions(
        `import { plate } from "./plate";
function build() { plate(); }
`,
        parentFile,
      ),
    ];
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        point(0, 0, "o_origin");
        point(1, 0, "o_hid");
      },
    });
    const { trace } = evaluate(scene, { annotations: analyze(src2, helperFile), module: helperFile });
    for (const n of trace) {
      n.module = helperFile;
      n.stack = [
        { file: helperFile, line: 80 + (n.id === "o_hid" ? 3 : 0), column: 4, name: "plate" },
        { file: parentFile, line: 11, column: 12, name: "build" },
      ];
    }
    assignInv(trace, mentions);
    expect(trace.every((n) => n.inv?.callerLine === 11)).toBe(true);
    expect(new Set(trace.map((n) => n.inv?.serial)).size).toBe(1);
  });
});
