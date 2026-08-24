import { describe, expect, test } from "vitest";

import { analyze } from "./analyze";
import { convergeDraft } from "./converge";
import { patchLiterals } from "./patch";
import { stamp } from "./stamp";

const src = `import { point, circle } from "oblik";
export default {
  build() {
    const A = point(0, 0, "o_aa");
    const reach = circle(A, 2.5, "o_bb");
    circle(A, dist(A, A), "o_cc");
  }
}
`;

describe("analyze", () => {
  test("marks numeric dof editable and records literals", () => {
    const map = analyze(src, "shelf.ts");
    expect(map.get("o_aa")?.editable).toBe(true);
    expect(map.get("o_aa")?.bind).toBe("A");
    expect(map.get("o_aa")?.literals).toEqual([0, 0]);
    expect(map.get("o_bb")?.literals).toEqual([2.5]);
    expect(map.get("o_cc")?.editable).toBe(false);
  });
});

describe("stamp", () => {
  test("appends a trailing id string", () => {
    const raw = `point(1, 2);\n`;
    let n = 0;
    const { source, added } = stamp(raw, () => `o_${n++}`);
    expect(added).toEqual(["o_0"]);
    expect(source).toBe(`point(1, 2, "o_0");\n`);
  });

  test("leaves existing ids", () => {
    const { source, added } = stamp(`point(1, 2, "o_keep");\n`);
    expect(added).toEqual([]);
    expect(source).toContain("o_keep");
  });
});

describe("patchLiterals", () => {
  test("rewrites dof args for an id", () => {
    const next = patchLiterals(src, "o_bb", [3.1]);
    expect(next).toContain('circle(A, 3.1, "o_bb")');
  });
});

describe("convergeDraft", () => {
  test("drops ids whose source literals match", () => {
    const draft = new Map([
      ["o_aa", [0, 0]],
      ["o_bb", [4]],
    ]);
    const next = convergeDraft(draft, analyze(src, "shelf.ts"));
    expect(next.has("o_aa")).toBe(false);
    expect(next.get("o_bb")).toEqual([4]);
  });
});
