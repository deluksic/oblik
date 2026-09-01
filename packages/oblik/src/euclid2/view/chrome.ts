export const FIGURE_PAPER_PX = 1;
export const FIGURE_SELECT_PX = 1.5;
export const FIGURE_HOVER_PX = 1;
export const CONSTRUCTION_STROKE_PX = 1.5;

export type ChromeKind = "knockout" | "outline" | "paint";

export type ChromeLayer = {
  kind: ChromeKind;
  width: number;
};

export type ChromeOpts = {
  selected: boolean;
  hover: boolean;
  overlay: boolean;
  knockout: boolean;
};

/** Screen-space stroke widths, back to front. Overlay redraws chrome above later ink. */
export function chromeLayers(paintWidth: number, opts: ChromeOpts): ChromeLayer[] {
  const w = paintWidth > 0 ? paintWidth : 1;
  if (!opts.overlay) return [{ kind: "paint", width: w }];
  if (!opts.selected && !opts.hover) return [];
  const ring = opts.selected ? FIGURE_SELECT_PX : FIGURE_HOVER_PX;
  const layers: ChromeLayer[] = [];
  if (opts.knockout) layers.push({ kind: "knockout", width: w + 2 * FIGURE_PAPER_PX + 2 * ring });
  layers.push({ kind: "outline", width: w + 2 * ring });
  layers.push({ kind: "paint", width: w });
  return layers;
}
