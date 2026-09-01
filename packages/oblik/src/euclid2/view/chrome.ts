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

/** Drawn back to front: outline, knockout (paper gap), paint. Reads inward as paint → gap → ring. */
export function chromeLayers(paintWidth: number, opts: ChromeOpts): ChromeLayer[] {
  const w = paintWidth > 0 ? paintWidth : 1;
  if (!opts.overlay) return [{ kind: "paint", width: w }];
  if (!opts.selected && !opts.hover) return [];
  if (!opts.knockout) return [];
  const ring = opts.selected ? FIGURE_SELECT_PX : FIGURE_HOVER_PX;
  const gap = w + 2 * FIGURE_PAPER_PX;
  return [
    { kind: "outline", width: gap + 2 * ring },
    { kind: "knockout", width: gap },
    { kind: "paint", width: w },
  ];
}
