import { withoutWidgets } from "@design-scenes/euclid2";
import { pointOnSegment3 } from "@design-scenes/euclid3";
import { segment3 } from "@design-scenes/geom";

import { drawHelicalPair } from "../demo/gear";
import { gearLayout } from "./gear.scene";

export const title = "Helix 3D";
export const view = "euclid3" as const;
export const sceneFile = "helix.scene.ts";
export const camera3 = {
  position: [18, -24, 13],
  target: [0.3, 0, 1.15],
};
export const hint = "Section from gear.ts · glider is face width · LMB orbit";

let readGears = gearLayout;

if (import.meta.hot) {
  import.meta.hot.accept("./gear.scene.ts", (mod) => {
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
  const g = withoutWidgets(() => readGears(), "gear");
  const mast = segment3(
    { x: g.pinion.x, y: g.pinion.y, z: 0 },
    { x: g.pinion.x, y: g.pinion.y, z: 6 },
  );
  const height = Math.max(0.4, pointOnSegment3(mast, 0.1).z);
  return drawHelicalPair(g, height);
}
