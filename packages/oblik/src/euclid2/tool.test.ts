import { describe, expect, test } from "vitest";

import { clickTool, commitTool, exprOfPlace, filterTools, ghostOf, previewOf, startTool, tabTool, typeTool } from "./tool";
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
      circles: {},
      lengths: { reach: 1.25 },
    };
    expect(
      clickTool(mid.session, { world: { x: 0, y: 0 }, point: free(0, 0), length: { bind: "reach", value: 1.25 } }, scope),
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
      circles: {},
      lengths: { reach: 2.5 },
    };
    expect(
      clickTool(mid.session, { world: { x: 0, y: 0 }, point: free(0, 0), length: { bind: "reach", value: 2.5 } }, scope),
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

  test("line first click on a glider stores the constructor", () => {
    const onGround: PlacePoint = { kind: "pointOnLine", bind: "ground", s: 2.2, at: { x: 2.2, y: 0 } };
    const mid = clickTool(startTool("line"), { world: onGround.at, point: onGround });
    if (!("session" in mid) || mid.session.verb !== "line") throw new Error("expected session");
    expect(mid.session.a?.expr).toEqual({
      kind: "call",
      name: "pointOnLine",
      args: [{ kind: "ref", name: "ground" }, { kind: "num", value: 2.2 }],
    });
    const done = clickTool(mid.session, { world: namedA.at, point: namedA });
    expect(done).toMatchObject({
      insert: {
        from: "line",
        args: [
          { kind: "call", name: "pointOnLine" },
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

  test("perpendicular line through a glider nests pointOnLine", () => {
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
            name: "pointOnLine",
            args: [{ kind: "ref", name: "shelf" }, { kind: "num", value: 1.5 }],
          },
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
      circles: {},
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
      { world: { x: 0, y: 0 }, point: free(0, 0), length: { bind: "reach", value: 2.5 } },
      { used: ["A", "reach"], points: { A: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } }, carriers: {}, circles: {}, lengths: { reach: 2.5 } },
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
      { world: { x: 0, y: 0 }, point: free(0, 0), length: { bind: "reach", value: 1.25 } },
      { used: ["ground", "reach"], points: {}, carriers: {}, circles: {}, lengths: { reach: 1.25 } },
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
  test("matches parallel line by offset alias", () => {
    expect(filterTools("offset").map((t) => t.id)).toEqual(["parallelLine"]);
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
