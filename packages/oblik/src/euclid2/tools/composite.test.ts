import { describe, expect, test } from "vitest";

import type { Region } from "#geom";

import { circle } from "../../eval/constructors";
import type { PlacePoint } from "../place";
import type { CompS } from "./composite";
import { clickTool, commitTool, toolById } from "./index";
import { arg, defineTool } from "./registry";
import type { Scope } from "./types";

const free = (x: number, y: number): PlacePoint => ({ kind: "free", at: { x, y } });
const pinned = (bind: string, x: number, y: number): PlacePoint => ({
  kind: "ref",
  bind,
  key: `${bind}:0`,
  at: { x, y },
});

function hit(point: PlacePoint) {
  return { world: point.at, point };
}

function hitCarrier(bind: string, geom: Scope["carriers"][string]["geom"]) {
  return { world: { x: 1, y: 0 }, point: free(1, 0), carrier: { bind, geom } };
}

function hitRegion(bind: string, geom: Scope["regions"][string]["geom"]) {
  return { world: { x: 0, y: 0 }, point: free(0, 0), region: { bind, geom, id: bind } };
}

const segGeom = { kind: "segment" as const, a: { x: 0, y: 0 }, b: { x: 4, y: 2 } };

const scope: Scope = {
  used: ["P", "S"],
  points: { P: { expr: { kind: "ref", name: "P" }, at: { x: 3, y: 4 } } },
  carriers: {
    S: { expr: { kind: "ref", name: "S" }, geom: segGeom },
  },
  circles: {},
  regions: {},
  lengths: {},
  byId: {
    P: { kind: "ref", name: "P" },
    S: { kind: "ref", name: "S" },
  },
};

function ghostCircle(center: { x: number; y: number }, r: number) {
  return circle({ x: center.x, y: center.y }, r, "o_ghost1");
}

function start(id: string): CompS {
  return toolById(id).start() as CompS;
}

function withText(s: CompS, label: string, raw: string): CompS {
  return { ...s, fills: { ...s.fills, [label]: { kind: "text", raw } } };
}

function registerRect() {
  defineTool((origin: { x: number; y: number }, w: number, h: number) => ({ w, h, origin }), {
    name: "rectDemo",
    title: "Rect demo",
    prefix: "rd",
    args: [arg.point("origin"), arg.number("w"), arg.number("h")],
    module: "/src/demo.ts",
  });
}

function registerBolt() {
  defineTool((center: { x: number; y: number }, r: number, n: number) => ({ r, n, center }), {
    name: "boltDemo",
    title: "Bolt demo",
    prefix: "bd",
    args: [arg.point("center"), arg.length("r", { anchor: "center" }), arg.number("n", { def: 6 })],
    module: "/src/demo.ts",
  });
}

function registerGhost() {
  defineTool(ghostCircle, {
    name: "ghostDemo",
    title: "Ghost demo",
    prefix: "gh",
    args: [arg.point("center"), arg.length("r", { def: 2 })],
    module: "/src/ghost.ts",
  });
}

