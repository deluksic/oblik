import { describe, expect, test } from "vitest";

import { clickTool, commitTool, enrichHit, exprOfPlace, filterTools, ghostOf, hoverTool, previewOf, startTool, tabTool, toolChrome, typeTool } from "./tool";
import { profileEligibleCarriers, profileHidesExisting } from "./tools/profile";
import type { PlacePoint } from "./place";
import type { TraceNode } from "../eval/context";

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

describe("enrichHit", () => {
  const ctx = {
    trace: [],
    camera: { x: 0, y: 0, scale: 48 },
    size: { w: 800, h: 600 },
    screen: { x: 10, y: 10 },
  };

  test("point hit does not throw when the session has no typed field", () => {
    const hit = { world: { x: 1, y: 2 }, point: free(1, 2) };
    expect(enrichHit(startTool("point"), hit, ctx)).toEqual(hit);
  });

  test("slider hit does not throw when the session has no typed field", () => {
    const hit = { world: { x: 1, y: 2 }, point: free(1, 2) };
    expect(enrichHit(startTool("slider"), hit, ctx)).toEqual(hit);
  });

  test("pending minus on a slider click keeps the negation", () => {
    const gap = {
      id: "o_pie_g",
      occ: 0,
      kind: "slider",
      value: { kind: "slider", n: 0.12, min: 0, max: 0.4, step: 0.01 },
      bind: "gap",
      editable: true,
      stack: [],
    } as TraceNode;
    const face = {
      kind: "profile" as const,
      outer: [
        { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, carrier: { kind: "segment" as const, a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } },
        { a: { x: 1, y: 0 }, b: { x: 1, y: 1 }, carrier: { kind: "segment" as const, a: { x: 1, y: 0 }, b: { x: 1, y: 1 } } },
        { a: { x: 1, y: 1 }, b: { x: 0, y: 1 }, carrier: { kind: "segment" as const, a: { x: 1, y: 1 }, b: { x: 0, y: 1 } } },
        { a: { x: 0, y: 1 }, b: { x: 0, y: 0 }, carrier: { kind: "segment" as const, a: { x: 0, y: 1 }, b: { x: 0, y: 0 } } },
      ],
    };
    const session = {
      verb: "roundOffset" as const,
      focus: "typed" as const,
      typed: "-",
      name: "",
      faceRef: "one",
      face: { expr: { kind: "ref" as const, name: "one" }, geom: face },
    };
    const hit = {
      world: { x: 0, y: 0 },
      point: free(0, 0),
      length: { expr: { kind: "ref" as const, name: "gap" }, value: 0.12 },
    };
    const next = enrichHit(session, hit, { ...ctx, trace: [gap] });
    expect(next.length).toEqual({
      expr: { kind: "neg", expr: { kind: "ref", name: "gap" } },
      value: -0.12,
    });
    expect(hoverTool(session, next, [gap])).toBe("o_pie_g");
    expect(clickTool(session, next, { used: ["one", "gap"], points: {}, carriers: {}, circles: {}, profiles: {}, lengths: { gap: 0.12 } })).toEqual({
      insert: {
        from: "roundOffset",
        args: [{ kind: "ref", name: "one" }, { kind: "neg", expr: { kind: "ref", name: "gap" } }],
      },
    });
  });

  test("pending minus on a parallel-line slider click keeps the negation", () => {
    const reach = {
      id: "o_n",
      occ: 0,
      kind: "slider",
      value: { kind: "slider", n: 1.25, min: 0, max: 4, step: 0.01 },
      bind: "reach",
      editable: true,
      stack: [],
    } as TraceNode;
    const ground = { kind: "line" as const, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    const session = {
      verb: "parallelLine" as const,
      focus: "typed" as const,
      typed: "-",
      name: "",
      carrierRef: "ground",
      carrier: { expr: { kind: "ref" as const, name: "ground" }, geom: ground },
    };
    const hit = {
      world: { x: 0, y: 0 },
      point: free(0, 0),
      length: { expr: { kind: "ref" as const, name: "reach" }, value: 1.25 },
    };
    expect(enrichHit(session, hit, { ...ctx, trace: [reach] }).length).toEqual({
      expr: { kind: "neg", expr: { kind: "ref", name: "reach" } },
      value: -1.25,
    });
  });
});

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
    expect(r).toEqual({ session: startTool("point") });
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
      focus: "typed" as const,
      typed: "",
      name: "",
      carrierRef: "",
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

  test("segment second click hoists a free point on insert", () => {
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

  test("parallel line click on a slider reuses its bind for the distance", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const mid = clickTool(startTool("parallelLine"), {
      world: { x: 1, y: 0 },
      point: free(1, 0),
      carrier: { bind: "ground", geom: ground },
    });
    if (!("session" in mid)) throw new Error("expected session");
    const scope = {
      used: ["ground", "reach"],
      points: {},
      carriers: { ground: { expr: { kind: "ref", name: "ground" }, geom: ground } },
      circles: {}, profiles: {},
      lengths: { reach: 1.25 },
    };
    expect(
      clickTool(mid.session, { world: { x: 0, y: 0 }, point: free(0, 0), length: { expr: { kind: "ref", name: "reach" }, value: 1.25 } }, scope),
    ).toEqual({
      insert: {
        from: "parallelLine",
        args: [{ kind: "ref", name: "ground" }, { kind: "ref", name: "reach" }],
      },
    });
  });

  test("circle click on a slider reuses its bind for the radius", () => {
    const mid = clickTool(startTool("circle"), { world: { x: 0, y: 0 }, point: namedA });
    if (!("session" in mid)) throw new Error("expected session");
    const scope = {
      used: ["A", "reach"],
      points: { A: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } },
      carriers: {},
      circles: {}, profiles: {},
      lengths: { reach: 2.5 },
    };
    expect(
      clickTool(mid.session, { world: { x: 0, y: 0 }, point: free(0, 0), length: { expr: { kind: "ref", name: "reach" }, value: 2.5 } }, scope),
    ).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "ref", name: "reach" },
        ],
      },
    });
  });

  test("circle click on another circle reuses its radius field", () => {
    const mid = clickTool(startTool("circle"), { world: { x: 0, y: 0 }, point: namedA });
    if (!("session" in mid)) throw new Error("expected session");
    const scope = {
      used: ["A", "reach"],
      points: { A: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } },
      carriers: {},
      circles: { reach: { expr: { kind: "ref", name: "reach" }, geom: { kind: "circle" as const, center: { x: 0, y: 0 }, radius: 2.5 } } },
      lengths: {},
    };
    expect(
      clickTool(
        mid.session,
        {
          world: { x: 2.5, y: 0 },
          point: free(2.5, 0),
          length: { expr: { kind: "member", object: "reach", field: "radius" }, value: 2.5 },
        },
        scope,
      ),
    ).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "member", object: "reach", field: "radius" },
        ],
      },
    });
  });

  test("circle click on a named point wins over field reuse", () => {
    const mid = clickTool(startTool("circle"), { world: { x: 0, y: 0 }, point: namedA });
    if (!("session" in mid)) throw new Error("expected session");
    expect(
      clickTool(mid.session, {
        world: namedP.at,
        point: namedP,
        length: { expr: { kind: "member", object: "reach", field: "radius" }, value: 2.5 },
      }),
    ).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "call", name: "dist", args: [{ kind: "ref", name: "A" }, { kind: "ref", name: "P" }] },
        ],
      },
    });
  });

  test("circle click on an intersection wins over field reuse", () => {
    const mid = clickTool(startTool("circle"), { world: { x: 0, y: 0 }, point: namedA });
    if (!("session" in mid)) throw new Error("expected session");
    expect(
      clickTool(mid.session, {
        world: ll.at,
        point: ll,
        length: { expr: { kind: "member", object: "reach", field: "radius" }, value: 2.5 },
      }),
    ).toMatchObject({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "call", name: "dist" },
        ],
      },
    });
  });

  test("parallel line click reuses a parallel line distance field", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const shelf = {
      kind: "parallelLine" as const,
      origin: { x: 0, y: 1.76 },
      direction: { x: 1, y: 0 },
      distance: 1.76,
    };
    const mid = clickTool(startTool("parallelLine"), {
      world: { x: 1, y: 0 },
      point: free(1, 0),
      carrier: { bind: "ground", geom: ground },
    });
    if (!("session" in mid)) throw new Error("expected session");
    const scope = {
      used: ["ground", "shelf"],
      points: {},
      carriers: {
        ground: { expr: { kind: "ref", name: "ground" }, geom: ground },
        shelf: { expr: { kind: "ref", name: "shelf" }, geom: shelf },
      },
      circles: {}, profiles: {},
      lengths: {},
    };
    expect(
      clickTool(
        mid.session,
        {
          world: { x: 0, y: 1.76 },
          point: free(0, 1.76),
          length: { expr: { kind: "member", object: "shelf", field: "distance" }, value: 1.76 },
        },
        scope,
      ),
    ).toEqual({
      insert: {
        from: "parallelLine",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "member", object: "shelf", field: "distance" },
        ],
      },
    });
  });

  test("parallel line click on a named point wins over field reuse", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const session = {
      verb: "parallelLine" as const,
      focus: "typed" as const,
      typed: "",
      name: "",
      carrierRef: "",
      carrier: { expr: { kind: "ref" as const, name: "ground" }, geom: ground },
    };
    expect(
      clickTool(session, {
        world: namedP.at,
        point: namedP,
        length: { expr: { kind: "member", object: "shelf", field: "distance" }, value: 1.76 },
      }),
    ).toEqual({
      insert: {
        from: "parallelLine",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "call", name: "signedDist", args: [{ kind: "ref", name: "P" }, { kind: "ref", name: "ground" }] },
        ],
      },
    });
  });

  test("parallel line typed negated field commits on Enter", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const shelf = {
      kind: "parallelLine" as const,
      origin: { x: 0, y: 1.76 },
      direction: { x: 1, y: 0 },
      distance: 1.76,
    };
    const scope = {
      used: ["ground", "shelf"],
      points: {},
      carriers: {
        ground: { expr: { kind: "ref", name: "ground" }, geom: ground },
        shelf: { expr: { kind: "ref", name: "shelf" }, geom: shelf },
      },
      circles: {}, profiles: {},
      lengths: {},
    };
    const mid = clickTool(startTool("parallelLine"), {
      world: { x: 1, y: 0 },
      point: free(1, 0),
      carrier: { bind: "ground", geom: ground },
    });
    if (!("session" in mid)) throw new Error("expected session");
    const typed = typeTool(mid.session, "-shelf.distance");
    expect(commitTool(typed, null, scope)).toEqual({
      insert: {
        from: "parallelLine",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "neg", expr: { kind: "member", object: "shelf", field: "distance" } },
        ],
      },
    });
  });

  test("point on a line inserts pointOnLine", () => {
    const onGround: PlacePoint = { kind: "pointOnLine", bind: "ground", s: 2.2, at: { x: 2.2, y: 0 } };
    const r = clickTool(startTool("point"), { world: onGround.at, point: onGround });
    expect(r).toEqual({
      insert: {
        from: "pointOnLine",
        args: [{ kind: "ref", name: "ground" }, { kind: "num", value: 2.2 }],
      },
    });
  });

  test("point on a segment inserts pointOnSegment", () => {
    const onSpan: PlacePoint = { kind: "pointOnSegment", bind: "span", t: 0.75, at: { x: 3, y: 0 } };
    const r = clickTool(startTool("point"), { world: onSpan.at, point: onSpan });
    expect(r).toEqual({
      insert: {
        from: "pointOnSegment",
        args: [{ kind: "ref", name: "span" }, { kind: "num", value: 0.75 }],
      },
    });
  });

  test("point on a circle inserts pointOnCircle", () => {
    const onReach: PlacePoint = { kind: "pointOnCircle", bind: "reach", ux: 0, uy: 1, at: { x: 0, y: 2 } };
    const r = clickTool(startTool("point"), { world: onReach.at, point: onReach });
    expect(r).toEqual({
      insert: {
        from: "pointOnCircle",
        args: [
          { kind: "ref", name: "reach" },
          { kind: "num", value: 0 },
          { kind: "num", value: 1 },
        ],
      },
    });
  });

  test("line first click on ink stores a free point, not a glider", () => {
    const onGround: PlacePoint = { kind: "pointOnLine", bind: "ground", s: 2.2, at: { x: 2.2, y: 0 } };
    const mid = clickTool(startTool("line"), { world: onGround.at, point: onGround });
    if (!("session" in mid) || mid.session.verb !== "line") throw new Error("expected session");
    expect(mid.session.a?.expr).toEqual({
      kind: "call",
      name: "point",
      args: [{ kind: "num", value: 2.2 }, { kind: "num", value: 0 }],
    });
    const done = clickTool(mid.session, { world: namedA.at, point: namedA });
    expect(done).toMatchObject({
      insert: {
        from: "line",
        args: [
          { kind: "call", name: "point" },
          { kind: "ref", name: "A" },
        ],
      },
    });
  });

  test("perpendicular line picks a carrier then inserts through a point", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const mid = clickTool(startTool("perpendicularLine"), {
      world: { x: 1, y: 0 },
      point: free(1, 0),
      carrier: { bind: "ground", geom: ground },
    });
    if (!("session" in mid) || mid.session.verb !== "perpendicularLine" || !mid.session.carrier) {
      throw new Error("expected carrier session");
    }
    const done = clickTool(mid.session, { world: { x: 0, y: 2 }, point: free(0, 2) });
    expect(done).toEqual({
      insert: {
        from: "perpendicularLine",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "call", name: "point", args: [{ kind: "num", value: 0 }, { kind: "num", value: 2 }] },
        ],
      },
    });
  });

  test("perpendicular line through ink stores a free point, not a glider", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const mid = clickTool(startTool("perpendicularLine"), {
      world: { x: 1, y: 0 },
      point: free(1, 0),
      carrier: { bind: "ground", geom: ground },
    });
    if (!("session" in mid)) throw new Error("expected session");
    const onShelf: PlacePoint = { kind: "pointOnLine", bind: "shelf", s: 1.5, at: { x: 1.5, y: 1.8 } };
    const done = clickTool(mid.session, { world: onShelf.at, point: onShelf });
    expect(done).toEqual({
      insert: {
        from: "perpendicularLine",
        args: [
          { kind: "ref", name: "ground" },
          {
            kind: "call",
            name: "point",
            args: [{ kind: "num", value: 1.5 }, { kind: "num", value: 1.8 }],
          },
        ],
      },
    });
  });

  test("parallel line distance ignores a glider and reuses shelf.distance", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const shelfGeom = {
      kind: "parallelLine" as const,
      line: { kind: "line" as const, origin: { x: 0, y: 1.76 }, direction: { x: 1, y: 0 } },
      distance: 1.76,
    };
    const session = {
      verb: "parallelLine" as const,
      focus: "typed" as const,
      typed: "",
      name: "",
      carrierRef: "",
      carrier: { expr: { kind: "ref" as const, name: "ground" }, geom: ground },
    };
    const onShelf: PlacePoint = { kind: "pointOnLine", bind: "shelf", s: 2, at: { x: 2, y: 1.76 } };
    const done = clickTool(session, {
      world: onShelf.at,
      point: onShelf,
      length: { expr: { kind: "member", object: "shelf", field: "distance" }, value: 1.76 },
    });
    expect(done).toEqual({
      insert: {
        from: "parallelLine",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "member", object: "shelf", field: "distance" },
        ],
      },
    });
  });

  test("perpendicular line typed point commits on Enter", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const scope = {
      used: ["ground", "P"],
      points: { P: { expr: { kind: "ref", name: "P" }, at: { x: 0, y: 2 } } },
      carriers: { ground: { expr: { kind: "ref", name: "ground" }, geom: ground } },
      circles: {}, profiles: {},
      lengths: {},
    };
    const mid = clickTool(startTool("perpendicularLine"), {
      world: { x: 1, y: 0 },
      point: free(1, 0),
      carrier: { bind: "ground", geom: ground },
    });
    if (!("session" in mid)) throw new Error("expected session");
    const typed = typeTool(mid.session, "P");
    expect(commitTool(typed, null, scope)).toEqual({
      insert: {
        from: "perpendicularLine",
        args: [{ kind: "ref", name: "ground" }, { kind: "ref", name: "P" }],
      },
    });
  });
});

