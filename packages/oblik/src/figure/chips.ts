import { style, type FigureStyle } from "../eval/constructors";
import type { Expr } from "../source/expr";

export type StyleChip = {
  id: string;
  title: string;
  style: FigureStyle;
};

export const FIGURE_CHIPS: readonly StyleChip[] = [
  { id: "ink", title: "Ink", style: style({ stroke: "#1c1917", width: 1.35 }) },
  { id: "heavy", title: "Heavy", style: style({ stroke: "#1c1917", width: 2.2 }) },
  { id: "dash", title: "Dash", style: style({ stroke: "#1c1917", width: 1.05, dash: [5, 3.5] }) },
  { id: "thin", title: "Thin", style: style({ stroke: "#1c1917", width: 0.9 }) },
  { id: "hole", title: "Hole", style: style({ stroke: "#1c1917", width: 1.2, fill: "none" }) },
  { id: "fill", title: "Fill", style: style({ fill: "#efe8d8", stroke: "#1c1917", width: 1.35 }) },
  { id: "point", title: "Point", style: style({ stroke: "#1c1917", width: 1.2, fill: "none", point: "open" }) },
];

export function styleExpr(s: FigureStyle): Expr {
  const props: Record<string, Expr> = {};
  if (s.stroke) props.stroke = { kind: "str", value: s.stroke };
  if (s.fill != null) props.fill = { kind: "str", value: s.fill };
  if (s.width != null) props.width = { kind: "num", value: s.width };
  if (s.dash) props.dash = { kind: "array", items: s.dash.map((n) => ({ kind: "num", value: n })) };
  if (s.point) props.point = { kind: "str", value: s.point };
  return { kind: "call", name: "style", args: [{ kind: "props", props }] };
}

export function filterChips(query: string): StyleChip[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...FIGURE_CHIPS];
  return FIGURE_CHIPS.filter((c) => c.title.toLowerCase().includes(q) || c.id.includes(q));
}
