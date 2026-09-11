/** A point in client (viewport) coordinates. */
export type ClientPoint = { clientX: number; clientY: number };

/**
 * The latched facts a gesture accumulates about the pointer, in one place.
 *
 * Both answers latch on first crossing and never clear. That is the point: a
 * gesture that returns to where it started is still a gesture, and the position
 * the pointer happens to be at says nothing about the trip it took. A
 * press-to-release distance test cannot see a round trip (identical endpoints),
 * and a per-event distance test cannot see travel that happened between events.
 *
 * The two are different questions and take different radii:
 * - `moved` — has the pointer left its press point far enough to drive the
 *   gesture? The dead zone, which is the jitter guard.
 * - `dragged` — has it ever travelled far enough to stop being a click? The
 *   click tolerance, which is coarser on purpose: a pan starts moving after
 *   ~1px, while a press that stays within ~4px should still select what it
 *   landed on.
 *
 * `createDragHandler` owns one for each of its sessions; a view that drives its
 * own pointer events (the slider dock, whose drags live on a DOM node) keeps
 * one itself, so both run the same rule.
 */
export class DragTracker {
  private readonly down: ClientPoint;
  private readonly threshold: number;
  private draggedYet = false;
  private movedYet = false;

  constructor(down: ClientPoint, threshold: number) {
    this.down = { clientX: down.clientX, clientY: down.clientY };
    this.threshold = threshold;
  }

  private beyond(point: ClientPoint, radius: number): boolean {
    const dx = point.clientX - this.down.clientX;
    const dy = point.clientY - this.down.clientY;
    return dx * dx + dy * dy >= radius * radius;
  }

  /** Record a point the pointer passed through, for `dragged`. */
  update(point: ClientPoint): void {
    if (!this.draggedYet && this.beyond(point, this.threshold)) this.draggedYet = true;
  }

  /** Whether the pointer has left its press point by `radius`, for driving the
   * gesture. Latched, so it never reports false again once the gesture has
   * started — that is what keeps moves flowing when the pointer heads home. */
  moved(point: ClientPoint, radius: number): boolean {
    if (!this.movedYet && this.beyond(point, radius)) this.movedYet = true;
    return this.movedYet;
  }

  /** Whether the pointer ever left the press point by the click tolerance. */
  dragged(): boolean {
    return this.draggedYet;
  }
}
