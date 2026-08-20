import { line3 } from "@design-scenes/geom";
import { withoutWidgets } from "@design-scenes/euclid2";
import { editPointOnLine3 } from "@design-scenes/euclid3";
import { dimpledCylinder } from "../demo/rose-sdf.ts";
import { cylinderLayout } from "./cylinder.ts";

export const view = "sdf" as const;
export const sceneFile = "rose-sdf.ts";

let readLayout = cylinderLayout;

if (import.meta.hot) {
  import.meta.hot.accept("./cylinder.ts", (mod) => {
    if (mod && "cylinderLayout" in mod) {
      readLayout = mod.cylinderLayout as typeof cylinderLayout;
    }
  });
}

/**
 * Field view of the 2D plan. Ring radius and centre Ø come from
 * cylinder.ts with gizmos silenced. This file owns height (Z glider).
 */
export function scene() {
  const layout = withoutWidgets(() => readLayout());
  const mast = line3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 6 });
  const height = Math.max(0.5, editPointOnLine3(mast, 0.52).z);
  return dimpledCylinder({
    radius: layout.radius,
    height,
    ringR: layout.ringR,
    centerR: layout.centerR,
    ringBallR: layout.ringBallR,
  });
}