describe("ghostOf", () => {
  test("rubber-bands a free point under the cursor", () => {
    expect(ghostOf(startTool("point"), { world: { x: 1.2, y: -3 }, point: free(1.2, -3) })).toEqual({
      kind: "point",
      at: { x: 1.2, y: -3 },
    });
  });

  test("rubber-bands a circle after the center", () => {
    const g = ghostOf(
      { verb: "circle", focus: "typed", typed: "", name: "", centerRef: "", center: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } },
      { world: { x: 0, y: 2 }, point: free(0, 2) },
    );
    expect(g).toEqual({ kind: "circle", center: { x: 0, y: 0 }, radius: 2 });
  });

  test("previews a slider radius after the center", () => {
    const g = ghostOf(
      { verb: "circle", focus: "typed", typed: "", name: "", centerRef: "", center: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } },
      { world: { x: 0, y: 0 }, point: free(0, 0), length: { expr: { kind: "ref", name: "reach" }, value: 2.5 } },
      { used: ["A", "reach"], points: { A: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } }, carriers: {}, circles: {}, profiles: {}, lengths: { reach: 2.5 } },
    );
    expect(g).toEqual({ kind: "circle", center: { x: 0, y: 0 }, radius: 2.5 });
  });

  test("previews a parallel line after picking the carrier", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const g = ghostOf(
      { verb: "parallelLine", focus: "typed", typed: "", name: "", carrierRef: "", carrier: { expr: { kind: "ref", name: "ground" }, geom: ground } },
      { world: { x: 0, y: 1.5 }, point: free(0, 1.5) },
    );
    expect(g).toEqual({ kind: "parallelLine", geom: ground, distance: 1.5 });
  });

  test("previews a slider distance on a parallel line", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const g = ghostOf(
      { verb: "parallelLine", focus: "typed", typed: "", name: "", carrierRef: "", carrier: { expr: { kind: "ref", name: "ground" }, geom: ground } },
      { world: { x: 0, y: 0 }, point: free(0, 0), length: { expr: { kind: "ref", name: "reach" }, value: 1.25 } },
      { used: ["ground", "reach"], points: {}, carriers: {}, circles: {}, profiles: {}, lengths: { reach: 1.25 } },
    );
    expect(g).toEqual({ kind: "parallelLine", geom: ground, distance: 1.25 });
  });

  test("does not preview a parallel line before the carrier is chosen", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    expect(
      ghostOf(
        { verb: "parallelLine", focus: "name", typed: "", name: "", carrierRef: "" },
        { world: { x: 1, y: 0 }, point: free(1, 0), carrier: { bind: "ground", geom: ground } },
      ),
    ).toBeNull();
  });

  test("parallel line distance snaps to a named point for the ghost", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const g = ghostOf(
      { verb: "parallelLine", focus: "typed", typed: "", name: "", carrierRef: "", carrier: { expr: { kind: "ref", name: "ground" }, geom: ground } },
      { world: { x: 9, y: 0.2 }, point: namedP },
    );
    expect(g).toEqual({ kind: "parallelLine", geom: ground, distance: 0 });
  });

  test("previews a perpendicular line after picking the carrier", () => {
    const ground = {
      kind: "line" as const,
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const g = ghostOf(
      {
        verb: "perpendicularLine",
        focus: "through",
        throughRef: "",
        name: "",
        carrierRef: "",
        carrier: { expr: { kind: "ref", name: "ground" }, geom: ground },
      },
      { world: { x: 0, y: 2 }, point: free(0, 2) },
    );
    expect(g).toEqual({ kind: "line", a: { x: 0, y: 2 }, b: { x: 0, y: 3 } });
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

  test("shows a glider constructor while hovering a line", () => {
    const onGround: PlacePoint = { kind: "pointOnLine", bind: "ground", s: 2.2, at: { x: 2.2, y: 0 } };
    const p = previewOf(startTool("point"), { world: onGround.at, point: onGround });
    expect(p.line).toBe("const g = pointOnLine(ground, 2.2)");
  });

  test("shows dist() when a circle radius hovers a point", () => {
    const p = previewOf(
      { verb: "circle", focus: "typed", typed: "", name: "", centerRef: "", center: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } },
      { world: namedP.at, point: namedP },
    );
    expect(p.line).toBe("const c = circle(A, dist(A, P))");
  });

  test("hoists a paper center so dist() reuses one point", () => {
    const center = {
      kind: "call" as const,
      name: "point",
      args: [
        { kind: "num" as const, value: 1 },
        { kind: "num" as const, value: 2 },
      ],
    };
    const p = previewOf(
      { verb: "circle", focus: "typed", typed: "", name: "", centerRef: "", center: { expr: center, at: { x: 1, y: 2 } } },
      { world: namedP.at, point: namedP },
    );
    expect(p.line).toBe("const p = point(1, 2)\nconst c = circle(p, dist(p, P))");
  });

  test("previews a crossing center as its own named point", () => {
    const p = previewOf(startTool("circle"), { world: ll.at, point: ll });
    expect(p.line).toBe("const x = lineIntersection(ground, wall)\nconst c = circle(x, radius)");
  });

  test("keeps a typed name on the outer const, not the hoisted crossing", () => {
    const p = previewOf(
      { verb: "circle", focus: "name", typed: "", name: "reach", centerRef: "" },
      { world: ll.at, point: ll },
    );
    expect(p.line).toBe("const x = lineIntersection(ground, wall)\nconst reach = circle(x, radius)");
  });

  test("hoists a stored crossing center when pinning dist()", () => {
    const p = previewOf(
      { verb: "circle", focus: "typed", typed: "", name: "", centerRef: "", center: { expr: exprOfPlace(ll), at: ll.at } },
      { world: namedP.at, point: namedP },
    );
    expect(p.line).toBe("const x = lineIntersection(ground, wall)\nconst c = circle(x, dist(x, P))");
  });
  test("exposes the focused token so the prompt can caret into the source", () => {
    const x = previewOf(startTool("point"));
    expect(x.line).toBe("const p = point(x, y)");
    expect(x.before).toBe("const p = point(");
    expect(x.token).toBe("x");
    expect(x.after).toBe(", y)");
    const name = previewOf(tabTool(tabTool(startTool("point"))));
    expect(name.before).toBe("const ");
    expect(name.token).toBe("p");
    expect(name.after).toBe(" = point(x, y)");
  });
});

