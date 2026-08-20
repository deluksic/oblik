import { line3 } from "@design-scenes/geom";
import { withoutWidgets } from "@design-scenes/euclid2";
import { editPointOnLine3 } from "@design-scenes/euclid3";
import { drawHelicalPair } from "../demo/gear.ts";
import { gearLayout } from "./gear.ts";

export const view = "euclid3" as const;
export const sceneFile = "helix.ts";

let readGears = gearLayout;

if (import.meta.hot) {
  import.meta.hot.accept("./gear.ts", (mod) => {
    if (mod && "gearLayout" in mod) {
      readGears = mod.gearLayout as typeof gearLayout;
    }
  });
}

/**
 * Helical pair — XY from gear.ts with gizmos silenced. This file owns
 * face width (Z glider). Twist comes from Helix ° on the 2D layout;
 * the mate uses the opposite hand.
 */
export function scene() {
  const g = withoutWidgets(() => readGears());
  const mast = line3(
    { x: g.pinion.x, y: g.pinion.y, z: 0 },
    { x: g.pinion.x, y: g.pinion.y, z: 6 },
  );
  const height = Math.max(0.4, editPointOnLine3(mast, 0.28).z);
  return drawHelicalPair(g, height);
}
