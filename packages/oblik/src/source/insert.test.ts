import { describe, expect, test } from "vitest";

import { printExpr, type Expr } from "./expr";
import { insertCall } from "./insert";

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
    expect(printExpr({ kind: "call", name: "point", args: [{ kind: "num", value: 1.2 }, { kind: "num", value: -3 }] })).toBe(
      "point(1.2, -3)",
    );
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

  test("allocates a bind and nested point Expr", () => {
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
      () => "o_s",
    );
    expect(next).toContain('const s = segment(A, point(4, 1), "o_s");');
  });

  test("inserts a circle whose radius is dist to an intersection", () => {
    const next = insertCall(
      src,
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
      () => "o_beam",
    );
    expect(next).toContain('const beam = circle(A, dist(A, lineIntersection(ground, wall)), "o_beam");');
    expect(next).toMatch(/import \{ point, circle, dist, lineIntersection \} from "oblik"/);
  });

  test("inserts lineIntersection as its own bind", () => {
    const next = insertCall(
      src,
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
      src,
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
});