describe("filterTools", () => {
  test("matches round offset by offset in the title", () => {
    expect(filterTools("offset").map((t) => t.id)).toEqual(["roundOffset"]);
  });

  test("matches parallel line by parallel", () => {
    expect(filterTools("parallel").map((t) => t.id)).toEqual(["parallelLine"]);
  });

  test("matches round offset by inset alias", () => {
    expect(filterTools("inset").map((t) => t.id)).toEqual(["roundOffset"]);
  });

  test("matches perpendicular line by alias", () => {
    expect(filterTools("perpendicular").map((t) => t.id)).toEqual(["perpendicularLine"]);
  });

  test("matches glider by alias on the point tool", () => {
    expect(filterTools("glider").map((t) => t.id)).toEqual(["point"]);
    expect(filterTools("pointOn").map((t) => t.id)).toEqual(["point"]);
  });

  test("matches slider by name", () => {
    expect(filterTools("slider").map((t) => t.id)).toEqual(["slider"]);
  });

  test("matches profile by face alias", () => {
    expect(filterTools("face").map((t) => t.id)).toEqual(["profile"]);
  });

  test("title hits beat description hits", () => {
    expect(filterTools("line").map((t) => t.id)).toEqual(["line", "parallelLine", "perpendicularLine"]);
  });

  test("falls back to aliases when the title does not match", () => {
    expect(filterTools("fill").map((t) => t.id)).toEqual(["profile"]);
  });

  test("fillet matches fillet, fil, and the corner alias", () => {
    expect(filterTools("fillet").map((t) => t.id)).toEqual(["fillet"]);
    expect(filterTools("fil").map((t) => t.id)).toEqual(["fillet"]);
    expect(filterTools("corner").map((t) => t.id)).toEqual(["fillet"]);
  });
});

