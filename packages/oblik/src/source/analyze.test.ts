import { describe, expect, test } from "vitest";

import { analyze, listAnnotationSites } from "./analyze";
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

  test("lists every constructor site even when ids collide", () => {
    const sites = listAnnotationSites(`point(0, 0, "o_a");\ncircle(A, 1, "o_a");\n`, "dup.ts");
    expect(sites.map((s) => s.id)).toEqual(["o_a", "o_a"]);
    expect(sites[0]?.line).toBe(1);
    expect(sites[1]?.line).toBe(2);
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

  test("stamps style and paint constructors", () => {
    let n = 0;
    const { source, added } = stamp(
      `const ink = style({ stroke: "#111" });\npaint(A, ink);\n`,
      () => `o_${n++}`,
    );
    expect(added).toEqual(["o_0", "o_1"]);
    expect(source).toBe(`const ink = style({ stroke: "#111" }, "o_0");\npaint(A, ink, "o_1");\n`);
  });

  test("emits a source map for the Vite module path", () => {
    const { map, added } = stamp("export const c = circle(80);\n", () => "o_1", "src/layout/plate.ts");
    expect(added).toEqual(["o_1"]);
    expect(map.sources).toContain("src/layout/plate.ts");
    expect(map.mappings.length).toBeGreaterThan(0);
  });
});

describe("patchLiterals", () => {
  test("rewrites dof args for an id", () => {
    const next = patchLiterals(src, "o_bb", [3.1]);
    expect(next).toContain('circle(A, 3.1, "o_bb")');
  });
});
