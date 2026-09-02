import { describe, expect, test } from "vitest";

import type { Expr } from "./expr";
import { hoistIntersections } from "./hoist";

const crossing: Expr = {
  kind: "call",
  name: "lineIntersection",
  args: [
    { kind: "ref", name: "ground" },
    { kind: "ref", name: "wall" },
  ],
};

describe("hoistIntersections", () => {
  test("lifts a nested crossing to a named statement", () => {
    const { exprs, hoists } = hoistIntersections(
      [
        {
          kind: "call",
          name: "dist",
          args: [{ kind: "ref", name: "A" }, crossing],
        },
      ],
      new Set(["A", "ground", "wall"]),
    );
    expect(hoists).toEqual([{ bind: "x", from: "lineIntersection", args: crossing.args }]);
    expect(exprs).toEqual([
      {
        kind: "call",
        name: "dist",
        args: [
          { kind: "ref", name: "A" },
          { kind: "ref", name: "x" },
        ],
      },
    ]);
  });

  test("dedups identical crossings to one bind", () => {
    const { exprs, hoists } = hoistIntersections([crossing, crossing], new Set());
    expect(hoists).toHaveLength(1);
    expect(exprs).toEqual([
      { kind: "ref", name: "x" },
      { kind: "ref", name: "x" },
    ]);
  });

  test("hoists a nested free point so it can be reused", () => {
    const pt: Expr = {
      kind: "call",
      name: "point",
      args: [
        { kind: "num", value: 4 },
        { kind: "num", value: 1 },
      ],
    };
    const { exprs, hoists } = hoistIntersections([pt], new Set());
    expect(hoists).toEqual([{ bind: "p", from: "point", args: pt.args }]);
    expect(exprs).toEqual([{ kind: "ref", name: "p" }]);
  });

  test("dedups identical nested points so dist does not stamp a second one", () => {
    const pt: Expr = {
      kind: "call",
      name: "point",
      args: [
        { kind: "num", value: 1 },
        { kind: "num", value: 2 },
      ],
    };
    const { exprs, hoists } = hoistIntersections(
      [
        pt,
        {
          kind: "call",
          name: "dist",
          args: [pt, { kind: "ref", name: "P" }],
        },
      ],
      new Set(["P"]),
    );
    expect(hoists).toEqual([{ bind: "p", from: "point", args: pt.args }]);
    expect(exprs).toEqual([
      { kind: "ref", name: "p" },
      {
        kind: "call",
        name: "dist",
        args: [
          { kind: "ref", name: "p" },
          { kind: "ref", name: "P" },
        ],
      },
    ]);
  });

  test("skips x if that bind is already used", () => {
    const { hoists } = hoistIntersections([crossing], new Set(["x"]));
    expect(hoists[0]?.bind).toBe("x2");
  });

  test("hoists a nested glider so a line can attach to it", () => {
    const glider: Expr = {
      kind: "call",
      name: "pointOnLine",
      args: [
        { kind: "ref", name: "ground" },
        { kind: "num", value: 2.2 },
      ],
    };
    const { exprs, hoists } = hoistIntersections(
      [glider, { kind: "ref", name: "A" }],
      new Set(["A", "ground"]),
    );
    expect(hoists).toEqual([{ bind: "g", from: "pointOnLine", args: glider.args }]);
    expect(exprs).toEqual([
      { kind: "ref", name: "g" },
      { kind: "ref", name: "A" },
    ]);
  });

  test("rewrites nested calls inside an array expr", () => {
    const { exprs, hoists } = hoistIntersections(
      [
        {
          kind: "array",
          items: [{ kind: "ref", name: "A" }, crossing],
        },
      ],
      new Set(["A", "ground", "wall"]),
    );
    expect(hoists).toEqual([{ bind: "x", from: "lineIntersection", args: crossing.args }]);
    expect(exprs).toEqual([
      {
        kind: "array",
        items: [
          { kind: "ref", name: "A" },
          { kind: "ref", name: "x" },
        ],
      },
    ]);
  });
});
