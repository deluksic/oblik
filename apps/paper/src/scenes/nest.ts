import { withoutWidgets, editNumber } from "@design-scenes/euclid2";
import { drawPlateNest } from "../demo/plate.ts";
import { plateLayout } from "./plate.ts";

export const sceneFile = "nest.ts";

/**
 * Print nest — reuse plateLayout() with gizmos off, instance a grid, and
 * step polar-array count by column so each cell is a real parameter variant.
 */
export function scene() {
  const master = withoutWidgets(() => plateLayout(), "plate");
  const cols = editNumber(3, { label: "Columns", min: 1, max: 4, step: 1 });
  const rows = editNumber(2, { label: "Rows", min: 1, max: 3, step: 1 });
  const gap = editNumber(0.8, { label: "Gap", min: 0.25, max: 2.5, step: 0.05 });
  return drawPlateNest(master, { cols, rows, gap, countStep: 1 });
}
