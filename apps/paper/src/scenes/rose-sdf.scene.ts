import { withoutWidgets } from "@design-scenes/euclid2";
import { editPointOnSegment3 } from "@design-scenes/euclid3";
import { line3 } from "@design-scenes/geom";
import { difference, sweep2, union, unionAll } from "@design-scenes/sdf";

import { pack7 } from "../demo/cylinder";
import { profileSdf } from "../demo/profile";
import { packedCylinderCores, quatrefoilBallsPack } from "../demo/rose-sdf";
import { cylinderLayout } from "./cylinder.scene";
import { profileLayout } from "./profile.scene";

export const title = "Cylinder SDF";
export const view = "sdf" as const;
export const sceneFile = "rose-sdf.scene.ts";
export const hint = "Joined rings + filled disks, then quatrefoil cut · glider is height";

let readLayout = cylinderLayout;
let readProfile = profileLayout;

if (import.meta.hot) {
  import.meta.hot.accept("./cylinder.scene.ts", (mod) => {
    if (mod && "cylinderLayout" in mod) {
      readLayout = mod.cylinderLayout as typeof cylinderLayout;
    }
  });
  import.meta.hot.accept("./profile.scene.ts", (mod) => {
    if (mod && "profileLayout" in mod) {
      readProfile = mod.profileLayout as typeof profileLayout;
    }
  });
}

/**
 * Sweep the 2D profile around each packed rim, union those rings with
 * cylinder cores that fill each disk, then subtract the quatrefoil.
 * Height is the only widget in this file.
 * Layout and profile are separate widget channels so a profile drag
 * cannot overwrite the quatrefoil radii.
 */
export function scene() {
  const layout = withoutWidgets(() => readLayout(), "cylinder");
  const profile = withoutWidgets(() => readProfile(), "profile");
  const mast = line3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 6 });
  const height = editPointOnSegment3(mast, 0.04).z;
  const field = profileSdf(profile);
  const cells = pack7(layout.radius);
  const rings = unionAll(cells.map((cell) => sweep2(cell.origin, layout.radius, field)));
  const cores = packedCylinderCores({
    radius: layout.radius,
    height,
  });
  const cuts = quatrefoilBallsPack({
    radius: layout.radius,
    height,
    ringR: layout.ringR,
    centerR: layout.centerR,
    ringBallR: layout.ringBallR,
  });
  return difference(union(rings, cores), cuts);
}
