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
    const next = insertCall(src, {
      from: "parallelLine",
      bind: "shelf",
      args: [{ kind: "ref", name: "ground" }, { kind: "num", value: 1.76 }],
      id: "o_par",
    });
    expect(next).toContain('const shelf = parallelLine(ground, 1.76, "o_par");');
    expect(next).toMatch(/import \{ point, parallelLine \} from "oblik"/);
  });

  test("inserts a perpendicular line through a point", () => {
    const next = insertCall(src, {
      from: "perpendicularLine",
      bind: "normal",
      args: [{ kind: "ref", name: "ground" }, { kind: "ref", name: "P" }],
      id: "o_perp",
    });
    expect(next).toContain('const normal = perpendicularLine(ground, P, "o_perp");');
    expect(next).toMatch(/import \{ point, perpendicularLine \} from "oblik"/);
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
      src,
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

  test("inserts a slider with options", () => {
    const next = insertCall(
      src,
      {
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
      },
    );
    expect(next).toContain('const reach = slider(1.8, { min: 0, max: 4, step: 0.05 }, "o_sl");');
    expect(next).toMatch(/import \{ point, slider \} from "oblik"/);
  });
});
