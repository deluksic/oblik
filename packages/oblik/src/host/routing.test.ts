import { describe, expect, test } from "vitest";

import { chromePinsFrom } from "./routing";

describe("chromePinsFrom", () => {
  test("reads hover, select, frame, and pin", () => {
    expect(chromePinsFrom("?scene=chrome-figure&hover=o_a:0&select=o_b:0&frame=1&pin=1")).toEqual({
      hover: "o_a:0",
      select: "o_b:0",
      frame: true,
      pin: true,
    });
  });

  test("defaults to live interaction", () => {
    expect(chromePinsFrom("?scene=chrome-figure")).toEqual({
      hover: null,
      select: null,
      frame: false,
      pin: false,
    });
  });
});
