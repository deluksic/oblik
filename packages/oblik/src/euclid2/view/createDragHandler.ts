import { createSignal, onCleanup } from "solid-js";

import type { SceneValue } from "#eval/context";

import type { PointerInput } from "./pointer";

export type DragSession = {
  onPointerMove?: (event: PointerEvent) => void;
  onDone?: (event?: PointerInput | undefined) => void;
};

/** Pointer-session phase. Read `phase()` from JSX. */
export type DragPhase = "not-started" | "down" | "dragging";

export type CreateDragHandlers<T extends SceneValue[] = []> = (
  event: PointerEvent,
  ...args: T
) => DragSession | undefined;

export type DragHandlerOptions = {
  /** Euclidean distance in CSS pixels before `onPointerMove` runs. */
  deadZoneRadius?: number;
  preventDefault?: boolean;
};

export type DragHandler = {
  phase: () => DragPhase;
  start: <T extends SceneValue[]>(
    createHandlers: CreateDragHandlers<T>,
    options?: DragHandlerOptions,
  ) => (event: PointerEvent, ...args: T) => void;
};

function pastDeadZone(
  from: { clientX: number; clientY: number },
  to: { clientX: number; clientY: number },
  radius: number,
): boolean {
  const dx = to.clientX - from.clientX;
  const dy = to.clientY - from.clientY;
  return dx * dx + dy * dy >= radius * radius;
}

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
      let moved = false;

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
        onDone?.(pointer);
      }

      function onPointerMove_(event: PointerEvent) {
        if (preventDefault) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        if (moved || pastDeadZone(initEvent, event, deadZoneRadius)) {
          if (!moved) setPhase("dragging");
          moved = true;
          onPointerMove?.(event);
        }
      }

      function preventClickIfMoved(event: Event) {
        if (moved && preventDefault) {
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
