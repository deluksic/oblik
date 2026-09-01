import { createRoot } from "solid-js";
import { afterEach, describe, expect, test } from "vitest";

import { createDragHandler } from "./createDragHandler";

type Listener = (event: Event) => void;

function mockDocument() {
  const listeners = new Map<string, Set<{ fn: Listener; capture: boolean }>>();
  const doc = {
    addEventListener(type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | { signal?: AbortSignal; capture?: boolean }) {
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
  globalThis.document = doc as unknown as Document;
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
  currentTarget?: EventTarget | null;
}): PointerEvent {
  let prevented = false;
  const captured: number[] = [];
  const released: number[] = [];
  const target = {
    setPointerCapture(id: number) {
      captured.push(id);
    },
    releasePointerCapture(id: number) {
      released.push(id);
    },
  };
  return {
    button: 0,
    clientX: 0,
    clientY: 0,
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
    ...partial,
  } as unknown as PointerEvent;
}

function withHandler<T extends unknown[] = []>(
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
          onDone(ev) {
            done.push(ev?.clientX);
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

  test("ends the session when a second touch starts", () => {
    const doc = install();
    let finished = 0;
    const { start, dispose } = withHandler(() =>
      createDragHandler({ preventDefault: false }).start(() => ({ onDone() { finished += 1; } })),
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
      createDragHandler({ preventDefault: false }).start(() => ({ onDone() { finished += 1; } })),
    );
    start(pointerEvent({ clientX: 0, clientY: 0 }));
    expect(doc.listenerCount("pointermove")).toBe(1);
    dispose();
    expect(finished).toBe(1);
    expect(doc.listenerCount("pointermove")).toBe(0);
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
