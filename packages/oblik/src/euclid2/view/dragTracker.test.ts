import { describe, expect, test } from "vitest";

import { DragTracker } from "./dragTracker";

const at = (x: number, y = 0) => ({ clientX: x, clientY: y });

describe("DragTracker", () => {
  test("starts neither moved nor dragged", () => {
    const t = new DragTracker(at(0), 4);
    expect(t.dragged()).toBe(false);
    expect(t.moved(at(0), 1)).toBe(false);
  });

  test("latches dragged from a move at or beyond the tolerance", () => {
    const t = new DragTracker(at(0), 4);
    t.update(at(3));
    expect(t.dragged()).toBe(false);
    t.update(at(4));
    expect(t.dragged()).toBe(true);
  });

  test("keeps dragged latched when the pointer returns to the press point", () => {
    // The whole reason the tracker exists: the endpoints match, so a
    // press-to-release distance test would call this a click.
    const t = new DragTracker(at(0), 4);
    t.update(at(40));
    t.update(at(1));
    t.update(at(0));
    expect(t.dragged()).toBe(true);
  });

  test("latches travel that happened between two events", () => {
    // The pointer left and came back before the next event: only a latch can
    // remember it, since the position alone looks stationary.
    const t = new DragTracker(at(0), 4);
    t.update(at(60));
    t.update(at(0));
    expect(t.dragged()).toBe(true);
  });

  test("keeps moved latched when the pointer returns near the press point", () => {
    // A caller's own dead zone must gate only the start; if `moved` went back
    // to false the caller would stop updating and freeze mid-drag.
    const t = new DragTracker(at(0), 4);
    expect(t.moved(at(10), 1)).toBe(true);
    expect(t.moved(at(1), 1)).toBe(true);
    expect(t.moved(at(0), 1)).toBe(true);
  });

  test("measures each threshold from the press point, not the last point", () => {
    const t = new DragTracker(at(10), 4);
    expect(t.moved(at(11), 1)).toBe(true);
    expect(t.dragged()).toBe(false);
    t.update(at(13));
    expect(t.dragged()).toBe(false);
    t.update(at(14));
    expect(t.dragged()).toBe(true);
  });

  test("keeps the two latches independent", () => {
    // Moving (dead zone, 1px) must not by itself decide the click question
    // (tolerance, 4px), or a pan would stop selecting as soon as it twitched.
    const t = new DragTracker(at(0), 4);
    expect(t.moved(at(2), 1)).toBe(true);
    expect(t.dragged()).toBe(false);
  });
});
