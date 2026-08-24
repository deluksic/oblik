import type { LineDash } from "./types";
import { DEFAULT_LINE_STYLE } from "./types";

const DASH_BASE: Record<LineDash, readonly number[]> = {
  solid: [],
  dashed: [8, 6],
  dotted: [2.5, 4],
};

/** Canvas dash segments at {@link DEFAULT_LINE_STYLE.width}; gap grows faster on wide strokes. */
export function dashPattern(dash: LineDash | undefined, width = DEFAULT_LINE_STYLE.width ?? 1.5): number[] {
  const base = DASH_BASE[dash ?? "solid"];
  if (base.length === 0) return [];
  const ref = DEFAULT_LINE_STYLE.width ?? 1.5;
  if (Math.abs(width - ref) < 1e-6) return [...base];

  const scale = width / ref;
  const gapBoost = scale > 1 ? scale : 1;
  return base.map((seg, i) => {
    const scaled = seg * scale;
    return i % 2 === 1 ? scaled * gapBoost : scaled;
  });
}
