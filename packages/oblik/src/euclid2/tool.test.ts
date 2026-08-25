import { describe, expect, test } from "vitest";

import { clickTool, ghostOf, startTool } from "./tool";

describe("clickTool", () => {
  test("point click inserts numeric literals", () => {
    const r = clickTool(startTool("point"), { world: { x: 1.234, y: -2 } });
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
    const r = clickTool(startTool("point"), {
      world: { x: 0, y: 0 },
      snap: { id: "o_a", bind: "A", at: { x: 0, y: 0 } },
    });
    expect(r).toEqual({ session: { verb: "point" } });
  });

  test("circle two clicks: ref center, numeric radius", () => {
    const mid = clickTool(startTool("circle"), {
      world: { x: 0.1, y: 0 },
      snap: { id: "o_a", bind: "A", at: { x: 0, y: 0 } },
    });
    if (!("session" in mid)) throw new Error("expected session");
    const done = clickTool(mid.session, { world: { x: 3, y: 4 } });
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

  test("segment second click can nest a free point", () => {
    const mid = clickTool(startTool("segment"), {
      world: { x: 0, y: 0 },
      snap: { id: "o_a", bind: "A", at: { x: 0, y: 0 } },
    });
    if (!("session" in mid)) throw new Error("expected session");
    const done = clickTool(mid.session, { world: { x: 2, y: 0 } });
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
    const g = ghostOf({ verb: "circle", center: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } }, { x: 0, y: 2 });
    expect(g).toEqual({ kind: "circle", center: { x: 0, y: 0 }, radius: 2 });
  });
});
