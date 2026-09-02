import { describe, expect, test } from "vitest";

import { printExpr, type Expr } from "./expr";
import { insertCall, exposeReturnBag, namesInFunctionScope } from "./insert";

const src = `import { point } from "oblik";
import { defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const A = point(0, 0, "o_a");
    return { A };
  },
});
`;

function withBinds(...names: string[]): string {
  const extras = names.map((n) => `    const ${n} = A;\n`).join("");
  return src.replace("    return { A };", `${extras}    return { A };`);
}

describe("printExpr", () => {
  test("prints nums, refs, and nested calls", () => {
    const e: Expr = {
      kind: "call",
      name: "circle",
      args: [
        { kind: "ref", name: "A" },
        { kind: "num", value: 2.5 },
      ],
    };
    expect(printExpr(e)).toBe("circle(A, 2.5)");
    expect(
      printExpr({
        kind: "call",
        name: "point",
        args: [
          { kind: "num", value: 1.2 },
          { kind: "num", value: -3 },
        ],
      }),
    ).toBe("point(1.2, -3)");
    expect(
      printExpr({
        kind: "call",
        name: "dist",
        args: [
          { kind: "ref", name: "A" },
          {
            kind: "call",
            name: "lineIntersection",
            args: [
              { kind: "ref", name: "ground" },
              { kind: "ref", name: "wall" },
            ],
          },
        ],
      }),
    ).toBe("dist(A, lineIntersection(ground, wall))");
  });

  test("prints member and neg expressions", () => {
    expect(
      printExpr({ kind: "member", object: { kind: "ref", name: "reach" }, field: "radius" }),
    ).toBe("reach.radius");
    expect(
      printExpr({
        kind: "neg",
        expr: { kind: "member", object: { kind: "ref", name: "shelf" }, field: "distance" },
      }),
    ).toBe("-shelf.distance");
    expect(
      printExpr({
        kind: "member",
        object: { kind: "member", object: { kind: "ref", name: "plate" }, field: "drill" },
        field: "radius",
      }),
    ).toBe("plate.drill.radius");
    expect(printExpr({ kind: "neg", expr: { kind: "ref", name: "reach" } })).toBe("-reach");
    expect(
      printExpr({
        kind: "array",
        items: [
          { kind: "ref", name: "A" },
          { kind: "ref", name: "chord" },
          { kind: "ref", name: "B" },
          {
            kind: "call",
            name: "along",
            args: [
              { kind: "ref", name: "c" },
              { kind: "num", value: 1 },
            ],
          },
        ],
      }),
    ).toBe("[A, chord, B, along(c, 1)]");
  });
});

