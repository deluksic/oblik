import { describe, expect, test } from "vitest";

import { parseLiveNum, sameNum } from "./number-field";

describe("parseLiveNum", () => {
  test("accepts integers, decimals, and signed values", () => {
    expect(parseLiveNum("3")).toBe(3);
    expect(parseLiveNum("1.5")).toBe(1.5);
    expect(parseLiveNum("-2.25")).toBe(-2.25);
    expect(parseLiveNum("1.")).toBe(1);
  });

  test("rejects incomplete or non-numeric drafts", () => {
    expect(parseLiveNum("")).toBeUndefined();
    expect(parseLiveNum("-")).toBeUndefined();
    expect(parseLiveNum(".")).toBeUndefined();
    expect(parseLiveNum("-.")).toBeUndefined();
    expect(parseLiveNum("1.2.3")).toBeUndefined();
    expect(parseLiveNum("nope")).toBeUndefined();
  });

  test("enforces min", () => {
    expect(parseLiveNum("-0.1", { min: 0 })).toBeUndefined();
    expect(parseLiveNum("0", { min: 0 })).toBe(0);
  });
});

describe("sameNum", () => {
  test("treats formatNum-equivalent values as equal", () => {
    expect(sameNum(1, 1)).toBe(true);
    expect(sameNum(1.001, 1)).toBe(true);
    expect(sameNum(1.2, 1.3)).toBe(false);
  });
});
