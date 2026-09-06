import { describe, expect, test } from "vitest";

import {
  clampSidebarHeight,
  clampSidebarWidth,
  SIDEBAR_DEFAULT_HEIGHT,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_HEIGHT,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_HEIGHT,
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

describe("clampSidebarHeight", () => {
  test("keeps in-range heights", () => {
    expect(clampSidebarHeight(300)).toBe(300);
  });

  test("clamps below the minimum", () => {
    expect(clampSidebarHeight(10)).toBe(SIDEBAR_MIN_HEIGHT);
  });

  test("clamps above the maximum", () => {
    expect(clampSidebarHeight(100000)).toBe(SIDEBAR_MAX_HEIGHT);
  });

  test("clamps exactly at the bounds", () => {
    expect(clampSidebarHeight(SIDEBAR_MIN_HEIGHT)).toBe(SIDEBAR_MIN_HEIGHT);
    expect(clampSidebarHeight(SIDEBAR_MAX_HEIGHT)).toBe(SIDEBAR_MAX_HEIGHT);
  });

  test("non-finite heights fall back to the default", () => {
    expect(clampSidebarHeight(Number.NaN)).toBe(SIDEBAR_DEFAULT_HEIGHT);
    expect(clampSidebarHeight(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_HEIGHT);
  });
});
