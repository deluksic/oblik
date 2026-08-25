import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { clickTool, keyTool, startTool, tabTool } from "../tool";
import type { PlaceHit, ToolSession, ToolStep } from "./types";

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
    s = typeChars(s, "ground");
    expect(keyTool(s, { key: "Enter" }, null, ["ground"])).toBeUndefined();
  });

  test("circle tabs typed ↔ name before the center", () => {
    const s = startTool("circle");
    expect(s).toMatchObject({ focus: "typed" });
    expect(tabTool(s)).toMatchObject({ focus: "name" });
    expect(tabTool(tabTool(s))).toMatchObject({ focus: "typed" });
  });

  test("circle types a radius before the center, then Enter after the click", () => {
    const typed = typeChars(startTool("circle"), "2.5");
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

  test("circle Enter on name without a radius retargets to typed", () => {
    const mid = asSession(clickTool(startTool("circle"), named("A", 0, 0)));
    const naming = tabTool(mid);
    expect(naming).toMatchObject({ focus: "name" });
    expect(asSession(keyTool(naming, { key: "Enter" }))).toMatchObject({ focus: "typed" });
  });

  test("line Enter does not insert; two clicks still required", () => {
    expect(keyTool(startTool("line"), { key: "Enter" })).toBeUndefined();
    const mid = asSession(clickTool(startTool("line"), named("A", 0, 0)));
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

  test("ignores modifier chords", () => {
    expect(keyTool(startTool("point"), { key: "a", ctrl: true })).toBeUndefined();
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
