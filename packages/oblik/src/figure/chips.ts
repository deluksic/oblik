import { cloneStyle, type FigureStyle } from "../eval/paint";
import type { Expr } from "../source/expr";

export const STROKE_COLORS = ["#1c1917", "#c23b22", "#2b7a3e", "#1f5fa8", "#d97706"] as const;

export const FILL_COLORS = ["none", "#f3c5bc", "#cfe8d4", "#c5ddf5", "#f6e2b8"] as const;

export const STROKE_WIDTHS = [1, 2.8, 5.6] as const;

export type LineStyleId = "solid" | "dash" | "dot";

export const LINE_STYLES: readonly LineStyleId[] = ["solid", "dash", "dot"];

const DASH_AT_THIN: Record<Exclude<LineStyleId, "solid">, readonly [number, number]> = {
  dash: [7, 5],
  dot: [1.4, 3.6],
};

export type BrushSettings = {
  stroke: string;
  fill: string;
  width: number;
  line: LineStyleId;
};

export const DEFAULT_BRUSH: BrushSettings = {
  stroke: STROKE_COLORS[0],
  fill: "none",
  width: STROKE_WIDTHS[1],
  line: "solid",
};

function roundDash(n: number): number {
  return Math.round(n * 100) / 100;
}

export function dashForLine(line: LineStyleId, width = DEFAULT_BRUSH.width): readonly number[] | undefined {
  if (line === "solid") return undefined;
  const base = DASH_AT_THIN[line];
  const w = width > 0 ? width : 1;
  return [roundDash(base[0] * w), roundDash(base[1] * w)];
}

export function takesFill(kind: string): boolean {
  return kind === "profile" || kind === "circle";
}

export function figureStyleFromBrush(b: BrushSettings, closed: boolean): FigureStyle {
  const dash = dashForLine(b.line, b.width);
  return cloneStyle({
    stroke: b.stroke,
    width: b.width,
    ...(dash ? { dash } : {}),
    ...(closed ? { fill: b.fill } : {}),
  });
}

/** Same look paint writes — fill only for profiles and circles. Points and lines are stroke. */
export function lookFromBrush(b: BrushSettings, kind: string): FigureStyle {
  return figureStyleFromBrush(b, takesFill(kind));
}

export const BRUSH_LOOK: FigureStyle = figureStyleFromBrush(DEFAULT_BRUSH, false);

export function lookExpr(s: FigureStyle): Expr {
  const props: Record<string, Expr> = {};
  if (s.stroke) props.stroke = { kind: "str", value: s.stroke };
  if (s.fill != null) props.fill = { kind: "str", value: s.fill };
  if (s.width != null) props.width = { kind: "num", value: s.width };
  if (s.dash) props.dash = { kind: "array", items: s.dash.map((n) => ({ kind: "num", value: n })) };
  if (s.point) props.point = { kind: "str", value: s.point };
  return { kind: "props", props };
}
