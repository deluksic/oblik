import type { TraceNode } from "#eval/context";
import { isCsg2, isOffsetCsg } from "#geom/csg2";
import { isGlider } from "#geom/gliders";

import { traceKey } from "../pick";

export function isHot(
  node: TraceNode,
  hoverId: string | undefined,
  selectedKey: string | undefined,
): boolean {
  return hoverId === node.id || traceKey(node) === selectedKey;
}

export function isSelected(node: TraceNode, selectedKey: string | undefined): boolean {
  return traceKey(node) === selectedKey;
}

export function isHover(
  node: TraceNode,
  hoverId: string | undefined,
  selectedKey: string | undefined,
): boolean {
  return isHot(node, hoverId, selectedKey) && !isSelected(node, selectedKey);
}

export type ChromeSplit<T> = { rest: T[]; hover: T[]; lifted: T[] };

export type ChromePass<T> = { items: T[]; overlay?: true };

/** True when both lists hold the same object identities in the same order. */
export function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True when hover/select did not move any item between buckets. */
export function chromeSplitEqual<T>(a: ChromeSplit<T>, b: ChromeSplit<T>): boolean {
  return sameList(a.rest, b.rest) && sameList(a.hover, b.hover) && sameList(a.lifted, b.lifted);
}

/** Idle, then hovered, then selected — hover/select paint draws after their overlay. */
export function splitChrome<T>(
  items: readonly T[],
  selected: (item: T) => boolean,
  hover: (item: T) => boolean,
): ChromeSplit<T> {
  const rest: T[] = [];
  const hovered: T[] = [];
  const lifted: T[] = [];
  for (const item of items) {
    if (selected(item)) lifted.push(item);
    else if (hover(item)) hovered.push(item);
    else rest.push(item);
  }
  return { rest, hover: hovered, lifted };
}

/**
 * Draw order for a band. `halos` is false while dragging (paint still lifts).
 * Do not `<For>` over this — each call allocates new pass objects, which
 * remounts every fill. Views paint through `ChromeBand` instead.
 */
export function chromePasses<T>(band: ChromeSplit<T>, halos = true): ChromePass<T>[] {
  if (!halos) {
    return [{ items: band.rest }, { items: band.hover }, { items: band.lifted }];
  }
  return [
    { items: band.rest },
    { items: band.hover, overlay: true },
    { items: band.hover },
    { items: band.lifted, overlay: true },
    { items: band.lifted },
  ];
}

/** Keep original order, then selected items — for drawing a node above same-priority siblings. */
export function liftSelected<T>(
  items: readonly T[],
  selected: (item: T) => boolean,
): { rest: T[]; lifted: T[] } {
  const { rest, lifted } = splitChrome(items, selected, () => false);
  return { rest, lifted };
}

export function isGrabbable(node: TraceNode | undefined): boolean {
  if (!node?.editable) return false;
  if (
    node.kind === "point" ||
    node.kind === "circle" ||
    node.kind === "parallelLine" ||
    isGlider(node.value)
  ) {
    return true;
  }
  return isCsg2(node.value) && isOffsetCsg(node.value);
}

export function hoverNode(
  trace: readonly TraceNode[],
  hoverId: string | undefined,
): TraceNode | undefined {
  if (!hoverId) return undefined;
  return trace.find((n) => n.id === hoverId) ?? undefined;
}
