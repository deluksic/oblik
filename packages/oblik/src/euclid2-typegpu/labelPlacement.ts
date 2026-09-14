import type { TraceNode } from "#eval/context";
import { gliderAt, isGlider } from "#geom/gliders";

import { isFiniteTrace } from "../euclid2/pick";

/** SVG `PointMark` draws its `<text>` at `(x + 10, y - 8)` with `font-size: 12`. */
export const LABEL_DX = 10;
export const LABEL_DY = -8;
/**
 * Top of a `font-size: 12px` / `line-height: 1` line box down to its baseline.
 *
 * SVG's `y` is a **baseline**; a label's own box is positioned by its **top**, so
 * the two constants above and this one are the whole of the offset a label sits
 * at — `dx`, and `dy − baseline`. The GPU path hands that pair to the shader as a
 * screen-space offset from the world anchor, which is why there is no longer a
 * function here that folds it into a screen position.
 */
export const LABEL_BASELINE_PX = 10;

type At = { x: number; y: number };

/** The world anchor a bind label hangs off — point and glider nodes only.
 * Mirrors `PointMark`'s `pos` memo in `euclid2/view/Hud.tsx`. */
export function labelAnchor(node: TraceNode): At | undefined {
  const v = node.value;
  if (v.kind === "point") return { x: v.x, y: v.y };
  return isGlider(v) ? gliderAt(v) : undefined;
}

/** Nodes that carry a bind label: drawn point/glider nodes with a source name —
 * the SVG point band's contents, minus the overlay passes (which draw no text). */
export function isBindLabelNode(node: TraceNode): boolean {
  return node.bind !== undefined && isFiniteTrace(node) && labelAnchor(node) !== undefined;
}
