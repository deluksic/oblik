import { describe, expect, test } from "vitest";

import type { PlacePoint } from "../place";
import { clickTool, commitTool, ghostOf, startTool } from "./index";
import type { Scope, ToolSession } from "./types";

const free = (x: number, y: number): PlacePoint => ({ kind: "free", at: { x, y } });

function hit(point: PlacePoint) {
  return { world: point.at, point };
}

function hitCircle(
  bind: string,
  geom: Scope["circles"][string]["geom"],
  world: { x: number; y: number },
) {
  return { world, point: free(world.x, world.y), carrier: { bind, geom } };
}

/** Circle C: center (0,0) r 1; point P (2,0): contacts (0.5, ±√3/2). */
const circleC = { kind: "circle" as const, center: { x: 0, y: 0 }, radius: 1 };
/** Circle D: center (5,0) r 1 — outer belts y = ±1, inner tangents cross between. */
const circleD = { kind: "circle" as const, center: { x: 5, y: 0 }, radius: 1 };

const scope: Scope = {
  used: ["P", "C", "D"],
  points: { P: { expr: { kind: "ref", name: "P" }, at: { x: 2, y: 0 } } },
  carriers: {},
  circles: {
    C: { expr: { kind: "ref", name: "C" }, geom: circleC },
    D: { expr: { kind: "ref", name: "D" }, geom: circleD },
  },
  regions: {},
  lengths: {},
  byId: {
    P: { kind: "ref", name: "P" },
    C: { kind: "ref", name: "C" },
    D: { kind: "ref", name: "D" },
  },
};

const { sqrt } = Math;

type TSession = Extract<ToolSession, { verb: "tangent" }>;

const pointCall = (x: number, y: number) => ({
  kind: "call" as const,
  name: "point",
  args: [
    { kind: "num" as const, value: x },
    { kind: "num" as const, value: y },
  ],
});