describe("insertCall", () => {
  test("inserts before return and adds the import", () => {
    const next = insertCall(src, {
      from: "circle",
      bind: "reach",
      args: [
        { kind: "ref", name: "A" },
        { kind: "num", value: 2.5 },
      ],
      id: "o_r",
    });
    expect(next).toContain("circle");
    expect(next).toContain('const reach = circle(A, 2.5, "o_r");');
    expect(next.indexOf("const reach")).toBeLessThan(next.indexOf("return { A }"));
    expect(next).toMatch(/import \{ point, circle \} from "oblik"/);
  });

  test("hoists a nested free point so later tools can attach to it", () => {
    const next = insertCall(
      src,
      {
        from: "segment",
        args: [
          { kind: "ref", name: "A" },
          {
            kind: "call",
            name: "point",
            args: [
              { kind: "num", value: 4 },
              { kind: "num", value: 1 },
            ],
          },
        ],
        id: "o_s",
      },
      () => "o_p",
    );
    expect(next).toContain('const p = point(4, 1, "o_p");');
    expect(next).toContain('const s = segment(A, p, "o_s");');
  });

  test("inserts a parallel line with a numeric offset", () => {
    const next = insertCall(withBinds("ground"), {
      from: "parallelLine",
      bind: "shelf",
      args: [
        { kind: "ref", name: "ground" },
        { kind: "num", value: 1.76 },
      ],
      id: "o_par",
    });
    expect(next).toContain('const shelf = parallelLine(ground, 1.76, "o_par");');
    expect(next).toMatch(/import \{ point, parallelLine \} from "oblik"/);
  });

  test("inserts a perpendicular line through a point", () => {
    const next = insertCall(withBinds("ground", "P"), {
      from: "perpendicularLine",
      bind: "normal",
      args: [
        { kind: "ref", name: "ground" },
        { kind: "ref", name: "P" },
      ],
      id: "o_perp",
    });
    expect(next).toContain('const normal = perpendicularLine(ground, P, "o_perp");');
    expect(next).toMatch(/import \{ point, perpendicularLine \} from "oblik"/);
  });

  test("inserts a glider on a segment", () => {
    const next = insertCall(withBinds("span"), {
      from: "pointOnSegment",
      bind: "mid",
      args: [
        { kind: "ref", name: "span" },
        { kind: "num", value: 0.5 },
      ],
      id: "o_g",
    });
    expect(next).toContain('const mid = pointOnSegment(span, 0.5, "o_g");');
    expect(next).toMatch(/import \{ point, pointOnSegment \} from "oblik"/);
  });

  test("hoists a nested glider before a line", () => {
    const next = insertCall(withBinds("ground"), {
      from: "line",
      args: [
        {
          kind: "call",
          name: "pointOnLine",
          args: [
            { kind: "ref", name: "ground" },
            { kind: "num", value: 2.2 },
          ],
        },
        { kind: "ref", name: "A" },
      ],
      id: "o_l",
    });
    expect(next).toContain("const g = pointOnLine(ground, 2.2,");
    expect(next).toContain('const l = line(g, A, "o_l");');
    expect(next).toMatch(/import \{ point, pointOnLine, line \} from "oblik"/);
  });

  test("hoists a free circle center before a numeric radius", () => {
    const next = insertCall(
      src,
      {
        from: "circle",
        bind: "reach",
        args: [
          {
            kind: "call",
            name: "point",
            args: [
              { kind: "num", value: 1.2 },
              { kind: "num", value: 3 },
            ],
          },
          { kind: "num", value: 2.5 },
        ],
        id: "o_r",
      },
      () => "o_p",
    );
    expect(next).toContain('const p = point(1.2, 3, "o_p");');
    expect(next).toContain('const reach = circle(p, 2.5, "o_r");');
  });

  test("hoists a free circle center so dist() does not stamp a second point", () => {
    const pt = {
      kind: "call" as const,
      name: "point",
      args: [
        { kind: "num" as const, value: 1.2 },
        { kind: "num" as const, value: 3 },
      ],
    };
    const next = insertCall(
      src,
      {
        from: "circle",
        bind: "reach",
        args: [
          pt,
          {
            kind: "call",
            name: "dist",
            args: [pt, { kind: "ref", name: "A" }],
          },
        ],
        id: "o_r",
      },
      () => "o_p",
    );
    expect(next).toContain('const p = point(1.2, 3, "o_p");');
    expect(next).toContain('const reach = circle(p, dist(p, A), "o_r");');
    expect(next).not.toContain("dist(point(");
  });

  test("inserts a circle whose radius is dist to an intersection", () => {
    let n = 0;
    const next = insertCall(
      withBinds("ground", "wall"),
      {
        from: "circle",
        bind: "beam",
        args: [
          { kind: "ref", name: "A" },
          {
            kind: "call",
            name: "dist",
            args: [
              { kind: "ref", name: "A" },
              {
                kind: "call",
                name: "lineIntersection",
                args: [
                  { kind: "ref", name: "ground" },
                  { kind: "ref", name: "wall" },
                ],
              },
            ],
          },
        ],
        id: "o_beam",
      },
      () => `o_h${n++}`,
    );
    expect(next).toContain('const x = lineIntersection(ground, wall, "o_h0");');
    expect(next).toContain('const beam = circle(A, dist(A, x), "o_beam");');
    expect(next.indexOf("const x =")).toBeLessThan(next.indexOf("const beam ="));
    expect(next).toMatch(/import \{ point, lineIntersection, circle, dist \} from "oblik"/);
  });

  test("hoists an intersection used as a circle center", () => {
    let n = 0;
    const next = insertCall(
      withBinds("reach", "shelf"),
      {
        from: "circle",
        args: [
          {
            kind: "call",
            name: "circleLineIntersection",
            args: [
              { kind: "ref", name: "reach" },
              { kind: "ref", name: "shelf" },
              { kind: "num", value: 1 },
            ],
          },
          { kind: "num", value: 2.5 },
        ],
        id: "o_c",
      },
      () => `o_h${n++}`,
    );
    expect(next).toContain('const x = circleLineIntersection(reach, shelf, 1, "o_h0");');
    expect(next).toContain('const c = circle(x, 2.5, "o_c");');
  });

  test("inserts lineIntersection as its own bind", () => {
    const next = insertCall(
      withBinds("ground", "wall"),
      {
        from: "lineIntersection",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "ref", name: "wall" },
        ],
        id: "o_x",
      },
      () => "o_x",
    );
    expect(next).toContain('const x = lineIntersection(ground, wall, "o_x");');
  });

  test("inserts circleCircleIntersection", () => {
    const next = insertCall(
      withBinds("reach", "lamp"),
      {
        from: "circleCircleIntersection",
        args: [
          { kind: "ref", name: "reach" },
          { kind: "ref", name: "lamp" },
          { kind: "num", value: 1 },
        ],
        id: "o_x",
      },
      () => "o_x",
    );
    expect(next).toContain('const x = circleCircleIntersection(reach, lamp, 1, "o_x");');
  });

  test("inserts a slider with options", () => {
    const next = insertCall(src, {
      from: "slider",
      bind: "reach",
      args: [
        { kind: "num", value: 1.8 },
        {
          kind: "props",
          props: {
            min: { kind: "num", value: 0 },
            max: { kind: "num", value: 4 },
            step: { kind: "num", value: 0.05 },
          },
        },
      ],
      id: "o_sl",
    });
    expect(next).toContain('const reach = slider(1.8, { min: 0, max: 4, step: 0.05 }, "o_sl");');
    expect(next).toMatch(/import \{ point, slider \} from "oblik"/);
  });

  test("inserts profile as region([...], id) and imports along", () => {
    const next = insertCall(withBinds("chord", "B", "c"), {
      from: "region",
      bind: "slice",
      args: [
        {
          kind: "array",
          items: [
            { kind: "ref", name: "A" },
            { kind: "ref", name: "chord" },
            { kind: "ref", name: "B" },
            {
              kind: "call",
              name: "along",
              args: [
                { kind: "ref", name: "c" },
                { kind: "num", value: -1 },
              ],
            },
          ],
        },
        { kind: "array", items: [] },
      ],
      id: "o_slice",
    });
    expect(next).toContain('const slice = region([A, chord, B, along(c, -1)], [], "o_slice");');
    expect(next).toMatch(/import \{ point, region, along \} from "oblik"/);
  });

  test("refuses refs that only exist inside a helper", () => {
    const helperSrc = `import { defineScene } from "oblik";
import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "euclid2",
  title: "plate",
  build() {
    return mountingPlateLayout();
  },
});
`;
    expect(() =>
      insertCall(helperSrc, {
        from: "region",
        args: [
          {
            kind: "array",
            items: [
              { kind: "ref", name: "left" },
              { kind: "ref", name: "bottom" },
            ],
          },
          { kind: "array", items: [] },
        ],
        id: "o_pr",
      }),
    ).toThrow(/left.*not in build\(\) — this scope cannot refer/);
  });

  test("inserts into a named helper before its return", () => {
    const plateSrc = `import { point, segment } from "oblik";

export function plate() {
  const origin = point(0, 0, "o_origin");
  const opp = point(1, 1, "o_opp");
  return { origin, opp };
}
`;
    const next = insertCall(plateSrc, {
      dest: "plate",
      from: "segment",
      args: [
        { kind: "ref", name: "origin" },
        { kind: "ref", name: "opp" },
      ],
      id: "o_s",
    });
    expect(next).toContain('const s = segment(origin, opp, "o_s");');
    expect(next).toMatch(/const s = segment\(origin, opp, "o_s"\);\n  return \{ origin, opp \}/);
  });

  test("keeps build()'s return bag when inserting in front of it", () => {
    const next = insertCall(src, {
      from: "circle",
      bind: "reach",
      args: [
        { kind: "ref", name: "A" },
        { kind: "num", value: 2.5 },
      ],
      id: "o_r",
    });
    expect(next).toMatch(/const reach = circle\(A, 2.5, "o_r"\);\n    return \{ A \}/);
  });

  test("insert into a helper can refer to a parameter", () => {
    const paramSrc = `import { point, circle } from "oblik";
export function plate(origin) {
  return { origin };
}
`;
    expect(namesInFunctionScope(paramSrc, "plate").has("origin")).toBe(true);
    const next = insertCall(paramSrc, {
      dest: "plate",
      from: "circle",
      args: [
        { kind: "ref", name: "origin" },
        { kind: "num", value: 0.2 },
      ],
      id: "o_d",
    });
    expect(next).toContain('const c = circle(origin, 0.2, "o_d");');
    expect(next).toMatch(/const c = circle\(origin, 0.2, "o_d"\);\n  return \{ origin \}/);
  });

  test("misspelled dest does not fall back to build()", () => {
    expect(() =>
      insertCall(src, {
        dest: "plat",
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "num", value: 1 },
        ],
        id: "o_r",
      }),
    ).toThrow(/no function plat\(\) with a block body/);
  });

  test("inserts plate.hBottom when that name is in build()", () => {
    const mountSrc = `import { point, defineScene } from "oblik";
import { mountingPlateLayout } from "../layout/mounting-plate";
export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const plate = mountingPlateLayout();
  },
});
`;
    const next = insertCall(mountSrc, {
      from: "segment",
      args: [
        { kind: "member", object: { kind: "ref", name: "plate" }, field: "c0" },
        { kind: "member", object: { kind: "ref", name: "plate" }, field: "c1" },
      ],
      id: "o_s",
    });
    expect(next).toContain('const s = segment(plate.c0, plate.c1, "o_s");');
  });

  test("patches fillet(A, r) into a profile array vertex", () => {
    const faceSrc = `import { point, segment, region } from "oblik";
import { defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const A = point(0, 0, "o_a");
    const B = point(1, 0, "o_b");
    const C = point(1, 1, "o_c");
    const ab = segment(A, B, "o_ab");
    const bc = segment(B, C, "o_bc");
    const ca = segment(C, A, "o_ca");
    const mix = region([A, ab, B, bc, C, ca], [], "o_mix");
    return { mix };
  },
});
`;
    const next = insertCall(faceSrc, {
      from: "fillet",
      args: [{ kind: "num", value: 0.35 }],
      patchVertex: { id: "o_mix", index: 1 },
    });
    expect(next).toContain('region([A, ab, fillet(B, 0.35), bc, C, ca], [], "o_mix")');
    expect(next).toMatch(/import \{ point, segment, region, fillet \} from "oblik"/);
    expect(next).not.toContain("const fillet");
  });

  test("replaces an existing fillet radius and unwraps r === 0", () => {
    const faceSrc = `import { point, segment, region, fillet } from "oblik";
import { defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const A = point(0, 0, "o_a");
    const B = point(1, 0, "o_b");
    const C = point(1, 1, "o_c");
    const ab = segment(A, B, "o_ab");
    const bc = segment(B, C, "o_bc");
    const ca = segment(C, A, "o_ca");
    const mix = region([fillet(A, 0.2), ab, B, bc, C, ca], [], "o_mix");
    return { mix };
  },
});
`;
    const replaced = insertCall(faceSrc, {
      from: "fillet",
      args: [{ kind: "ref", name: "r" }],
      patchVertex: { id: "o_mix", index: 0 },
    });
    expect(replaced).toContain('region([fillet(A, r), ab, B, bc, C, ca], [], "o_mix")');
    const unwrapped = insertCall(faceSrc, {
      from: "fillet",
      args: [{ kind: "num", value: 0 }],
      patchVertex: { id: "o_mix", index: 0 },
    });
    expect(unwrapped).toContain('region([A, ab, B, bc, C, ca], [], "o_mix")');
    expect(unwrapped).not.toContain("fillet(A");
  });

  test("wraps a crossing vertex as fillet(lineIntersection(...), r)", () => {
    const faceSrc = `import { point, line, region } from "oblik";
import { defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const ground = line({ x: 0, y: 0 }, { x: 1, y: 0 }, "o_g");
    const wall = line({ x: 1, y: 0 }, { x: 1, y: 1 }, "o_w");
    const A = point(0, 1, "o_a");
    const mix = region([lineIntersection(ground, wall), ground, A, wall], [], "o_mix");
    return { mix };
  },
});
`;
    const next = insertCall(faceSrc, {
      from: "fillet",
      args: [{ kind: "num", value: 0.2 }],
      patchVertex: { id: "o_mix", index: 0 },
    });
    expect(next).toContain("fillet(lineIntersection(ground, wall), 0.2)");
  });

  test("patches a helper-scope profile array by id", () => {
    const helperSrc = `import { point, segment, region } from "oblik";
import { defineScene } from "oblik";

function plate() {
  const A = point(0, 0, "o_a");
  const B = point(1, 0, "o_b");
  const C = point(1, 1, "o_c");
  const ab = segment(A, B, "o_ab");
  const bc = segment(B, C, "o_bc");
  const ca = segment(C, A, "o_ca");
  return region([A, ab, B, bc, C, ca], [], "o_p");
}

export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    return plate();
  },
});
`;
    const next = insertCall(helperSrc, {
      from: "fillet",
      args: [{ kind: "num", value: 0.1 }],
      patchVertex: { id: "o_p", index: 0 },
    });
    expect(next).toContain('region([fillet(A, 0.1), ab, B, bc, C, ca], [], "o_p")');
  });

  test("refuses a profile cycle that is not an array literal", () => {
    const varSrc = `import { point, segment, region } from "oblik";
import { defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const A = point(0, 0, "o_a");
    const B = point(1, 0, "o_b");
    const C = point(1, 1, "o_c");
    const ab = segment(A, B, "o_ab");
    const bc = segment(B, C, "o_bc");
    const ca = segment(C, A, "o_ca");
    const cycle = [A, ab, B, bc, C, ca];
    const mix = region(cycle, [], "o_mix");
    return { mix };
  },
});
`;
    expect(() =>
      insertCall(varSrc, {
        from: "fillet",
        args: [{ kind: "num", value: 0.2 }],
        patchVertex: { id: "o_mix", index: 0 },
      }),
    ).toThrow(/array literal/);
  });
});

