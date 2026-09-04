import type { TraceNode } from "./context";
import type { PaintStroke } from "./paint";

function nodeKey(n: TraceNode): string {
  return `${n.id}:${n.occ}`;
}

/** Draw-facing fields: identity, bind, editability, and geom — not stack/inv. */
export function sameDrawNode(a: TraceNode, b: TraceNode): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.occ !== b.occ) return false;
  if (a.kind !== b.kind || a.editable !== b.editable) return false;
  if ((a.bind ?? "") !== (b.bind ?? "")) return false;
  return sameDrawValue(a.value, b.value);
}

export function sameDrawValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object") return Object.is(a, b);
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameDrawValue(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(bo, key)) return false;
    if (!sameDrawValue(ao[key], bo[key])) return false;
  }
  return true;
}

/**
 * Keep previous TraceNode object identity when the drawable payload is unchanged.
 * Solid `<For>` keys by identity by default; reusing nodes lets SVG elements
 * patch attributes instead of remounting, and skips fill/tessellation memos.
 */
export function reuseUnchangedTrace(
  prev: readonly TraceNode[] | undefined,
  next: TraceNode[],
): TraceNode[] {
  if (!prev || prev.length === 0 || next.length === 0) return next;
  const prevByKey = new Map<string, TraceNode>();
  for (const n of prev) {
    const key = nodeKey(n);
    if (!prevByKey.has(key)) prevByKey.set(key, n);
  }
  let reused = 0;
  const out = next.map((n) => {
    const old = prevByKey.get(nodeKey(n));
    if (old && sameDrawNode(old, n)) {
      reused++;
      return old;
    }
    return n;
  });
  if (reused === next.length && reused === prev.length) return prev as TraceNode[];
  return out;
}

/**
 * Copy `inv` (and a non-empty stack) from the previous tape by id:occ.
 * Live-drag evals skip `captureUserStack` and `assignInv`; moved nodes still
 * need last-known provenance so scope chrome does not flicker.
 */
export function carryTraceInv(prev: readonly TraceNode[] | undefined, next: TraceNode[]): void {
  if (!prev || prev.length === 0) return;
  const prevByKey = new Map<string, TraceNode>();
  for (const n of prev) {
    const key = nodeKey(n);
    if (!prevByKey.has(key)) prevByKey.set(key, n);
  }
  for (const n of next) {
    const old = prevByKey.get(nodeKey(n));
    if (!old) continue;
    if (n.stack.length === 0 && old.stack.length > 0) n.stack = old.stack;
    if (!n.inv && old.inv) n.inv = old.inv;
  }
}

export function reusePaintStrokes(
  prev: readonly PaintStroke[] | undefined,
  next: PaintStroke[],
): PaintStroke[] {
  if (!prev || prev.length === 0 || next.length === 0) return next;
  const prevByKey = new Map<string, PaintStroke>();
  for (const s of prev) {
    const key = `${nodeKey(s.paint)}:${nodeKey(s.geom)}`;
    if (!prevByKey.has(key)) prevByKey.set(key, s);
  }
  let reused = 0;
  const out = next.map((s) => {
    const old = prevByKey.get(`${nodeKey(s.paint)}:${nodeKey(s.geom)}`);
    if (old && old.paint === s.paint && old.geom === s.geom && sameDrawValue(old.style, s.style)) {
      reused++;
      return old;
    }
    return s;
  });
  if (reused === next.length && reused === prev.length) return prev as PaintStroke[];
  return out;
}
