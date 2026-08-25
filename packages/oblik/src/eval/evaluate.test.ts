import { describe, expect, test } from "vitest";

import { siteOf } from "./site";
import { circle, point, segment, slider } from "./constructors";
import { defineScene } from "./scene";
import { emit, evaluate } from "./evaluate";
import { analyze } from "../source/analyze";

describe("evaluate", () => {
  test("segment is one trace, not endpoint points", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const a = point(0, 0, "a");
        const b = point(1, 0, "b");
        return segment(a, b, "s");
      },
    });
    const annotations = analyze(
      `const a = point(0, 0, "a");\nconst b = point(1, 0, "b");\nsegment(a, b, "s");\n`,
    );
    const { trace } = evaluate(scene, { annotations });
    expect(trace.map((n) => n.kind)).toEqual(["point", "point", "segment"]);
    expect(trace.filter((n) => n.kind === "point")).toHaveLength(2);
  });

  test("draft overrides circle radius", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        return circle(A, 2.5, "c");
      },
    });
    const annotations = analyze(`const A = point(0, 0, "a");\ncircle(A, 2.5, "c");\n`);
    const { trace } = evaluate(scene, {
      annotations,
      draft: new Map([["c", [4]]]),
    });
    const c = trace.find((n) => n.id === "c");
    expect(c?.value.kind).toBe("circle");
    if (c?.value.kind === "circle") expect(c.value.radius).toBe(4);
  });

  test("nested evaluate does not leak tape; emit re-emits the same id", () => {
    const inner = defineScene({
      kind: "euclid2",
      title: "inner",
      build() {
        return point(1, 2, "p");
      },
    });
    const outer = defineScene({
      kind: "euclid2",
      title: "outer",
      build() {
        emit(evaluate(inner).value);
      },
    });
    const { trace } = evaluate(outer);
    expect(trace).toHaveLength(1);
    expect(trace[0]?.id).toBe("p");
  });

  test("circle carries $site dof on the function", () => {
    expect(siteOf(circle)?.dof).toEqual([1]);
    expect(siteOf(point)?.dof).toEqual([0, 1]);
    expect(siteOf(segment)?.dof).toEqual([]);
    expect(siteOf(slider)?.dof).toEqual([0]);
  });

  test("slider traces a HUD number", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const reach = slider(1.8, { label: "reach", min: 0, max: 4, step: 0.05 }, "o_sl");
        return reach;
      },
    });
    const annotations = analyze(
      `const reach = slider(1.8, { label: "reach", min: 0, max: 4, step: 0.05 }, "o_sl");\n`,
    );
    const { trace, value } = evaluate(scene, { annotations });
    expect(value).toBe(1.8);
    expect(trace).toHaveLength(1);
    expect(trace[0]?.kind).toBe("slider");
    if (trace[0]?.value.kind === "slider") {
      expect(trace[0].value.n).toBe(1.8);
      expect(trace[0].value.label).toBe("reach");
    }
  });
});