describe("slider tool", () => {
  test("click measures from the origin when value is empty", () => {
    const done = clickTool(startTool("slider"), { world: { x: 3, y: 4 }, point: free(3, 4) });
    expect(done).toEqual({
      insert: {
        from: "slider",
        args: [{ kind: "num", value: 5 }, { kind: "props", props: {} }],
      },
    });
  });

  test("click uses a typed value", () => {
    let s = startTool("slider");
    s = typeTool(s, "2.2") as typeof s;
    const done = clickTool(s, { world: { x: 9, y: 0 }, point: free(9, 0) });
    expect(done).toEqual({
      insert: {
        from: "slider",
        args: [{ kind: "num", value: 2.2 }, { kind: "props", props: {} }],
      },
    });
  });

  test("tabs value → min → max → step → name", () => {
    let s = startTool("slider");
    expect(s.focus).toBe("value");
    s = tabTool(s);
    expect(s).toMatchObject({ focus: "min" });
    s = tabTool(s);
    expect(s).toMatchObject({ focus: "max" });
    s = tabTool(s);
    expect(s).toMatchObject({ focus: "step" });
    s = tabTool(s);
    expect(s).toMatchObject({ focus: "name" });
  });

  test("preview exposes the focused value slot", () => {
    const p = previewOf(startTool("slider"));
    expect(p.line).toBe("const n = slider(<value>, { min: <min>, max: <max>, step: <step> })");
    expect(p.token).toBe("<value>");
  });
});