describe("exposeReturnBag", () => {
  const plate = `import { point, parallelLine, segment } from "oblik";
export function plate() {
  const origin = point(0, 0, "o_origin");
  const edge = segment(origin, { x: 1, y: 0 }, "o_edge");
  const hLeft = parallelLine(edge, 0.2, "o_inl");
  return { origin };
}
`;

  test("adds a shorthand field to a single-line return bag", () => {
    const next = exposeReturnBag(plate, "plate", "hLeft");
    expect(next).toContain("return { origin, hLeft };");
  });

  test("adds a field to a multiline return bag with a trailing comma", () => {
    const multilineSrc = `export function plate() {
  const origin = point(0, 0, "o_origin");
  const hLeft = origin;
  return {
    origin,
  };
}
`;
    expect(exposeReturnBag(multilineSrc, "plate", "hLeft")).toContain(`return {
    origin,
    hLeft,
  };`);
  });

  test("is a no-op when the field is already on the return bag", () => {
    expect(exposeReturnBag(plate, "plate", "origin")).toBe(plate);
  });

  test("adds return { bind } when the function has no return", () => {
    const noReturnSrc = `export function plate() {
  const origin = point(0, 0, "o_origin");
}
`;
    expect(exposeReturnBag(noReturnSrc, "plate", "origin")).toContain("return { origin };");
  });

  test("refuses to wrap a single-value return", () => {
    const singleReturnSrc = `export function plate() {
  const origin = point(0, 0, "o_origin");
  const hLeft = origin;
  return origin;
}
`;
    expect(() => exposeReturnBag(singleReturnSrc, "plate", "hLeft")).toThrow(/return bag/);
  });

  test("refuses a bind that is not a local in dest", () => {
    expect(() => exposeReturnBag(plate, "plate", "ground")).toThrow(/cannot refer to ground/);
  });

  test("inserts paint as a stamped constructor", () => {
    const fig = `import { defineScene } from "oblik";
import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "figure",
  title: "t",
  build() {
    const plate = mountingPlateLayout();
  },
});
`;
    const next = insertCall(fig, {
      from: "paint",
      args: [
        { kind: "member", object: { kind: "ref", name: "plate" }, field: "drill" },
        {
          kind: "props",
          props: {
            stroke: { kind: "str", value: "#1c1917" },
            width: { kind: "num", value: 1.2 },
          },
        },
      ],
      id: "o_p",
    });
    expect(next).toContain('paint(plate.drill, { stroke: "#1c1917", width: 1.2 }, "o_p");');
    expect(next).not.toContain("const ink");
    expect(next).not.toContain("style(");
    expect(next).toMatch(/import \{ defineScene, paint \} from "oblik"/);
  });

  test("paint insert refuses names the dest cannot refer to", () => {
    const fig = `import { defineScene } from "oblik";
export default defineScene({
  kind: "figure",
  title: "t",
  build() {
    const plate = 1;
  },
});
`;
    expect(() =>
      insertCall(fig, {
        from: "paint",
        args: [
          { kind: "ref", name: "hLeft" },
          { kind: "props", props: {} },
        ],
        id: "o_p",
      }),
    ).toThrow(/cannot refer to hLeft/);
  });

  test("adds a scene local to build()'s return bag", () => {
    const next = exposeReturnBag(src, "build", "A");
    expect(next).toBe(src);
    const withExtra = src.replace(
      '    const A = point(0, 0, "o_a");',
      '    const A = point(0, 0, "o_a");\n    const extra = A;',
    );
    const bag = exposeReturnBag(withExtra, "build", "extra");
    expect(bag).toContain("return { A, extra };");
  });
});
