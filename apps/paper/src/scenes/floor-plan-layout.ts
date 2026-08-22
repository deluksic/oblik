import { angle, slider, vector } from "@design-scenes/euclid2";
import { circle, point, type Vec2 } from "@design-scenes/geom";

import type { FloorPlanOpts } from "../demo/floor-plan";

/**
 * One-bed flat, Y-up: kitchen/bath on the south, living/bedroom on the north.
 * Door gaps are hinge → hinge+width along the wall (`closed` angle).
 */
export function floorPlanLayout(): FloorPlanOpts {
  const origin = point(0.42, 0.55);
  const unitW = slider(10.5, { label: "Width m", min: 8, max: 14, step: 0.25 });
  const unitD = slider(8, { label: "Depth m", min: 7, max: 12, step: 0.25 });
  const wall = slider(0.18, { label: "Wall m", min: 0.08, max: 0.22, step: 0.02 });

  const min: Vec2 = { x: origin.x, y: origin.y };
  const max: Vec2 = { x: origin.x + unitW, y: origin.y + unitD };

  const bedroomX = slider(6.8, {
    label: "Bed wall",
    min: 4.2,
    max: unitW - 3,
    step: 0.1,
  });
  const kitchenD = slider(2.7, {
    label: "Kitchen m",
    min: 2,
    max: 3.6,
    step: 0.1,
  });
  const bathW = slider(2.9, {
    label: "Bath m",
    min: 1.7,
    max: 3.2,
    step: 0.1,
  });
  const drawerCount = slider(6, {
    label: "Drawers",
    min: 2,
    max: 6,
    step: 1,
  });
  const doorW = slider(0.9, { label: "Door m", min: 0.7, max: 1.1, step: 0.02 });

  const kY = min.y + kitchenD;
  const bathX = max.x - bathW;
  const bedX = min.x + bedroomX;

  const entryClosed = 0;
  const entryT = slider(0.29, { label: "Entry", min: 0.12, max: 0.4, step: 0.01 });
  const entryHinge = point(min.x + entryT * unitW, min.y);
  const entrySwing = angle(entryHinge, 62, { radius: doorW, from: entryClosed });

  const bedClosed = Math.PI / 2;
  const bedT = slider(0.2, { label: "Bed door", min: 0.2, max: 0.75, step: 0.01 });
  const bedHinge = point(bedX, kY + bedT * (max.y - kY));
  const bedSwing = angle(bedHinge, -59, { radius: doorW, from: bedClosed });

  const bathClosed = Math.PI / 2;
  const bathT = slider(0.54, { label: "Bath door", min: 0.2, max: 0.75, step: 0.01 });
  const bathHinge = point(bathX, min.y + bathT * kitchenD);
  const bathSwing = angle(bathHinge, 67, { radius: doorW, from: bathClosed });

  const windowT = slider(0.32, { label: "Window", min: 0.18, max: 0.62, step: 0.01 });
  const windowCenter = point(min.x + windowT * unitW, max.y);
  const windowWidth = circle(windowCenter, 1.06).radius;

  const islandAnchor = point((min.x + bathX) / 2, (min.y + kY) / 2);
  const islandOff = vector(islandAnchor, 0.22, 0.11);
  const island = { x: islandAnchor.x + islandOff.x, y: islandAnchor.y + islandOff.y };

  return {
    bounds: { min, max },
    wall,
    bedroomX: bedX,
    kitchenY: kY,
    bathW,
    entry: { hinge: entryHinge, width: doorW, swing: entrySwing, closed: entryClosed },
    bedDoor: { hinge: bedHinge, width: doorW, swing: bedSwing, closed: bedClosed },
    bathDoor: { hinge: bathHinge, width: doorW, swing: bathSwing, closed: bathClosed },
    window: { center: windowCenter, width: windowWidth },
    island,
    drawerCount,
  };
}
