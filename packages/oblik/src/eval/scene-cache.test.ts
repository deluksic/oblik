import { describe, expect, test } from "vitest";

import { point } from "./constructors";
import { evaluate } from "./evaluate";
import { defineScene } from "./scene";
import { createVisitCaches } from "./scene-cache";

/**
 * A visit's caches have two lifetimes, and this pins both: the visit owns the
 * store (a navigation drops everything), while the scene *module* picks the
 * entry inside it (an HMR re-import replaces the memo without remounting the
 * view, so the camera and any live edit survive the edit that caused it).
 */
describe("visit caches", () => {
  test("every view of one scene module shares the visit's entry", () => {
    const caches = createVisitCaches();
    const scene = { kind: "euclid2", title: "plate" };
    expect(caches(scene)).toBe(caches(scene));
    expect(caches(scene).memo).toBe(caches(scene).memo);
  });

  test("an HMR re-import replaces the entry, in the same visit", () => {
    const caches = createVisitCaches();
    const before = { kind: "euclid2", title: "plate" };
    const reimported = { kind: "euclid2", title: "plate" };
    const first = caches(before).memo;
    expect(caches(reimported).memo).not.toBe(first);
    // The replaced module keeps its own entry: HMR did not disturb the old one.
    expect(caches(before).memo).toBe(first);
  });

  test("a new visit starts cold, even for the same module", () => {
    const scene = { kind: "euclid2", title: "plate" };
    const first = createVisitCaches();
    const warm = first(scene).memo;
    expect(createVisitCaches()(scene).memo).not.toBe(warm);
  });

  test("the memo replays within a visit and not across one", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        point(0, 0, "a");
        point(1, 0, "b");
      },
    });
    const caches = createVisitCaches();
    expect(evaluate(scene, { memo: caches(scene).memo }).stats).toEqual({ built: 2, hits: 0 });
    expect(evaluate(scene, { memo: caches(scene).memo }).stats).toEqual({ built: 0, hits: 2 });
    expect(evaluate(scene, { memo: createVisitCaches()(scene).memo }).stats).toEqual({
      built: 2,
      hits: 0,
    });
  });
});
