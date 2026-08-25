import type { TraceNode } from "../../eval/context";
import { traceKey } from "../pick";

export function isHot(node: TraceNode, hoverId: string | null | undefined, selectedKey: string | null | undefined): boolean {
  return hoverId === node.id || traceKey(node) === selectedKey;
}

export function isSelected(node: TraceNode, selectedKey: string | null | undefined): boolean {
  return traceKey(node) === selectedKey;
}
