import { describe, expect, test } from "vitest";

import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./resizable";

describe("clampSidebarWidth", () => {
  test("keeps in-range widths", () => {
    expect(clampSidebarWidth(400)).toBe(400);
  });

  test("clamps below the minimum", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH);
  });

  test("clamps above the maximum", () => {
    expect(clampSidebarWidth(100000)).toBe(SIDEBAR_MAX_WIDTH);
  });

  test("clamps exactly at the bounds", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH);
  });

  test("non-finite widths fall back to the default", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
