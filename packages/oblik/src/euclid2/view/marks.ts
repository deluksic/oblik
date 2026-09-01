import type { TraceNode } from "@/eval/context";
import { isGlider } from "@/geom/gliders";
import { traceKey } from "../pick";

export function isHot(node: TraceNode, hoverId: string | null | undefined, selectedKey: string | null | undefined): boolean {
  return hoverId === node.id || traceKey(node) === selectedKey;
}

export function isSelected(node: TraceNode, selectedKey: string | null | undefined): boolean {
  return traceKey(node) === selectedKey;
}

/** Keep original order, then selected items — for drawing a node above same-priority siblings. */
export function liftSelected<T>(items: readonly T[], selected: (item: T) => boolean): { rest: T[]; lifted: T[] } {
  const rest: T[] = [];
  const lifted: T[] = [];
  for (const item of items) (selected(item) ? lifted : rest).push(item);
  return { rest, lifted };
}

export function isGrabbable(node: TraceNode | null | undefined): boolean {
  return (
    !!node?.editable &&
    (node.kind === "point" ||
      node.kind === "circle" ||
      node.kind === "parallelLine" ||
      isGlider(node.value))
  );
}

export function hoverNode(trace: readonly TraceNode[], hoverId: string | null | undefined): TraceNode | null {
  if (!hoverId) return null;
  return trace.find((n) => n.id === hoverId) ?? null;
}
