import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { clickTool, keyTool, previewOf, startTool, tabTool, typeTool } from "../tool";
import { inSlot, splitSlot, unmarkSlot } from "./draft";
import type { PlaceHit, Placed, Scope, ToolSession, ToolStep } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));

const free = (x: number, y: number): PlaceHit => ({
  world: { x, y },
  point: { kind: "free", at: { x, y } },
});
const named = (bind: string, x: number, y: number): PlaceHit => ({
  world: { x, y },
  point: { kind: "ref", bind, id: `o_${bind}`, at: { x, y } },
});

function asSession(step: ToolStep | undefined): ToolSession {
  if (!step || "insert" in step) throw new Error("expected session");
  return step.session;
}

function typeChars(session: ToolSession, chars: string): ToolSession {
  let s = session;
  for (const key of chars) s = asSession(keyTool(s, { key }));
  return s;
}

function pointScope(...pts: { bind: string; x: number; y: number }[]): Scope {
  const points: Record<string, Placed> = {};
  const used: string[] = [];
  for (const p of pts) {
    used.push(p.bind);
    points[p.bind] = { expr: { kind: "ref", name: p.bind }, at: { x: p.x, y: p.y } };
  }
  return { used, points, carriers: {}, circles: {}, regions: {}, lengths: {}, byId: {} };
}

