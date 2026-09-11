import { createRoot } from "solid-js";
import { afterEach, describe, expect, test } from "vitest";

import type { SceneValue } from "#eval/context";

import { createDragHandler } from "./createDragHandler";

type Listener = (event: Event) => void;

function mockDocument() {
  const listeners = new Map<string, Set<{ fn: Listener; capture: boolean }>>();
  const doc = {
    addEventListener(
      type: string,
      fn: EventListenerOrEventListenerObject,
      opts?: boolean | { signal?: AbortSignal; capture?: boolean },
    ) {
      const capture = typeof opts === "object" ? opts.capture === true : opts === true;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      const listener: Listener = typeof fn === "function" ? fn : (e) => fn.handleEvent(e);
      const entry = { fn: listener, capture };
      set.add(entry);
      const signal = typeof opts === "object" ? opts.signal : undefined;
      signal?.addEventListener("abort", () => set.delete(entry));
    },
    fire(type: string, event: Event) {
      const set = listeners.get(type);
      if (!set) return;
      for (const { fn } of Array.from(set)) fn(event);
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
  const previous = globalThis.document;
  // The mock carries the members the engine touches; the rest of the DOM
  // interface is what a test cannot fake, hence the `Partial` step.
  globalThis.document = doc as Partial<Document> as Document;
  return {
    doc,
    restore() {
      globalThis.document = previous;
    },
  };
}

function pointerEvent(partial: {
  button?: number;
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  currentTarget?: EventTarget | undefined;
}): PointerEvent {
  let prevented = false;
  const captured: number[] = [];
  const released: number[] = [];
  const target = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    setPointerCapture(id: number) {
      captured.push(id);
    },
    releasePointerCapture(id: number) {
      released.push(id);
    },
  };
  const { clientX = 0, clientY = 0, ...own } = partial;
  // Real pointer events keep `clientX`/`clientY` as accessors on the prototype,
  // so a spread of one copies neither. Modelling them as own properties would
  // make this mock more generous than the browser and hide exactly that bug.
  const proto = {
    button: 0,
    clientX,
    clientY,
    pointerId: 1,
    currentTarget: target,
    target,
    preventDefault() {
      prevented = true;
    },
    stopImmediatePropagation() {},
    get defaultPrevented() {
      return prevented;
    },
    captured,
    released,
  };
  return Object.assign(Object.create(proto), own) as PointerEvent;
}

function withHandler<T extends SceneValue[] = []>(
  setup: () => (event: PointerEvent, ...args: T) => void,
): {
  start: (event: PointerEvent, ...args: T) => void;
  dispose: () => void;
} {
  let start!: (event: PointerEvent, ...args: T) => void;
  const dispose = createRoot((d) => {
    start = setup();
    return d;
  });
  return { start, dispose };
}

function refuseNonLeft(): undefined {
  throw new Error("should not run");
}

describe("createDragHandler", () => {
  const mocks: Array<{ restore: () => void }> = [];

  afterEach(() => {
    while (mocks.length > 0) mocks.pop()?.restore();
  });

  function install() {
    const mock = mockDocument();
    mocks.push(mock);
    return mock.doc;
  }

  test("ignores non-left buttons", () => {
    install();
    const { start, dispose } = withHandler(() => createDragHandler().start(refuseNonLeft));
    expect(() => start(pointerEvent({ button: 1 }))).not.toThrow();
    dispose();
  });

  test("does nothing when the factory returns undefined", () => {
    const doc = install();
    const { start, dispose } = withHandler(() => createDragHandler().start(() => undefined));
    start(pointerEvent({ clientX: 10, clientY: 10 }));
    expect(doc.listenerCount("pointermove")).toBe(0);
    dispose();
  });

  test("waits for the dead zone before moving, then finishes on pointerup", () => {
    const doc = install();
    const moves: number[] = [];
    const done: Array<number | undefined> = [];
    const { start, dispose } = withHandler(() =>
      createDragHandler({ deadZoneRadius: 4, preventDefault: false }).start((e) => {
        const x0 = e.clientX;
        return {
          onPointerMove(ev) {
            moves.push(ev.clientX - x0);
          },
          onDone(end) {
            done.push(end?.clientX);
          },
        };
      }),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 2, clientY: 0 }));
    expect(moves).toEqual([]);
    doc.fire("pointermove", pointerEvent({ clientX: 4, clientY: 0 }));
    expect(moves).toEqual([4]);
    doc.fire("pointermove", pointerEvent({ clientX: 9, clientY: 0 }));
    expect(moves).toEqual([4, 9]);
    doc.fire("pointerup", pointerEvent({ clientX: 11, clientY: 0 }));
    expect(done).toEqual([11]);
    expect(doc.listenerCount("pointermove")).toBe(0);
    doc.fire("pointermove", pointerEvent({ clientX: 20, clientY: 0 }));
    expect(moves).toEqual([4, 9]);
    dispose();
  });

  test("reports a release that never left the click tolerance as a click", () => {
    const doc = install();
    const done: Array<{ at: number; dragged: boolean } | undefined> = [];
    const { start, dispose } = withHandler(() =>
      createDragHandler({ deadZoneRadius: 4, preventDefault: false }).start(() => ({
        onDone(end) {
          done.push(end && { at: end.clientX, dragged: end.dragged });
        },
      })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 2, clientY: 0 }));
    doc.fire("pointerup", pointerEvent({ clientX: 3, clientY: 0 }));
    expect(done).toEqual([{ at: 3, dragged: false }]);
    dispose();
  });

  test("keeps the dead zone and the click tolerance independent", () => {
    // A pan starts moving after 1px but should still count as a click out to
    // 4px, so the two thresholds are different questions and take different
    // values: at 2px this gesture has already panned and is still a click.
    const doc = install();
    const moves: number[] = [];
    const done: boolean[] = [];
    const { start, dispose } = withHandler(() =>
      createDragHandler({
        deadZoneRadius: 1,
        clickTolerance: 4,
        preventDefault: false,
      }).start(() => ({
        onPointerMove(ev) {
          moves.push(ev.clientX);
        },
        onDone(end) {
          if (end) done.push(end.dragged);
        },
      })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 2, clientY: 0 }));
    expect(moves).toEqual([2]);
    doc.fire("pointerup", pointerEvent({ clientX: 2, clientY: 0 }));
    expect(done).toEqual([false]);
    dispose();
  });

  test("still reports a drag that returns to its press point as dragged", () => {
    // The bug this contract exists for: the release lands exactly where the
    // press was, so any press-to-release distance test would call it a click.
    const doc = install();
    const done: Array<{ at: number; dragged: boolean } | undefined> = [];
    const { start, dispose } = withHandler(() =>
      createDragHandler({ deadZoneRadius: 4, preventDefault: false }).start(() => ({
        onDone(end) {
          done.push(end && { at: end.clientX, dragged: end.dragged });
        },
      })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 40, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 1, clientY: 0 }));
    doc.fire("pointerup", pointerEvent({ clientX: 0, clientY: 0 }));
    expect(done).toEqual([{ at: 0, dragged: true }]);
    dispose();
  });

  test("remembers travel that happened between move events", () => {
    // A pointer can leave the dead zone and be back inside it by the next
    // event, so the latch cannot be re-derived from the current position.
    const doc = install();
    const done: Array<boolean | undefined> = [];
    const { start, dispose } = withHandler(() =>
      createDragHandler({ deadZoneRadius: 4, preventDefault: false }).start(() => ({
        onDone(end) {
          done.push(end?.dragged);
        },
      })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 60, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("pointerup", pointerEvent({ clientX: 0, clientY: 0 }));
    expect(done).toEqual([true]);
    dispose();
  });

  test("hands over usable coordinates even though they are prototype getters", () => {
    // Guards the shape of `DragEnd`: it must carry the two coordinates by
    // value. Spreading the event instead drops them (they are accessors on
    // MouseEvent's prototype), which the types cannot see — `{ ...event }` is
    // structurally typed as the event — so the failure surfaces much later as
    // NaN in a value. Assert the precondition too, so this test cannot quietly
    // stop exercising it.
    const event = pointerEvent({ clientX: 12, clientY: 34 });
    expect(Object.prototype.hasOwnProperty.call(event, "clientX")).toBe(false);
    expect({ ...event }).not.toHaveProperty("clientX");

    const doc = install();
    const done: Array<{ x: number; y: number } | undefined> = [];
    const { start, dispose } = withHandler(() =>
      createDragHandler({ deadZoneRadius: 4, preventDefault: false }).start(() => ({
        onDone(end) {
          done.push(end && { x: end.clientX, y: end.clientY });
        },
      })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 40, clientY: 0 }));
    doc.fire("pointerup", pointerEvent({ clientX: 12, clientY: 34 }));
    expect(done).toEqual([{ x: 12, y: 34 }]);
    dispose();
  });

  test("keeps forwarding moves after the pointer comes back near the press point", () => {
    // The dead zone gates only the start. Once the gesture is moving, every
    // move must reach the session — otherwise the thing being dragged freezes
    // at the dead-zone edge and can never be returned to where it started.
    const doc = install();
    const moves: number[] = [];
    const { start, dispose } = withHandler(() =>
      createDragHandler({ deadZoneRadius: 4, preventDefault: false }).start(() => ({
        onPointerMove(ev) {
          moves.push(ev.clientX);
        },
      })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 10, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 3, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 1, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 0, clientY: 0 }));
    expect(moves).toEqual([10, 3, 1, 0]);
    dispose();
  });

  test("ends the session when a second touch starts", () => {
    const doc = install();
    let finished = 0;
    const { start, dispose } = withHandler(() =>
      createDragHandler({ preventDefault: false }).start(() => ({
        onDone() {
          finished += 1;
        },
      })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("touchstart", { touches: { length: 2 } } as TouchEvent);
    expect(finished).toBe(1);
    expect(doc.listenerCount("pointermove")).toBe(0);
    dispose();
  });

  test("aborts on unmount", () => {
    const doc = install();
    let finished = 0;
    const { start, dispose } = withHandler(() =>
      createDragHandler({ preventDefault: false }).start(() => ({
        onDone() {
          finished += 1;
        },
      })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    expect(doc.listenerCount("pointermove")).toBe(1);
    dispose();
    expect(finished).toBe(1);
    expect(doc.listenerCount("pointermove")).toBe(0);
  });

  test("finishes exactly once, whether by unmount or by release", () => {
    // The abort that ends an unmounted session deliberately re-enters `finish`,
    // and a real pointerup can also arrive in the same turn. `onDone` is the
    // commit path for a drag, so running it twice would write the value twice.
    const doc = install();
    const done: Array<{ x: number } | undefined> = [];
    const { start, dispose } = withHandler(() =>
      createDragHandler({ deadZoneRadius: 1, preventDefault: false }).start(() => ({
        onDone(end) {
          done.push(end && { x: end.clientX });
        },
      })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    doc.fire("pointermove", pointerEvent({ clientX: 10, clientY: 0 }));
    doc.fire("pointerup", pointerEvent({ clientX: 10, clientY: 0 }));
    doc.fire("pointerup", pointerEvent({ clientX: 10, clientY: 0 }));
    expect(done).toEqual([{ x: 10 }]);

    done.length = 0;
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    dispose();
    doc.fire("pointerup", pointerEvent({ clientX: 3, clientY: 3 }));
    expect(done).toEqual([undefined]);
  });

  test("forwards start arguments into the session factory", () => {
    install();
    let received: { id: string } | undefined;
    const { start, dispose } = withHandler<[{ id: string }]>(() =>
      createDragHandler({ preventDefault: false }).start((_e, node: { id: string }) => {
        received = node;
        return {};
      }),
    );
    const hit = { id: "p0" };
    start(pointerEvent({ clientX: 0, clientY: 0 }), hit);
    expect(received).toBe(hit);
    dispose();
  });

  test("exposes not-started, down, and dragging on phase()", () => {
    const doc = install();
    let phase!: () => string;
    const { start, dispose } = withHandler(() => {
      const drag = createDragHandler({ deadZoneRadius: 4, preventDefault: false });
      phase = drag.phase;
      return drag.start(() => ({ onPointerMove() {}, onDone() {} }));
    });
    expect(phase()).toBe("not-started");
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    expect(phase()).toBe("down");
    doc.fire("pointermove", pointerEvent({ clientX: 2, clientY: 0 }));
    expect(phase()).toBe("down");
    doc.fire("pointermove", pointerEvent({ clientX: 4, clientY: 0 }));
    expect(phase()).toBe("dragging");
    doc.fire("pointerup", pointerEvent({ clientX: 4, clientY: 0 }));
    expect(phase()).toBe("not-started");
    dispose();
  });
});
