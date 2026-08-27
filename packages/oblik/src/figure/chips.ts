import { cloneStyle, type FigureStyle } from "../eval/paint";
import type { Expr } from "../source/expr";

/** Brush settings for this slice — not a `style()` UI. */
export const BRUSH_LOOK: FigureStyle = cloneStyle({
  stroke: "#1c1917",
  width: 1.35,
});

export function styleExpr(s: FigureStyle): Expr {
  const props: Record<string, Expr> = {};
  if (s.stroke) props.stroke = { kind: "str", value: s.stroke };
  if (s.fill != null) props.fill = { kind: "str", value: s.fill };
  if (s.width != null) props.width = { kind: "num", value: s.width };
  if (s.dash) props.dash = { kind: "array", items: s.dash.map((n) => ({ kind: "num", value: n })) };
  if (s.point) props.point = { kind: "str", value: s.point };
  return { kind: "call", name: "style", args: [{ kind: "props", props }] };
}