describe("keyTool", () => {
  test("point tabs x → y → name → x", () => {
    let s = startTool("point");
    expect(s).toMatchObject({ verb: "point", focus: "x" });
    s = tabTool(s);
    expect(s).toMatchObject({ focus: "y" });
    s = tabTool(s);
    expect(s).toMatchObject({ focus: "name" });
    s = tabTool(s);
    expect(s).toMatchObject({ focus: "x" });
    s = tabTool(s, -1);
    expect(s).toMatchObject({ focus: "name" });
  });

  test("point types x and y then Enter inserts", () => {
    let s = typeChars(startTool("point"), "1.5");
    s = tabTool(s);
    s = typeChars(s, "-2");
    const done = keyTool(s, { key: "Enter" });
    expect(done).toEqual({
      insert: {
        from: "point",
        args: [
          { kind: "num", value: 1.5 },
          { kind: "num", value: -2 },
        ],
      },
    });
  });

  test("point Enter with only x typed stays in session", () => {
    const s = typeChars(startTool("point"), "3");
    expect(keyTool(s, { key: "Enter" })).toBeUndefined();
  });

  test("point Enter on name with both coords still inserts", () => {
    let s = typeChars(startTool("point"), "1");
    s = tabTool(s);
    s = typeChars(s, "2");
    s = tabTool(s);
    s = typeChars(s, "Q");
    expect(keyTool(s, { key: "Enter" })).toEqual({
      insert: {
        from: "point",
        args: [
          { kind: "num", value: 1 },
          { kind: "num", value: 2 },
        ],
        bind: "Q",
      },
    });
  });

  test("point typed x locks that axis on click", () => {
    const s = typeChars(startTool("point"), "1");
    expect(clickTool(s, free(9, 4))).toEqual({
      insert: {
        from: "point",
        args: [
          { kind: "num", value: 1 },
          { kind: "num", value: 4 },
        ],
      },
    });
  });

  test("invalid ident refuses Enter", () => {
    let s = startTool("point");
    s = tabTool(s, -1);
    s = typeChars(s, "1bad");
    expect(keyTool(s, { key: "Enter" })).toBeUndefined();
    expect(keyTool(s, { key: "Enter" }, null, ["ok"])).toBeUndefined();
  });

  test("duplicate bind refuses Enter", () => {
    let s = startTool("line");
    s = tabTool(tabTool(s));
    s = typeChars(s, "ground");
    expect(keyTool(s, { key: "Enter" }, null, ["ground"])).toBeUndefined();
  });

  test("circle tabs center → typed → name", () => {
    const s = startTool("circle");
    expect(s).toMatchObject({ focus: "center" });
    expect(tabTool(s)).toMatchObject({ focus: "typed" });
    expect(tabTool(tabTool(s))).toMatchObject({ focus: "name" });
  });

  test("circle types a named center then a radius and Enter inserts", () => {
    const scope = pointScope({ bind: "A", x: 0, y: 0 });
    let s = typeChars(startTool("circle"), "A");
    s = tabTool(s);
    s = typeChars(s, "2.5");
    expect(keyTool(s, { key: "Enter" }, null, scope)).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "num", value: 2.5 },
        ],
      },
    });
  });

  test("circle unknown point ident is invalid and refuses Enter", () => {
    const s = typeChars(startTool("circle"), "Z");
    expect(previewOf(s, null, pointScope({ bind: "A", x: 0, y: 0 })).draft).toMatchObject({
      id: "center",
      invalid: true,
    });
    expect(
      keyTool(s, { key: "Enter" }, null, pointScope({ bind: "A", x: 0, y: 0 })),
    ).toBeUndefined();
  });

  test("invalid number is flagged and blocks insert", () => {
    const mid = asSession(clickTool(startTool("circle"), named("A", 0, 0)));
    const bad = typeTool(mid, "..");
    expect(previewOf(bad).draft).toMatchObject({ id: "typed", invalid: true });
    expect(keyTool(bad, { key: "Enter" })).toBeUndefined();
    expect(clickTool(bad, free(10, 0))).toEqual({ session: bad });
  });

  test("circle types a radius after Tab, then Enter after the click", () => {
    const typed = typeChars(tabTool(startTool("circle")), "2.5");
    const mid = asSession(clickTool(typed, named("A", 0, 0)));
    expect(keyTool(mid, { key: "Enter" })).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "num", value: 2.5 },
        ],
      },
    });
  });

  test("circle types a radius and Enter commits", () => {
    const mid = asSession(clickTool(startTool("circle"), named("A", 0, 0)));
    const done = keyTool(typeChars(mid, "2.5"), { key: "Enter" });
    expect(done).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "num", value: 2.5 },
        ],
      },
    });
  });

  test("circle typed radius wins over a paper click", () => {
    const mid = typeChars(asSession(clickTool(startTool("circle"), named("A", 0, 0))), "3");
    expect(clickTool(mid, free(10, 0))).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "num", value: 3 },
        ],
      },
    });
  });

  test("circle click on a point still pins dist() even if a radius is typed", () => {
    const mid = typeChars(asSession(clickTool(startTool("circle"), named("A", 0, 0))), "3");
    expect(clickTool(mid, named("P", 2, 0))).toMatchObject({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "call", name: "dist" },
        ],
      },
    });
  });

  test("circle typed slider name commits as a ref", () => {
    const scope = {
      used: ["A", "reach"],
      points: { A: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } },
      carriers: {},
      circles: {},
      regions: {},
      lengths: { reach: 2.5 },
    };
    const mid = asSession(clickTool(startTool("circle"), named("A", 0, 0)));
    expect(keyTool(typeChars(mid, "reach"), { key: "Enter" }, null, scope)).toEqual({
      insert: {
        from: "circle",
        args: [
          { kind: "ref", name: "A" },
          { kind: "ref", name: "reach" },
        ],
      },
    });
  });

  test("invalid slider name is flagged on circle radius", () => {
    const mid = asSession(clickTool(startTool("circle"), named("A", 0, 0)));
    const bad = typeTool(mid, "nope");
    expect(
      previewOf(bad, null, {
        used: ["A"],
        points: { A: { expr: { kind: "ref", name: "A" }, at: { x: 0, y: 0 } } },
        carriers: {},
        circles: {},
        regions: {},
        lengths: { reach: 1 },
      }).draft,
    ).toMatchObject({ id: "typed", invalid: true });
  });

  test("circle Enter on name without a radius retargets to typed", () => {
    const mid = asSession(clickTool(startTool("circle"), named("A", 0, 0)));
    const naming = tabTool(mid);
    expect(naming).toMatchObject({ focus: "name" });
    expect(asSession(keyTool(naming, { key: "Enter" }))).toMatchObject({ focus: "typed" });
  });

  test("line types two point names and Enter inserts", () => {
    const scope = pointScope({ bind: "A", x: 0, y: 0 }, { bind: "P", x: 2, y: 0 });
    let s = typeChars(startTool("line"), "A");
    s = tabTool(s);
    s = typeChars(s, "P");
    expect(keyTool(s, { key: "Enter" }, null, scope)).toEqual({
      insert: {
        from: "line",
        args: [
          { kind: "ref", name: "A" },
          { kind: "ref", name: "P" },
        ],
      },
    });
  });

  test("line Enter with only the first point does not insert", () => {
    expect(keyTool(startTool("line"), { key: "Enter" })).toBeUndefined();
    const mid = asSession(clickTool(startTool("line"), named("A", 0, 0)));
    expect(mid).toMatchObject({ focus: "b" });
    expect(keyTool(mid, { key: "Enter" })).toBeUndefined();
  });

  test("parallel line types a distance and Enter commits", () => {
    const ground = { kind: "line" as const, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    const mid = asSession(
      clickTool(startTool("parallelLine"), {
        world: { x: 1, y: 0 },
        point: { kind: "free", at: { x: 1, y: 0 } },
        carrier: { bind: "ground", geom: ground },
      }),
    );
    expect(mid).toMatchObject({ verb: "parallelLine", focus: "typed" });
    expect(keyTool(typeChars(mid, "-0.5"), { key: "Enter" })).toEqual({
      insert: {
        from: "parallelLine",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "num", value: -0.5 },
        ],
      },
    });
  });

  test("parallel line typed slider name commits as a ref", () => {
    const ground = { kind: "line" as const, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    const scope = {
      used: ["ground", "reach"],
      points: {},
      carriers: { ground: { expr: { kind: "ref", name: "ground" }, geom: ground } },
      circles: {},
      regions: {},
      lengths: { reach: 1.25 },
    };
    const mid = asSession(
      clickTool(startTool("parallelLine"), {
        world: { x: 1, y: 0 },
        point: { kind: "free", at: { x: 1, y: 0 } },
        carrier: { bind: "ground", geom: ground },
      }),
    );
    expect(keyTool(typeChars(mid, "reach"), { key: "Enter" }, null, scope)).toEqual({
      insert: {
        from: "parallelLine",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "ref", name: "reach" },
        ],
      },
    });
  });

  test("point typed slider name commits as a ref", () => {
    const scope = {
      used: ["reach"],
      points: {},
      carriers: {},
      circles: {},
      regions: {},
      lengths: { reach: 3 },
    };
    const mid = typeChars(startTool("point"), "reach");
    const y = tabTool(mid);
    expect(keyTool(typeChars(y, "reach"), { key: "Enter" }, null, scope)).toEqual({
      insert: {
        from: "point",
        args: [
          { kind: "ref", name: "reach" },
          { kind: "ref", name: "reach" },
        ],
      },
    });
  });

  test("perpendicular line types a point and Enter commits", () => {
    const ground = { kind: "line" as const, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    const scope = pointScope({ bind: "P", x: 0, y: 2 });
    const mid = asSession(
      clickTool(startTool("perpendicularLine"), {
        world: { x: 1, y: 0 },
        point: { kind: "free", at: { x: 1, y: 0 } },
        carrier: { bind: "ground", geom: ground },
      }),
    );
    expect(mid).toMatchObject({ verb: "perpendicularLine", focus: "through" });
    expect(
      keyTool(typeChars(mid, "P"), { key: "Enter" }, null, {
        ...scope,
        carriers: { ground: { expr: { kind: "ref", name: "ground" }, geom: ground } },
      }),
    ).toEqual({
      insert: {
        from: "perpendicularLine",
        args: [
          { kind: "ref", name: "ground" },
          { kind: "ref", name: "P" },
        ],
      },
    });
  });

  test("ignores modifier chords", () => {
    expect(keyTool(startTool("point"), { key: "a", ctrl: true })).toBeUndefined();
  });
});

describe("inSlot", () => {
  test("marks one focused token and splits it back out", () => {
    const line = `const ${inSlot(true, "p")} = point(${inSlot(false, "x")}, y)`;
    expect(unmarkSlot(line)).toBe("const p = point(x, y)");
    expect(splitSlot(line)).toEqual({ before: "const ", token: "p", after: " = point(x, y)" });
  });
});

describe("no central session switch", () => {
  test("Pane and Palette route without switching on verb", () => {
    for (const file of ["../Pane.tsx", "../Palette.tsx"]) {
      const src = fs.readFileSync(path.join(here, file), "utf8");
      expect(src).not.toMatch(/\.verb\b/);
      expect(src).not.toMatch(/verb ===/);
    }
  });
});
