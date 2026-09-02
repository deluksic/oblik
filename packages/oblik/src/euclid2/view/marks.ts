import type { TraceNode } from "@/eval/context";
import { isCsg2, isOffsetCsg } from "@/geom/csg2";
import { isGlider } from "@/geom/gliders";

import { traceKey } from "../pick";

export function isHot(
  node: TraceNode,
  hoverId: string | null | undefined,
  selectedKey: string | null | undefined,
): boolean {
  return hoverId === node.id || traceKey(node) === selectedKey;
}

export function isSelected(node: TraceNode, selectedKey: string | null | undefined): boolean {
  return traceKey(node) === selectedKey;
}

export function isHover(
  node: TraceNode,
  hoverId: string | null | undefined,
  selectedKey: string | null | undefined,
): boolean {
  return isHot(node, hoverId, selectedKey) && !isSelected(node, selectedKey);
}

export type ChromeSplit<T> = { rest: T[]; hover: T[]; lifted: T[] };

export type ChromePass<T> = { items: T[]; overlay?: true };

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

/** Draw order for a band. `halos` is false while dragging (paint still lifts). */
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

export function isGrabbable(node: TraceNode | null | undefined): boolean {
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
  hoverId: string | null | undefined,
): TraceNode | null {
  if (!hoverId) return null;
  return trace.find((n) => n.id === hoverId) ?? null;
}
