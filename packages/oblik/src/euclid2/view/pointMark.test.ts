import { describe, expect, test } from "vitest";

import { EDITABLE_POINT_R, HANDLE_R, POINT_R, pointMarkRadius } from "./pointMark";

describe("pointMarkRadius", () => {
  test("editable points are wider than derived points, but not the grab hit target", () => {
    expect(pointMarkRadius(false)).toBe(POINT_R);
    expect(pointMarkRadius(true)).toBe(EDITABLE_POINT_R);
    expect(EDITABLE_POINT_R).toBeGreaterThan(POINT_R);
    expect(EDITABLE_POINT_R).toBeLessThan(HANDLE_R);
  });
});
