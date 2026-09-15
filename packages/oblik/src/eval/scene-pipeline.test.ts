import { describe, expect, test } from "vitest";

import { isCsg2 } from "../geom/csg2";
import type { CsgOperand } from "../geom/types";
import { analyze } from "../source/analyze";
import { circle, csg2, diff, point, polarRepeat, slider } from "./constructors";
import { evaluate } from "./evaluate";
import { defineScene } from "./scene";

/**
 * The scene-shaped seams: what a *scene* does that a bare traced call does not.
 *
 * The demo scenes used to be the corpus for these — every one of them evaluated
 * and picked apart for the exact shapes it produced. That made the test input the
 * same files the user edits: the dev server rewrites `apps/demo/src/scenes/*.ts`
 * while it runs, a GUI drag commits into them, and a scene that stops containing
 * the shape that once found a bug silently narrows the test. So the fixtures live
 * here, and what those scenes were pinned for is covered where it belongs — the
 * round-offset playground cases in `geom/offset.test.ts`, picking in
 * `euclid2/pick.test.ts`, figure output in `figure/export.test.ts`, the
 * evaluator's rules in `evaluate.test.ts`, and the fill compiler's corpus in
 * `euclid2-typegpu/gpu/fillCorpus.fixture.ts`.
 */

/** One tooth of a ring, as a layout would hand it to `polarRepeat`. */
const tooth = (): { x: number; y: number }[] => [
  { x: 1.8, y: -0.3 },
  { x: 2.2, y: -0.3 },
  { x: 2.2, y: 0.3 },
  { x: 1.8, y: 0.3 },
];

/** One layout-helper call: what a plate stamps per instance. */
function bolt() {
  point(0, 2, "o_origin");
  circle({ x: 0, y: 2 }, 0.3, "o_drill");
}

/** The first repeat count in a tree, the way the tool reads one back. */
function repeatCountOf(op: CsgOperand): number | undefined {
  if (op.kind === "polarRepeat") return op.count;
  if (op.kind === "csg2") {
    for (const child of op.of) {
      const found = repeatCountOf(child);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

describe("scene pipeline", () => {
  test("a layout helper called from a loop joins the tape once per instance", () => {
    // The `mounting-plate-grid` shape: one call site, six instances, the same ids
    // every time, and each occurrence numbered so the tool can tell them apart.
    const scene = defineScene({
      kind: "euclid2",
      title: "grid",
      build() {
        for (let i = 0; i < 6; i++) bolt();
      },
    });
    const { trace } = evaluate(scene, {
      annotations: analyze(
        `const origin = point(ox, oy, "o_origin");\nconst drill = circle(origin, 0.3, "o_drill");\n`,
        "apps/demo/src/layout/bolt.ts",
      ),
      module: "apps/demo/src/scenes/grid.ts",
    });
    expect(trace.filter((n) => n.id === "o_origin")).toHaveLength(6);
    const drills = trace.filter((n) => n.id === "o_drill");
    expect(drills).toHaveLength(6);
    expect(drills.map((n) => n.occ)).toEqual([0, 1, 2, 3, 4, 5]);
    // The ids belong to the helper that stamped them, not to its caller.
    expect(drills.every((n) => n.module === "apps/demo/src/layout/bolt.ts")).toBe(true);
  });

  test("a dragged slider re-derives the shape it feeds", () => {
    // A slider's number can be *structural* — a tooth count here, a gap or an
    // offset distance in the scenes — so a drag has to reach the fold rather than
    // just move a point, and the re-derived tree has to stay finite.
    const scene = defineScene({
      kind: "euclid2",
      title: "gear",
      build() {
        // A slider hands its number straight back, so `teeth` *is* the count the
        // fold reads — a drag re-derives the ring instead of moving one point.
        const teeth = slider(12, { min: 6, max: 40, step: 1 }, "o_teeth");
        return csg2(
          diff(polarRepeat(tooth(), teeth, { x: 0, y: 0 }, 0.2), [circle({ x: 0, y: 0 }, 0.4)]),
          "o_face",
        );
      },
    });
    const face = (draft?: Map<string, number[]>) => {
      const node = evaluate(scene, draft ? { draft } : {}).trace.find((n) => n.id === "o_face");
      if (!node || !isCsg2(node.value)) throw new Error("missing face");
      return node.value;
    };
    expect(repeatCountOf(face())).toBe(12);
    expect(repeatCountOf(face(new Map([["o_teeth", [30]]])))).toBe(30);
  });
});
