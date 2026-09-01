import { describe, expect, test } from "vitest";

import { isLabChromeId, labChrome, resolveChrome } from "./chrome-lab";

describe("labChrome", () => {
  test("reads idle, hover, and selected suffixes", () => {
    expect(labChrome("o_black_idle")).toEqual({ hot: false, selected: false });
    expect(labChrome("o_black_hover")).toEqual({ hot: true, selected: false });
    expect(labChrome("o_black_selected")).toEqual({ hot: true, selected: true });
  });

  test("leaves interactive ids alone", () => {
    expect(labChrome("o_pick_a")).toBeNull();
    expect(labChrome("o_idle_note")).toBeNull();
    expect(isLabChromeId("o_pick_a")).toBe(false);
    expect(isLabChromeId("o_navy_selected")).toBe(true);
  });

  test("forced suffix wins over live hover/select", () => {
    expect(resolveChrome("o_red_idle", true, true)).toEqual({ hot: false, selected: false });
    expect(resolveChrome("o_pick_a", true, false)).toEqual({ hot: true, selected: false });
  });
});
