import { describe, expect, test } from "vitest";

import { clickTool, exprOfPlace, ghostOf, previewOf, startTool } from "./tool";
import type { PlacePoint } from "./place";

const free = (x: number, y: number): PlacePoint => ({ kind: "free", at: { x, y } });
const namedA: PlacePoint = { kind: "ref", bind: "A", id: "o_a", at: { x: 0, y: 0 } };
const namedP: PlacePoint = { kind: "ref", bind: "P", id: "o_p", at: { x: 2, y: 0 } };
const ll: PlacePoint = {
  kind: "lineIntersection",
  a: "ground",
  b: "wall",
  at: { x: 2, y: 0 },
};
const cl: PlacePoint = {
  kind: "circleLineIntersection",
  circle: "reach",
  line: "shelf",
  k: 1,
  at: { x: 0.87, y: 1.8 },
};
const cc: PlacePoint = {
  kind: "circleCircleIntersection",
  a: "reach",
  b: "lamp",
  k: 1,
  at: { x: 1, y: Math.sqrt(3) },
};

describe("clickTool", () => {
  test("point click inserts numeric literals", () => {
    const r = clickTool(startTool("point"), { world: { x: 1.234, y: -2 }, point: free(1.234, -2) });
    expect(r).toEqual({
      insert: {
        from: "point",
        args: [
          { kind: "num", value: 1.23 },
          { kind: "num", value: -2 },
        ],
      },
    });
  });

  test("point on a named snap is a no-op", () => {
    const r = clickTool(startTool("point"), { world: { x: 0, y: 0 }, point: namedA });
    expect(r).toEqual({ session: { verb: "point" } });
  });

  test("point on a line crossing inserts lineIntersection", () => {
    const r = clickTool(startTool("point"), { world: { x: 2, y: 0 }, point: ll });
    expect(r).toEqual({
      insert: {
        from: "lineIntersection",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "ref", name: "wall" },
        ],
      },
    });
  });

  test("point on a circle-line crossing freezes k", () => {
    const r = clickTool(startTool("point"), { world: cl.at, point: cl });
    expect(r).toEqual({
      insert: {
        from: "circleLineIntersection",
        args: [
          { kind: "ref", name: "reach" },
          { kind: "ref", name: "shelf" },
          { kind: "num", value: 1 },
        ],
      },
    });
  });

  test("point on a circle-circle crossing inserts circleCircleIntersection", () => {
    const r = clickTool(startTool("point"), { world: cc.at, point: cc });
    expect(r).toEqual({
      insert: {
        from: "circleCircleIntersection",
        args: [
          { kind: "ref", name: "reach" },
          { kind: "ref", name: "lamp" },
          { kind: "num", value: 1 },
        ],
      },
    });
  });

  test("circle two clicks: ref center, numeric radius", () => {
    const mid = clickTool(startTool("circle"), { world: { x: 0.1, y: 0 }, point: namedA });
    if (!("session" in mid)) throw new Error("expected session");
    const done = clickTool(mid.session, { world: { x: 3, y: 4 }, point: free(3, 4) });
    expect(done).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "num", value: 5 },
        ],
      },
    });
  });

  test("circle radius on a named point emits dist", () => {
    const mid = clickTool(startTool("circle"), { world: namedA.at, point: namedA });
    if (!("session" in mid)) throw new Error("expected session");
    const done = clickTool(mid.session, { world: namedP.at, point: namedP });
    expect(done).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          {
            kind: "call",
            name: "dist",
            args: [
              { kind: "ref", name: "A" },
              { kind: "ref", name: "P" },
            ],
          },
        ],
      },
    });
  });

  test("circle radius on a crossing nests the intersection in dist", () => {
    const mid = clickTool(startTool("circle"), { world: namedA.at, point: namedA });
    if (!("session" in mid)) throw new Error("expected session");
    const done = clickTool(mid.session, { world: cl.at, point: cl });
    expect(done).toMatchObject({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          {
            kind: "call",
            name: "dist",
            args: [
              { kind: "ref", name: "A" },
              {
                kind: "call",
                name: "circleLineIntersection",
                args: [
                  { kind: "ref", name: "reach" },
                  { kind: "ref", name: "shelf" },
                  { kind: "num", value: 1 },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  test("parallel line picks a carrier then inserts signed distance", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const mid = clickTool(startTool("parallelLine"), {
      world: { x: 1, y: 0.05 },
      point: free(1, 0.05),
      carrier: { bind: "ground", geom: ground },
    });
    if (!("session" in mid) || mid.session.verb !== "parallelLine" || !mid.session.carrier) {
      throw new Error("expected carrier session");
    }
    const done = clickTool(mid.session, { world: { x: 0, y: 1.76 }, point: free(0, 1.76) });
    expect(done).toEqual({
      insert: {
        from: "parallelLine",
        args: [{ kind: "ref", name: "ground" }, { kind: "num", value: 1.76 }],
      },
    });
  });

  test("parallel line distance on a named point emits signedDist", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const session = {
      verb: "parallelLine" as const,
      carrier: { expr: { kind: "ref" as const, name: "ground" }, geom: ground },
    };
    const done = clickTool(session, { world: { x: 9, y: 0.2 }, point: namedP });
    expect(done).toEqual({
      insert: {
        from: "parallelLine",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "call", name: "signedDist", args: [{ kind: "ref", name: "P" }, { kind: "ref", name: "ground" }] },
        ],
      },
    });
  });

  test("segment second click can nest a free point", () => {
    const mid = clickTool(startTool("segment"), { world: { x: 0, y: 0 }, point: namedA });
    if (!("session" in mid)) throw new Error("expected session");
    const done = clickTool(mid.session, { world: { x: 2, y: 0 }, point: free(2, 0) });
    expect(done).toMatchObject({
      insert: {
        from: "segment",
        args: [{ kind: "ref", name: "A" }, { kind: "call", name: "point" }],
      },
    });
  });
});

describe("ghostOf", () => {
  test("rubber-bands a circle after the center", () => {
    const g = ghostOf(
      { verb: "circle", center: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } },
      { world: { x: 0, y: 2 }, point: free(0, 2) },
    );
    expect(g).toEqual({ kind: "circle", center: { x: 0, y: 0 }, radius: 2 });
  });

  test("previews a parallel line after picking the carrier", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const g = ghostOf(
      { verb: "parallelLine", carrier: { expr: { kind: "ref", name: "ground" }, geom: ground } },
      { world: { x: 0, y: 1.5 }, point: free(0, 1.5) },
    );
    expect(g).toEqual({ kind: "parallelLine", geom: ground, distance: 1.5 });
  });

  test("does not preview a parallel line before the carrier is chosen", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    expect(
      ghostOf({ verb: "parallelLine" }, { world: { x: 1, y: 0 }, point: free(1, 0), carrier: { bind: "ground", geom: ground } }),
    ).toBeNull();
  });

  test("parallel line distance snaps to a named point for the ghost", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const g = ghostOf(
      { verb: "parallelLine", carrier: { expr: { kind: "ref", name: "ground" }, geom: ground } },
      { world: { x: 9, y: 0.2 }, point: namedP },
    );
    expect(g).toEqual({ kind: "parallelLine", geom: ground, distance: 0 });
  });
});

describe("previewOf", () => {
  test("shows the intersection constructor while hovering a crossing", () => {
    const p = previewOf(startTool("point"), { world: ll.at, point: ll });
    expect(p.line).toBe("const x = lineIntersection(ground, wall)");
    expect(previewOf(startTool("point"), { world: cc.at, point: cc }).line).toBe(
      "const x = circleCircleIntersection(reach, lamp, 1)",
    );
  });

  test("shows dist() when a circle radius hovers a point", () => {
    const p = previewOf(
      { verb: "circle", center: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } },
      { world: namedP.at, point: namedP },
    );
    expect(p.line).toBe("const c = circle(A, dist(A, P))");
  });

  test("previews a crossing center as its own named point", () => {
    const p = previewOf(startTool("circle"), { world: ll.at, point: ll });
    expect(p.line).toBe("const x = lineIntersection(ground, wall)\nconst c = circle(x, radius)");
  });

  test("hoists a stored crossing center when pinning dist()", () => {
    const p = previewOf(
      { verb: "circle", center: { expr: exprOfPlace(ll), at: ll.at } },
      { world: namedP.at, point: namedP },
    );
    expect(p.line).toBe("const x = lineIntersection(ground, wall)\nconst c = circle(x, dist(x, P))");
  });
});
