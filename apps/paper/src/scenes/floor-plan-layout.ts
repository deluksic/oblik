import { angle, slider, vector } from "@design-scenes/euclid2";
import { circle, point, type Vec2 } from "@design-scenes/geom";

import type { FloorPlanOpts } from "../demo/floor-plan";

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Studio flat: living (NW), bedroom (NE), kitchen strip (S), bath (SE).
 * Sliders resize rooms; angles swing doors; vector moves the island.
 */
export function floorPlanLayout(): FloorPlanOpts {
  const origin = point(0, 0);
  const unitW = slider(10, { label: "Width m", min: 8, max: 14, step: 0.25 });
  const unitD = slider(8.5, { label: "Depth m", min: 7, max: 12, step: 0.25 });
  const wall = slider(0.12, { label: "Wall m", min: 0.08, max: 0.22, step: 0.02 });

  const min: Vec2 = { x: origin.x, y: origin.y };
  const max: Vec2 = { x: origin.x + unitW, y: origin.y + unitD };

  const bedroomX = slider(6.2, {
    label: "Bed wall",
    min: unitW * 0.45,
    max: unitW - 2.2,
    step: 0.1,
  });
  const kitchenD = slider(2.4, {
    label: "Kitchen m",
    min: 1.8,
    max: 3.2,
    step: 0.1,
  });
  const bathW = slider(2.2, {
    label: "Bath m",
    min: 1.6,
    max: 3,
    step: 0.1,
  });
  const drawerCount = slider(4, {
    label: "Drawers",
    min: 2,
    max: 6,
    step: 1,
  });

  const kY = min.y + kitchenD;
  const bathX = max.x - bathW;

  const entryT = slider(0.18, { label: "Entry", min: 0.1, max: 0.32, step: 0.01 });
  const entryHinge = point(lerp(min, { x: max.x, y: min.y }, entryT).x, min.y);
  const entryWidth = circle(entryHinge, 0.9).radius;
  const entrySwing = angle(entryHinge, 90, { radius: entryWidth });

  const bedT = slider(0.42, { label: "Bed door", min: 0.28, max: 0.62, step: 0.01 });
  const bedHinge = point(bedroomX, lerp({ x: bedroomX, y: kY }, { x: bedroomX, y: max.y }, bedT).y);
  const bedWidth = circle(bedHinge, 0.82).radius;
  const bedSwing = angle(bedHinge, 0, { radius: bedWidth });

  const bathT = slider(0.5, { label: "Bath door", min: 0.32, max: 0.68, step: 0.01 });
  const bathHinge = point(bathX, lerp({ x: bathX, y: min.y }, { x: bathX, y: kY }, bathT).y);
  const bathWidth = circle(bathHinge, 0.72).radius;
  const bathSwing = angle(bathHinge, 270, { radius: bathWidth });

  const windowT = slider(0.35, { label: "Window", min: 0.2, max: 0.55, step: 0.01 });
  const windowCenter = point(lerp(min, max, windowT).x, max.y);
  const windowWidth = circle(windowCenter, 1.4).radius;

  const islandAnchor = point((min.x + bathX) / 2, (min.y + kY) / 2);
  const island = vector(islandAnchor, 0, 0.35);

  return {
    bounds: { min, max },
    wall,
    bedroomX,
    kitchenY: kY,
    bathW,
    entry: { hinge: entryHinge, width: entryWidth, swing: entrySwing },
    bedDoor: { hinge: bedHinge, width: bedWidth, swing: bedSwing },
    bathDoor: { hinge: bathHinge, width: bathWidth, swing: bathSwing },
    window: { center: windowCenter, width: windowWidth },
    island,
    drawerCount,
  };
}
