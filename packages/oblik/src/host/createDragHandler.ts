import { onCleanup } from "solid-js";

export type DragSession = {
  onPointerMove?: (event: PointerEvent) => void;
  onDone?: (event?: PointerEvent) => void;
};

export type CreateDragHandlers = (event: PointerEvent) => DragSession | undefined;

export type DragHandlerOptions = {
  /** Manhattan distance in CSS pixels before `onPointerMove` runs. */
  deadZoneRadius?: number;
  preventDefault?: boolean;
};

type ClientPoint = { clientX: number; clientY: number };

function manhattanDistance(a: ClientPoint, b: ClientPoint): number {
  return Math.abs(a.clientX - b.clientX) + Math.abs(a.clientY - b.clientY);
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

function canCapture(target: EventTarget | null | undefined): target is Element {
  return !!target && typeof (target as Element).setPointerCapture === "function";
}

function captureTarget(event: PointerEvent): Element | null {
  if (canCapture(event.currentTarget)) return event.currentTarget;
  if (canCapture(event.target)) return event.target;
  return null;
}

/**
 * Click-and-drag helper for pointer sessions.
 *
 * Call from a component, then put the returned function on `onPointerDown`.
 * Move/up/cancel listen on `document` so the drag keeps going if the pointer
 * leaves the original node. Unmount or a second touch ends the session.
 */
export function createDragHandler(
  createHandlers: CreateDragHandlers,
  { deadZoneRadius = 0, preventDefault = true }: DragHandlerOptions = {},
): (event: PointerEvent) => void {
  const unmount = new AbortController();
  onCleanup(() => unmount.abort());

  return (initEvent: PointerEvent) => {
    if (initEvent.button !== 0) return;
    const handlers = createHandlers(initEvent);
    if (!handlers) return;

    const cleanup = new AbortController();
    const signal = anyAbort(unmount.signal, cleanup.signal);

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
      const pointer = event && "clientX" in event ? (event as PointerEvent) : undefined;
      onDone?.(pointer);
    }

    function onPointerMove_(event: PointerEvent) {
      if (preventDefault) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (moved || manhattanDistance(initEvent, event) >= deadZoneRadius) {
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