describe("composite tool sessions", () => {
  test("rect: a corner click does not commit while w/h are unpopulated", () => {
    registerRect();
    const s0 = start("rectDemo");
    expect(s0.focus).toBe("origin");
    const first = clickTool(s0, hit(free(1, 2)), scope);
    if (!("session" in first)) throw new Error("expected session");
    expect(first.session.focus).toBe("w");
    // No ghost while a required number is empty.
    const ghost = toolById("rectDemo").ghost(first.session, hit(free(5, 5)), scope);
    expect(ghost).toBeUndefined();
  });

  test("rect: typing w/h lets the insert commit with the placed corner", () => {
    registerRect();
    const s0 = start("rectDemo");
    const first = clickTool(s0, hit(free(1, 2)), scope);
    if (!("session" in first)) throw new Error("expected session");
    const typed = withText(withText(first.session as CompS, "w", "5"), "h", "3");
    const step = commitTool(typed, undefined, scope);
    if (!step || !("insert" in step)) throw new Error("expected insert");
    const job = step.insert;
    expect(job.from).toBe("rectDemo");
    expect(job.tool).toEqual({ module: "/src/demo.ts", prefix: "rd" });
    expect(job.args[0]).toEqual({
      kind: "call",
      name: "point",
      args: [
        { kind: "num", value: 1 },
        { kind: "num", value: 2 },
      ],
    });
    expect(job.args[1]).toEqual({ kind: "num", value: 5 });
    expect(job.args[2]).toEqual({ kind: "num", value: 3 });
  });

  test("bolt: a pinned-point click after the center measures dist(center, p)", () => {
    registerBolt();
    const s0 = start("boltDemo");
    const first = clickTool(s0, hit(free(0, 0)), scope);
    if (!("session" in first)) throw new Error("expected session");
    const second = clickTool(first.session, hit(pinned("P", 3, 4)), scope);
    if (!("insert" in second)) throw new Error("expected insert");
    const job = second.insert;
    expect(job.args[1]).toEqual({
      kind: "call",
      name: "dist",
      args: [
        {
          kind: "call",
          name: "point",
          args: [
            { kind: "num", value: 0 },
            { kind: "num", value: 0 },
          ],
        },
        { kind: "ref", name: "P" },
      ],
    });
    expect(job.args[2]).toEqual({ kind: "num", value: 6 });
  });

  test("no ghost appears before the first real fill", () => {
    registerGhost();
    const s0 = start("ghostDemo");
    expect(s0.focus).toBe("center");
    const ghost = toolById("ghostDemo").ghost(s0, hit(free(1, 1)), scope);
    expect(ghost).toBeUndefined();
  });

  test("ghost draft-evaluates once the canvas arg is placed", () => {
    registerGhost();
    const s0 = start("ghostDemo");
    const withCenter: CompS = {
      ...s0,
      fills: {
        ...s0.fills,
        center: {
          kind: "expr",
          expr: {
            kind: "call",
            name: "point",
            args: [
              { kind: "num", value: 1 },
              { kind: "num", value: 1 },
            ],
          },
          at: { x: 1, y: 1 },
        },
      },
    };
    const ghost = toolById("ghostDemo").ghost(withCenter, undefined, scope);
    if (ghost?.kind !== "trace") throw new Error("expected trace ghost");
    expect(ghost.nodes).toHaveLength(1);
    const node = ghost.nodes[0]!;
    expect(node.value.kind).toBe("circle");
    if (node.value.kind !== "circle") throw new Error("expected circle");
    expect(node.value.center.x).toBe(1);
    expect(node.value.radius).toBe(2);
    expect(ghost.stamp).toMatch(/^gh-ghostDemo-/);
  });

  test("segment arg: clicking a segment inserts its mention", () => {
    defineTool((seg: { a: { x: number }; b: { x: number } }) => seg, {
      name: "bisectDemo",
      title: "Bisect demo",
      prefix: "bi",
      args: [arg.segment("seg")],
      module: "/src/bisect.ts",
    });
    const s0 = start("bisectDemo");
    const ghost = toolById("bisectDemo").ghost(s0, hitCarrier("S", segGeom), scope);
    expect(ghost).toBeUndefined();
    const done = clickTool(s0, hitCarrier("S", segGeom), scope);
    if (!("insert" in done)) throw new Error("expected insert");
    expect(done.insert.args).toEqual([{ kind: "ref", name: "S" }]);
  });

  test("region member mention like rec.face commits a member expr", () => {
    defineTool((face: Region) => face, {
      name: "faceDemo",
      title: "Face demo",
      prefix: "fd",
      args: [arg.region("face")],
      module: "/src/f.ts",
    });
    const faceGeom = { kind: "region" as const, outer: [], holes: [] };
    const s0 = start("faceDemo");
    const done = clickTool(s0, hitRegion("rec.face", faceGeom), scope);
    if (!("insert" in done)) throw new Error("expected insert");
    expect(done.insert.args).toEqual([
      { kind: "member", object: { kind: "ref", name: "rec" }, field: "face" },
    ]);
  });
});