describe("tangent tool", () => {
  test("starts with two empty operand slots, no ghost", () => {
    const s0 = startTool("tangent");
    expect(s0).toMatchObject({ verb: "tangent", focus: "a", a: undefined, b: undefined });
    expect(ghostOf(s0, hit(free(1, 1)), scope)).toBeUndefined();
  });

  test("point then circle: ghost shows both tangents, a click picks the branch", () => {
    const s0 = startTool("tangent");
    const p1 = clickTool(s0, hit(free(2, 0)), scope);
    if (!("session" in p1)) throw new Error("expected session");
    const s1 = p1.session as TSession;
    expect(s1.a).toMatchObject({ kind: "point" });
    expect(s1.focus).toBe("b");

    const c1 = clickTool(s1, hitCircle("C", circleC, { x: 0.5, y: 1.2 }), scope);
    if (!("session" in c1)) throw new Error("expected session after the circle click");
    const s2 = c1.session as TSession;
    expect(s2.b).toMatchObject({ kind: "circle" });

    const g = ghostOf(s2, hit(free(0.5, 1)), scope);
    if (g?.kind !== "tangent") throw new Error("expected tangent ghost");
    expect(g.strokes).toHaveLength(2);
    expect(g.strokes[0]!.a).toEqual({ x: 2, y: 0 });
    expect(g.strokes[0]!.b.x).toBeCloseTo(0.5);
    expect(g.strokes[0]!.b.y).toBeCloseTo(sqrt(3) / 2);
    expect(g.strokes[1]!.b.y).toBeCloseTo(-sqrt(3) / 2);
    expect(g.chosen).toBe(0); // cursor above → the upper tangent

    // Click far out along the upper tangent → branch +1.
    const done = clickTool(s2, hit(free(-4, 3.46)), scope);
    if (!("insert" in done)) throw new Error("expected insert");
    expect(done.insert.from).toBe("tangentPointCircle");
    expect(done.insert.args).toEqual([
      pointCall(2, 0),
      { kind: "ref", name: "C" },
      { kind: "num", value: 1 },
    ]);

    // ... and along the lower tangent → branch −1.
    const down = clickTool(s2, hit(free(-4, -3.46)), scope);
    if (!("insert" in down)) throw new Error("expected insert");
    expect(down.insert.args).toEqual([
      pointCall(2, 0),
      { kind: "ref", name: "C" },
      { kind: "num", value: -1 },
    ]);
  });

  test("circle first, point second — the call is still point-first", () => {
    const s0 = startTool("tangent");
    const c1 = clickTool(s0, hitCircle("C", circleC, { x: 0.5, y: 1.2 }), scope);
    if (!("session" in c1)) throw new Error("expected session");
    const s1 = c1.session;
    const p1 = clickTool(s1, hit(free(2, 0)), scope);
    if (!("session" in p1)) throw new Error("expected session");
    const s2 = p1.session;
    const done = clickTool(s2, hit(free(-4, 3.46)), scope);
    if (!("insert" in done)) throw new Error("expected insert");
    expect(done.insert.from).toBe("tangentPointCircle");
    expect(done.insert.args).toEqual([
      pointCall(2, 0),
      { kind: "ref", name: "C" },
      { kind: "num", value: 1 },
    ]);
  });

  test("two circles ghost four candidates; a click picks outer or inner", () => {
    const s0 = startTool("tangent");
    const c1 = clickTool(s0, hitCircle("C", circleC, { x: -1, y: 0 }), scope);
    if (!("session" in c1)) throw new Error("expected session");
    const s1 = c1.session;
    const c2 = clickTool(s1, hitCircle("D", circleD, { x: 5, y: -1 }), scope);
    if (!("session" in c2)) throw new Error("expected session");
    const s2 = c2.session;

    const g = ghostOf(s2, hit(free(2.5, 1.4)), scope);
    if (g?.kind !== "tangent") throw new Error("expected tangent ghost");
    expect(g.strokes).toHaveLength(4); // two outer belts + two inner crossings

    const outer = clickTool(s2, hit(free(2.5, 1.4)), scope);
    if (!("insert" in outer)) throw new Error("expected outer insert");
    expect(outer.insert.from).toBe("tangentCircleCircleOuter");
    expect(outer.insert.args).toEqual([
      { kind: "ref", name: "C" },
      { kind: "ref", name: "D" },
      { kind: "num", value: 1 },
    ]);

    // Click near the upper inner crossing (through (0.4, 0.92) → (4.6, −0.92)).
    const inner = clickTool(s2, hit(free(2.5, 0.05)), scope);
    if (!("insert" in inner)) throw new Error("expected inner insert");
    expect(inner.insert.from).toBe("tangentCircleCircleInner");
  });

  test("typed mentions commit with the branch from the cursor", () => {
    const s0 = startTool("tangent");
    const typed: TSession = { ...(s0 as TSession), aRef: "P", bRef: "C" };
    const step = commitTool(typed, hit(free(-4, 3.46)), scope);
    if (!step || !("insert" in step)) throw new Error("expected insert");
    expect(step.insert.args).toEqual([
      { kind: "ref", name: "P" },
      { kind: "ref", name: "C" },
      { kind: "num", value: 1 },
    ]);
  });

  test("point inside the circle: no candidates, nothing to commit", () => {
    const s0 = startTool("tangent");
    const p1 = clickTool(s0, hit(free(0.4, 0)), scope);
    if (!("session" in p1)) throw new Error("expected session");
    const s1 = p1.session;
    const c1 = clickTool(s1, hitCircle("C", circleC, { x: 0.5, y: 1.2 }), scope);
    if (!("session" in c1)) throw new Error("expected session");
    const s2 = c1.session;
    expect(ghostOf(s2, hit(free(0.5, 1.2)), scope)).toBeUndefined();
    const step = commitTool(s2, hit(free(0.5, 1.2)), scope);
    expect(step).toBeUndefined();
    const click = clickTool(s2, hit(free(0.5, 1.2)), scope);
    if ("insert" in click) throw new Error("did not expect insert");
  });

  test("two points never form a tangent — the second click re-places the point", () => {
    const s0 = startTool("tangent");
    const p1 = clickTool(s0, hit(free(2, 0)), scope);
    if (!("session" in p1)) throw new Error("expected session");
    const p2 = clickTool(p1.session, hit(free(3, 1)), scope);
    if (!("session" in p2)) throw new Error("expected session");
    const s = p2.session as TSession;
    const op = s.a;
    if (op?.kind !== "point") throw new Error("expected a point operand");
    expect(op.placed.at).toEqual({ x: 3, y: 1 });
    expect(s.b).toBeUndefined();
  });

  test("unknown typed operand blocks commit", () => {
    const s0 = startTool("tangent");
    const typed: TSession = { ...(s0 as TSession), aRef: "Nope", bRef: "C" };
    const step = commitTool(typed, hit(free(0.5, 1.2)), scope);
    expect(step).toBeUndefined();
  });
});