describe("profile tool", () => {
  const namedB: PlacePoint = { kind: "ref", bind: "B", id: "o_b", at: { x: 0, y: 2 } };
  const chord = { kind: "segment" as const, a: { x: 2, y: 0 }, b: { x: 0, y: 2 } };
  const reach = { kind: "circle" as const, center: { x: 0, y: 0 }, radius: 2 };

  test("closes as profile([A, chord, B, along(c, k)], id) without extra constructors", () => {
    let s = startTool("profile");
    const a = clickTool(s, { world: { x: 0, y: 0 }, point: namedA });
    if (!("session" in a)) throw new Error("expected A");
    const c1 = clickTool(a.session, {
      world: { x: 1, y: 1 },
      point: free(1, 1),
      carrier: { bind: "chord", geom: chord },
    });
    if (!("session" in c1)) throw new Error("expected chord");
    const b = clickTool(c1.session, { world: { x: 0, y: 2 }, point: namedB });
    if (!("session" in b)) throw new Error("expected B");
    const c2 = clickTool(b.session, {
      world: { x: 1.4, y: 1.4 },
      point: free(1.4, 1.4),
      carrier: { bind: "reach", geom: reach },
    });
    if (!("session" in c2)) throw new Error("expected along");
    const done = clickTool(c2.session, { world: { x: 2, y: 0 }, point: namedA });
    expect(done).toEqual({
      insert: {
        from: "profile",
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
                  { kind: "ref", name: "reach" },
                  { kind: "num", value: -1 },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  test("ignores a free click in a point slot", () => {
    const r = clickTool(startTool("profile"), { world: { x: 1, y: 1 }, point: free(1, 1) });
    expect(r).toEqual({ session: startTool("profile") });
  });

  test("point slot accepts a line crossing and hoists it on insert", () => {
    let s = startTool("profile");
    const x = clickTool(s, { world: { x: 2, y: 0 }, point: ll });
    if (!("session" in x) || x.session.verb !== "profile") throw new Error("expected crossing");
    expect(x.session.vertices[0]?.expr).toEqual({
      kind: "call",
      name: "lineIntersection",
      args: [
        { kind: "ref", name: "ground" },
        { kind: "ref", name: "wall" },
      ],
    });
    const c1 = clickTool(x.session, {
      world: { x: 1, y: 1 },
      point: free(1, 1),
      carrier: { bind: "chord", geom: chord },
    });
    if (!("session" in c1)) throw new Error("expected chord");
    const b = clickTool(c1.session, { world: { x: 0, y: 2 }, point: namedB });
    if (!("session" in b)) throw new Error("expected B");
    const c2 = clickTool(b.session, {
      world: { x: 1.4, y: 1.4 },
      point: free(1.4, 1.4),
      carrier: { bind: "reach", geom: reach },
    });
    if (!("session" in c2)) throw new Error("expected along");
    const done = clickTool(c2.session, { world: { x: 2, y: 0 }, point: ll });
    expect(done).toMatchObject({
      insert: {
        from: "profile",
        args: [
          {
            kind: "array",
            items: [
              {
                kind: "call",
                name: "lineIntersection",
                args: [
                  { kind: "ref", name: "ground" },
                  { kind: "ref", name: "wall" },
                ],
              },
              { kind: "ref", name: "chord" },
              { kind: "ref", name: "B" },
              { kind: "call", name: "along" },
            ],
          },
        ],
      },
    });
  });

  test("point slot accepts circle-line and circle-circle crossings", () => {
    const clHit = clickTool(startTool("profile"), { world: cl.at, point: cl });
    if (!("session" in clHit) || clHit.session.verb !== "profile") throw new Error("expected cl");
    expect(clHit.session.vertices[0]?.expr).toMatchObject({ kind: "call", name: "circleLineIntersection" });
    const ccHit = clickTool(startTool("profile"), { world: cc.at, point: cc });
    if (!("session" in ccHit) || ccHit.session.verb !== "profile") throw new Error("expected cc");
    expect(ccHit.session.vertices[0]?.expr).toMatchObject({ kind: "call", name: "circleCircleIntersection" });
  });

  test("Tab flips along k on the last circle", () => {
    let s = startTool("profile");
    const a = clickTool(s, { world: { x: 2, y: 0 }, point: namedA });
    if (!("session" in a)) throw new Error("expected A");
    const c1 = clickTool(a.session, {
      world: { x: 1, y: 1 },
      point: free(1, 1),
      carrier: { bind: "chord", geom: chord },
    });
    if (!("session" in c1)) throw new Error("expected chord");
    const b = clickTool(c1.session, { world: { x: 0, y: 2 }, point: namedB });
    if (!("session" in b)) throw new Error("expected B");
    const c2 = clickTool(b.session, {
      world: { x: 1.4, y: 1.4 },
      point: free(1.4, 1.4),
      carrier: { bind: "reach", geom: reach },
    });
    if (!("session" in c2) || c2.session.verb !== "profile") throw new Error("expected along");
    expect(c2.session.carriers[1]?.k).toBe(-1);
    const flipped = tabTool(c2.session);
    if (flipped.verb !== "profile") throw new Error("expected profile");
    expect(flipped.carriers[1]?.k).toBe(1);
  });

  test("carrier snap ignores a stroke that misses the current vertex", () => {
    const axis = {
      id: "o_x",
      occ: 0,
      kind: "line",
      bind: "axis",
      value: { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
      editable: false,
      stack: [],
    } as TraceNode;
    const far = {
      id: "o_far",
      occ: 0,
      kind: "segment",
      bind: "far",
      value: { kind: "segment", a: { x: 0, y: 3 }, b: { x: 4, y: 3 } },
      editable: false,
      stack: [],
    } as TraceNode;
    const ctx = {
      trace: [axis, far],
      camera: { x: 0, y: 0, scale: 48 },
      size: { w: 800, h: 600 },
    };
    const a = clickTool(startTool("profile"), { world: { x: 0, y: 0 }, point: namedA });
    if (!("session" in a) || a.session.verb !== "profile") throw new Error("expected A");
    expect([...profileEligibleCarriers(a.session, ctx.trace, ctx.camera)!]).toEqual(["axis"]);
    const miss = enrichHit(a.session, { world: { x: 2, y: 3 }, point: free(2, 3) }, ctx);
    expect(miss.carrier).toBeUndefined();
    const hit = enrichHit(a.session, { world: { x: 2, y: 0.02 }, point: free(2, 0.02) }, ctx);
    expect(hit.carrier?.bind).toBe("axis");
  });

  test("hides existing fills for the whole Profile session", () => {
    expect(profileHidesExisting(startTool("profile"))).toBe(true);
    expect(profileHidesExisting(startTool("line"))).toBe(false);
    expect(profileHidesExisting(null)).toBe(false);
  });

  test("ghost arrow sits on the carrier at the vertex, pointing along it", () => {
    const a = clickTool(startTool("profile"), { world: { x: 0, y: 0 }, point: namedA });
    if (!("session" in a)) throw new Error("expected A");
    const xAxis = { kind: "line" as const, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    const g = ghostOf(a.session, {
      world: { x: 2, y: 0.4 },
      point: free(2, 0.4),
      carrier: { bind: "axis", geom: xAxis },
    });
    expect(g).toMatchObject({
      kind: "profile",
      arrow: { at: { x: 0, y: 0 }, tx: 1, ty: 0 },
    });
  });
});

describe("roundOffset tool", () => {
  const square = {
    kind: "profile" as const,
    outer: [
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, carrier: { kind: "segment" as const, a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } },
      { a: { x: 1, y: 0 }, b: { x: 1, y: 1 }, carrier: { kind: "segment" as const, a: { x: 1, y: 0 }, b: { x: 1, y: 1 } } },
      { a: { x: 1, y: 1 }, b: { x: 0, y: 1 }, carrier: { kind: "segment" as const, a: { x: 1, y: 1 }, b: { x: 0, y: 1 } } },
      { a: { x: 0, y: 1 }, b: { x: 0, y: 0 }, carrier: { kind: "segment" as const, a: { x: 0, y: 1 }, b: { x: 0, y: 0 } } },
    ],
  };
  const faceHit = {
    world: { x: 0.5, y: 0.5 },
    point: free(0.5, 0.5),
    profile: { bind: "slice", geom: square },
  };

  test("picks a profile then a slider length", () => {
    const mid = clickTool(startTool("roundOffset"), faceHit);
    if (!("session" in mid)) throw new Error("expected session");
    const scope = {
      used: ["slice", "n"],
      points: {},
      carriers: {},
      circles: {},
      profiles: { slice: { expr: { kind: "ref" as const, name: "slice" }, geom: square } },
      lengths: { n: 0.2 },
    };
    expect(
      clickTool(
        mid.session,
        { world: { x: 0, y: 0 }, point: free(0, 0), length: { expr: { kind: "ref", name: "n" }, value: 0.2 } },
        scope,
      ),
    ).toEqual({
      insert: {
        from: "roundOffset",
        args: [{ kind: "ref", name: "slice" }, { kind: "ref", name: "n" }],
      },
    });
  });

  test("reuses a circle radius and a parallel distance", () => {
    const mid = clickTool(startTool("roundOffset"), faceHit);
    if (!("session" in mid)) throw new Error("expected session");
    const scope = {
      used: ["slice", "reach", "shelf"],
      points: {},
      carriers: {},
      circles: {},
      profiles: { slice: { expr: { kind: "ref" as const, name: "slice" }, geom: square } },
      lengths: {},
    };
    expect(
      clickTool(
        mid.session,
        {
          world: { x: 0, y: 0 },
          point: free(0, 0),
          length: { expr: { kind: "member", object: "reach", field: "radius" }, value: 2 },
        },
        scope,
      ),
    ).toEqual({
      insert: {
        from: "roundOffset",
        args: [{ kind: "ref", name: "slice" }, { kind: "member", object: "reach", field: "radius" }],
      },
    });
    expect(
      clickTool(
        mid.session,
        {
          world: { x: 0, y: 0 },
          point: free(0, 0),
          length: { expr: { kind: "member", object: "shelf", field: "distance" }, value: 0.2 },
        },
        scope,
      ),
    ).toEqual({
      insert: {
        from: "roundOffset",
        args: [{ kind: "ref", name: "slice" }, { kind: "member", object: "shelf", field: "distance" }],
      },
    });
  });

  test("typed length commits on Enter", () => {
    const mid = clickTool(startTool("roundOffset"), faceHit);
    if (!("session" in mid)) throw new Error("expected session");
    expect(commitTool(typeTool(mid.session, "0.2"))).toEqual({
      insert: {
        from: "roundOffset",
        args: [{ kind: "ref", name: "slice" }, { kind: "num", value: 0.2 }],
      },
    });
  });

  test("ghosts the offset profile from a length pick", () => {
    const mid = clickTool(startTool("roundOffset"), faceHit);
    if (!("session" in mid)) throw new Error("expected session");
    const g = ghostOf(
      mid.session,
      { world: { x: 0, y: 0 }, point: free(0, 0), length: { expr: { kind: "ref", name: "n" }, value: 0.2 } },
      {
        used: ["slice", "n"],
        points: {},
        carriers: {},
        circles: {},
        profiles: { slice: { expr: { kind: "ref", name: "slice" }, geom: square } },
        lengths: { n: 0.2 },
      },
    );
    expect(g?.kind).toBe("profile");
    if (g?.kind === "profile") expect(g.edges).toHaveLength(8);
  });
});

describe("fillet tool", () => {
  const square = {
    kind: "profile" as const,
    outer: [
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, carrier: { kind: "segment" as const, a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } },
      { a: { x: 1, y: 0 }, b: { x: 1, y: 1 }, carrier: { kind: "segment" as const, a: { x: 1, y: 0 }, b: { x: 1, y: 1 } } },
      { a: { x: 1, y: 1 }, b: { x: 0, y: 1 }, carrier: { kind: "segment" as const, a: { x: 1, y: 1 }, b: { x: 0, y: 1 } } },
      { a: { x: 0, y: 1 }, b: { x: 0, y: 0 }, carrier: { kind: "segment" as const, a: { x: 0, y: 1 }, b: { x: 0, y: 0 } } },
    ],
  };
  const faceHit = {
    world: { x: 0.95, y: 0.95 },
    point: free(0.95, 0.95),
    profile: { bind: "mix", geom: square, id: "o_fil_mix" },
  };
  const scope = {
    used: ["mix", "r"],
    points: {
      C: { expr: { kind: "ref" as const, name: "C" }, at: { x: 1, y: 1 } },
    },
    carriers: {},
    circles: {},
    profiles: { mix: { expr: { kind: "ref" as const, name: "mix" }, geom: square } },
    lengths: { r: 0.35 },
  };

  test("picks the closest corner then a slider", () => {
    const mid = clickTool(startTool("fillet"), faceHit, scope);
    if (!("session" in mid)) throw new Error("expected session");
    expect(mid.session).toMatchObject({ verb: "fillet", vertex: 2, faceId: "o_fil_mix" });
    expect(
      clickTool(
        mid.session,
        { world: { x: 0, y: 0 }, point: free(0, 0), length: { expr: { kind: "ref", name: "r" }, value: 0.35 } },
        scope,
      ),
    ).toEqual({
      insert: {
        from: "fillet",
        args: [{ kind: "ref", name: "r" }],
        patchVertex: { id: "o_fil_mix", index: 2 },
      },
    });
  });

  test("typed radius commits on Enter and preview has no new const", () => {
    const mid = clickTool(startTool("fillet"), faceHit, scope);
    if (!("session" in mid)) throw new Error("expected session");
    expect(commitTool(typeTool(mid.session, "0.2"), null, scope)).toEqual({
      insert: {
        from: "fillet",
        args: [{ kind: "num", value: 0.2 }],
        patchVertex: { id: "o_fil_mix", index: 2 },
      },
    });
    const preview = previewOf(mid.session, null, scope);
    expect(preview.line).toContain("profile([");
    expect(preview.line).toContain("fillet(");
    expect(preview.line).not.toMatch(/^const /);
  });

  test("enrichHit sets the closest vertex", () => {
    const ctx = {
      trace: [
        {
          id: "o_fil_mix",
          occ: 0,
          kind: "profile",
          bind: "mix",
          value: square,
          editable: false,
          stack: [],
        } as TraceNode,
      ],
      camera: { x: 0, y: 0, scale: 48 },
      size: { w: 800, h: 600 },
      screen: { x: 10, y: 10 },
    };
    const hit = enrichHit(startTool("fillet"), { world: { x: 0.02, y: 0.01 }, point: free(0.02, 0.01) }, ctx);
    expect(hit.profile?.id).toBe("o_fil_mix");
    expect(hit.corner?.index).toBe(0);
    expect(hit.corner?.at.x).toBeCloseTo(0);
    expect(hit.corner?.at.y).toBeCloseTo(0);
  });

  test("subdues points and strokes while picking a corner, not fills", () => {
    expect(toolChrome(startTool("fillet"))).toEqual({
      hideFills: false,
      muteStrokes: true,
      mutePoints: true,
      hideSnap: true,
    });
    const mid = clickTool(startTool("fillet"), faceHit, scope);
    if (!("session" in mid)) throw new Error("expected session");
    expect(toolChrome(mid.session)).toEqual({
      hideFills: false,
      muteStrokes: false,
      mutePoints: false,
      hideSnap: false,
    });
    expect(toolChrome(startTool("profile")).hideFills).toBe(true);
    expect(toolChrome(startTool("line")).hideFills).toBe(false);
  });

  test("ghosts the closest corner, not the whole face", () => {
    const g = ghostOf(startTool("fillet"), { ...faceHit, corner: { index: 2, at: { x: 1, y: 1 } } }, scope);
    expect(g).toEqual({ kind: "corner", at: { x: 1, y: 1 } });
  });

  test("ghosts the filleted face from a length pick", () => {
    const mid = clickTool(startTool("fillet"), faceHit, scope);
    if (!("session" in mid)) throw new Error("expected session");
    const g = ghostOf(
      mid.session,
      { world: { x: 0, y: 0 }, point: free(0, 0), length: { expr: { kind: "ref", name: "r" }, value: 0.2 } },
      scope,
    );
    expect(g?.kind).toBe("profile");
    if (g?.kind === "profile") {
      expect(g.edges).toHaveLength(5);
      expect(g.edges.filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    }
  });
});
