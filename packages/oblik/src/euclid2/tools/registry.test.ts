import { describe, expect, test } from "vitest";

import { arg, defineTool, registeredSpecs, registeredToolById, registeredTools } from "./registry";

function mirror(x: number): number {
  return x;
}

function sq(x: number): number {
  return x * x;
}

function circleish(x: number): number {
  return x;
}

function thingy(center: number, r: number): number {
  return r;
}

describe("defineTool registry", () => {
  test("registers with defaults and returns the fn unchanged", () => {
    const out = defineTool(mirror, {
      title: "Mirror",
      hint: "reflects",
      prefix: "m",
      args: [arg.number("x", { def: 1 })],
      module: "/src/m.ts",
    });
    expect(out).toBe(mirror);
    const specs = registeredSpecs();
    const spec = specs.find((s) => s.id === "mirror");
    expect(spec?.title).toBe("Mirror");
    expect(spec?.prefix).toBe("m");
    const reg = registeredTools().find((r) => r.name === "mirror");
    expect(reg?.module).toBe("/src/m.ts");
    expect(registeredToolById("mirror")).toBeDefined();
  });

  test("names default to fn.name", () => {
    defineTool(sq, { title: "Sq", prefix: "sq", args: [], module: "/src/sq.ts" });
    expect(registeredSpecs().some((s) => s.id === "sq")).toBe(true);
  });

  test("throws for anonymous fns without a def.name", () => {
    expect(() =>
      defineTool((x: number) => x, {
        title: "anon",
        prefix: "an",
        args: [arg.number("x")],
        module: "/src/anon.ts",
      }),
    ).toThrow(/needs a name/);
  });

  test("rejects built-in ids and bad prefixes", () => {
    expect(() =>
      defineTool(circleish, {
        name: "circle",
        title: "Circle-ish",
        prefix: "c",
        args: [arg.number("x")],
        module: "/src/c.ts",
      }),
    ).toThrow(/built-in/);
    expect(() =>
      defineTool(circleish, {
        title: "Circle-ish",
        prefix: "c c",
        args: [],
        module: "/src/c.ts",
      }),
    ).toThrow(/prefix/);
  });

  test("validates anchors", () => {
    expect(() =>
      defineTool(thingy, {
        title: "Thing",
        prefix: "t",
        args: [arg.number("center"), arg.length("r", { anchor: "center" })],
        module: "/src/t.ts",
      }),
    ).toThrow(/only point\/region args can be anchors/);
    expect(() =>
      defineTool(thingy, {
        title: "Thing",
        prefix: "t",
        args: [arg.length("r", { anchor: "nope" })],
        module: "/src/t.ts",
      }),
    ).toThrow(/unknown arg/);
  });

  test("re-registering a name overwrites", () => {
    const a = defineTool((x: number) => x, {
      name: "dup",
      title: "A",
      prefix: "d",
      args: [],
      module: "/src/a.ts",
    });
    const b = defineTool((x: number) => x, {
      name: "dup",
      title: "B",
      prefix: "d",
      args: [],
      module: "/src/b.ts",
    });
    expect(a).not.toBe(b);
    expect(registeredSpecs().filter((s) => s.id === "dup")).toHaveLength(1);
    expect(registeredSpecs().find((s) => s.id === "dup")?.title).toBe("B");
  });
});
