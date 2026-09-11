import { createSignal, onCleanup } from "solid-js";

import type { SceneValue } from "#eval/context";

import { DragTracker } from "./dragTracker";
import type { PointerInput } from "./pointer";

export type DragSession = {
  onPointerMove?: (event: PointerEvent) => void;
  /**
   * End of the gesture. `dragged` is the handler's click-vs-drag verdict —
   * see `DragEnd`.
   */
  onDone?: (end?: DragEnd) => void;
};

/**
 * What a finished gesture was. `pointer` is the release event when there is
 * one; `dragged` is false only when the pointer never left the press point by
 * the click tolerance, which makes the gesture a click.
 *
 * Exists so callers never re-derive "was this a click?" from the release
 * coordinates: a drag that returns to where it started has identical endpoints,
 * so any before/after distance test calls it a click. Only the handler sees
 * every move, so only the handler can answer this.
 */
export type DragEnd = PointerInput & {
  dragged: boolean;
};

/** Pointer-session phase. Read `phase()` from JSX. */
export type DragPhase = "not-started" | "down" | "dragging";

export type CreateDragHandlers<T extends SceneValue[] = []> = (
  event: PointerEvent,
  ...args: T
) => DragSession | undefined;

export type DragHandlerOptions = {
  /**
   * Euclidean distance in CSS pixels before `onPointerMove` runs — how far the
   * gesture travels before it starts moving anything. This is the jitter
   * guard, not the click test.
   */
  deadZoneRadius?: number;
  /**
   * Euclidean distance in CSS pixels the pointer may ever travel before the
   * gesture stops counting as a click (see `DragEnd.dragged`). Defaults to
   * `deadZoneRadius`.
   *
   * Deliberately separate from the dead zone: a pan wants to start moving
   * after ~1px, while a press that stays within ~4px should still select
   * whatever it landed on.
   */
  clickTolerance?: number;
  preventDefault?: boolean;
};

export type DragHandler = {
  phase: () => DragPhase;
  start: <T extends SceneValue[]>(
    createHandlers: CreateDragHandlers<T>,
    options?: DragHandlerOptions,
  ) => (event: PointerEvent, ...args: T) => void;
};

function anyAbort(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const both = new AbortController();
  const abort = () => both.abort();
  if (a.aborted || b.aborted) {
    abort();
    return both.signal;
  }
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return both.signal;
}

function canCapture(target: EventTarget | undefined): target is Element {
  return !!target && typeof Reflect.get(target, "setPointerCapture") === "function";
}

/**
 * A DOM event carrying pointer coordinates. `finish` may be handed any event —
 * the up target, or a cancel — so the coordinates are checked rather than
 * assumed, which is also what keeps the pointer type out of the session API.
 */
function isPointerInput(event: Event | undefined): event is Event & PointerInput {
  return (
    !!event &&
    typeof Reflect.get(event, "clientX") === "number" &&
    typeof Reflect.get(event, "clientY") === "number"
  );
}

function captureTarget(event: PointerEvent): Element | undefined {
  // DOM event targets are typed `EventTarget | null`; map the platform `null`
  // to `undefined` at the boundary.
  const current = event.currentTarget ?? undefined;
  if (canCapture(current)) return current;
  const direct = event.target ?? undefined;
  if (canCapture(direct)) return direct;
  return undefined;
}

/**
 * Call once per view. `phase` is for JSX; `start` registers a named gesture.
 *
 * Move/up/cancel listen on `document` so the drag keeps going if the pointer
 * leaves the original node. Unmount or a second touch ends the session.
 */
export function createDragHandler(defaults: DragHandlerOptions = {}): DragHandler {
  const [phase, setPhase] = createSignal<DragPhase>("not-started");
  const unmount = new AbortController();
  onCleanup(() => unmount.abort());

  function start<T extends SceneValue[]>(
    createHandlers: CreateDragHandlers<T>,
    options?: DragHandlerOptions,
  ): (event: PointerEvent, ...args: T) => void {
    const deadZoneRadius = options?.deadZoneRadius ?? defaults.deadZoneRadius ?? 0;
    const clickTolerance =
      options?.clickTolerance ?? defaults.clickTolerance ?? deadZoneRadius;
    const preventDefault = options?.preventDefault ?? defaults.preventDefault ?? true;

    return (initEvent: PointerEvent, ...args: T) => {
      if (initEvent.button !== 0) return;
      const handlers = createHandlers(initEvent, ...args);
      if (!handlers) return;

      const cleanup = new AbortController();
      const signal = anyAbort(unmount.signal, cleanup.signal);
      setPhase("down");

      if (preventDefault) {
        initEvent.preventDefault();
        initEvent.stopImmediatePropagation();
      }

      const captured = captureTarget(initEvent);
      captured?.setPointerCapture(initEvent.pointerId);

      const { onPointerMove, onDone } = handlers;
      // The tracker owns both latches: `dragged` answers the click-vs-drag
      // question for `onDone`, `moved` gates whether moves are forwarded. The
      // gate must latch — a per-event distance test would stop forwarding moves
      // as soon as the pointer came back near the press point, freezing the
      // thing being dragged at the dead-zone edge so it could never get home.
      const tracker = new DragTracker(initEvent, clickTolerance);

      function finish(event?: Event) {
        if (cleanup.signal.aborted) return;
        cleanup.abort();
        event?.preventDefault();
        event?.stopImmediatePropagation();
        if (captured && typeof captured.releasePointerCapture === "function") {
          try {
            captured.releasePointerCapture(initEvent.pointerId);
          } catch {
            /* already released */
          }
        }
        const pointer = isPointerInput(event) ? event : undefined;
        setPhase("not-started");
        // Built property by property, never spread: `clientX`/`clientY` are
        // accessors on MouseEvent's prototype, so a spread of a real
        // PointerEvent copies nothing and yields `undefined` coordinates that
        // only blow up later, as NaN in a value. Copying the two coordinates
        // reads the getters, and the type stops being a promise the data
        // cannot keep.
        onDone?.(
          pointer && {
            clientX: pointer.clientX,
            clientY: pointer.clientY,
            dragged: tracker.dragged(),
          },
        );
      }

      function onPointerMove_(event: PointerEvent) {
        if (preventDefault) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        tracker.update(event);
        if (tracker.moved(event, deadZoneRadius)) {
          if (phase() !== "dragging") setPhase("dragging");
          onPointerMove?.(event);
        }
      }

      function preventClickIfMoved(event: Event) {
        if (tracker.dragged() && preventDefault) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }

      function onTouchStart(event: TouchEvent) {
        if (event.touches.length >= 2) finish();
      }

      document.addEventListener("pointermove", onPointerMove_, { signal });
      document.addEventListener("pointerup", finish, { signal });
      document.addEventListener("pointercancel", finish, { signal });
      document.addEventListener("touchstart", onTouchStart, { signal });
      document.addEventListener("click", preventClickIfMoved, { capture: true, signal });
      signal.addEventListener("abort", () => finish());
    };
  }

  return { phase, start };
}
