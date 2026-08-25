import { describe, expect, test } from "vitest";

import {
  findStyleMismatches,
  matchedStyle,
  parseStyleSheet,
  patchStyleSheet,
  styleHasDeviation,
} from "./style";

describe("parseStyleSheet", () => {
  test("reads a kind-tagged circle row", () => {
    const sheet = parseStyleSheet({
      o_drill: { style: { kind: "circle", fill: "#e8876a", hidden: true } },
    });
    expect(sheet.o_drill?.style).toEqual({ kind: "circle", fill: "#e8876a", hidden: true });
  });

  test("rejects P5 channel bags and a type discriminant", () => {
    const sheet = parseStyleSheet({
      o_a: { style: { point: { color: "#fff" }, line: { color: "#000" } } },
      o_b: { style: { kind: "point", point: { color: "#fff" } } },
      o_c: { style: { type: "circle", fill: "#e8876a" } },
    });
    expect(sheet).toEqual({});
  });
});

describe("matchedStyle", () => {
  const sheet = parseStyleSheet({
    o_c2: { style: { kind: "circle", stroke: "#7ec8e3" } },
  });

  test("returns the row when kind matches the node", () => {
    expect(matchedStyle(sheet, "o_c2", "circle")?.stroke).toBe("#7ec8e3");
  });

  test("ignores a row aimed at a different kind", () => {
    expect(matchedStyle(sheet, "o_c2", "point")).toBeUndefined();
  });
});

describe("findStyleMismatches", () => {
  test("warns when the id is a point but the style is a circle", () => {
    const sheet = parseStyleSheet({
      o_c2: { style: { kind: "circle", fill: "#e8876a" } },
    });
    expect(findStyleMismatches(sheet, { o_c2: { kind: "point" } })).toEqual([
      { id: "o_c2", kind: "circle", expected: "point" },
    ]);
  });

  test("warns when the id is missing", () => {
    const sheet = parseStyleSheet({ o_ghost: { style: { kind: "line", hidden: true } } });
    expect(findStyleMismatches(sheet, {})).toEqual([{ id: "o_ghost", kind: "line" }]);
  });
});

describe("patchStyleSheet", () => {
  test("drops a row that is only a kind tag", () => {
    expect(styleHasDeviation({ kind: "line" })).toBe(false);
    expect(patchStyleSheet({ o_g: { style: { kind: "line", hidden: true } } }, "o_g", { kind: "line" })).toEqual(
      {},
    );
  });

  test("writes a hidden line", () => {
    expect(patchStyleSheet({}, "o_g", { kind: "line", hidden: true })).toEqual({
      o_g: { style: { kind: "line", hidden: true } },
    });
  });
});
