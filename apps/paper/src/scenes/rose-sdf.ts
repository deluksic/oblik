import { line3 } from "@design-scenes/geom";
import { withoutWidgets } from "@design-scenes/euclid2";
import { editPointOnLine3 } from "@design-scenes/euclid3";
import { difference, sweep2, unionAll } from "@design-scenes/sdf";
import { quatrefoilBallsPack } from "../demo/rose-sdf.ts";
import { pack7 } from "../demo/cylinder.ts";
import { profileSdf } from "../demo/profile.ts";
import { cylinderLayout } from "./cylinder.ts";
import { profileLayout } from "./profile.ts";

export const view = "sdf" as const;
export const sceneFile = "rose-sdf.ts";

let readLayout = cylinderLayout;
let readProfile = profileLayout;

if (import.meta.hot) {
  import.meta.hot.accept("./cylinder.ts", (mod) => {
    if (mod && "cylinderLayout" in mod) {
      readLayout = mod.cylinderLayout as typeof cylinderLayout;
    }
  });
  import.meta.hot.accept("./profile.ts", (mod) => {
    if (mod && "profileLayout" in mod) {
      readProfile = mod.profileLayout as typeof profileLayout;
    }
  });
}

/**
 * Sweep the 2D profile around each packed rim, union those rings, then
 * subtract the quatrefoil. Height is the only widget in this file.
 * Layout and profile are separate widget channels so a profile drag
 * cannot overwrite the quatrefoil radii.
 */
export function scene() {
  const layout = withoutWidgets(() => readLayout(), "cylinder");
  const profile = withoutWidgets(() => readProfile(), "profile");
  const mast = line3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 6 });
  const height = editPointOnLine3(mast, 0.09).z;
  const field = profileSdf(profile);
  const joined = unionAll(
    pack7(layout.radius).map((cell) =>
      sweep2(cell.origin, layout.radius, field),
    ),
  );
  const cuts = quatrefoilBallsPack({
    radius: layout.radius,
    height,
    ringR: layout.ringR,
    centerR: layout.centerR,
    ringBallR: layout.ringBallR,
  });
  return difference(joined, cuts);
}
