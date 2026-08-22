import { angle, pointOnSegment, slider, vector } from "@design-scenes/euclid2";
import {
  circle,
  line,
  offsetLine,
  point,
  segment,
  type Vec2,
} from "@design-scenes/geom";

import type { FloorPlanOpts } from "../demo/floor-plan";

/**
 * One-bedroom flat: living, bedroom, kitchen row, bath alcove.
 * Sliders resize rooms; gliders place doors and the north window;
 * vector moves the kitchen island; angle widgets swing doors.
 */
export function floorPlanLayout(): FloorPlanOpts {
  const origin = point(0, 0);
  const unitW = slider(11.5, { label: "Width m", min: 9, max: 15, step: 0.25 });
  const unitD = slider(9.8, { label: "Depth m", min: 8, max: 13, step: 0.25 });
  const wall = slider(0.14, { label: "Wall m", min: 0.08, max: 0.26, step: 0.02 });

  const min: Vec2 = { x: origin.x, y: origin.y };
  const max: Vec2 = { x: origin.x + unitW, y: origin.y + unitD };

  const bedroomX = slider(6.6, {
    label: "Bed wall",
    min: 5,
    max: unitW - 2.4,
    step: 0.1,
  });
  const kitchenY = slider(2.85, {
    label: "Kitchen m",
    min: 2.1,
    max: 4.2,
    step: 0.1,
  });
  const bathW = slider(2.35, {
    label: "Bath m",
    min: 1.7,
    max: 3.6,
    step: 0.1,
  });
  const drawerCount = slider(5, {
    label: "Drawers",
    min: 2,
    max: 8,
    step: 1,
  });

  const south = segment(min, { x: max.x, y: min.y });
  const entryHinge = pointOnSegment(south, 0.16);
  const entryWidth = circle(entryHinge, 0.92).radius;
  const entrySwing = angle(entryHinge, 88, { radius: entryWidth });

  const partition = segment({ x: bedroomX, y: kitchenY }, { x: bedroomX, y: max.y });
  const bedHinge = pointOnSegment(partition, 0.44);
  const bedWidth = circle(bedHinge, 0.82).radius;
  const bedSwing = angle(bedHinge, 12, { radius: bedWidth });

  const bathX = max.x - bathW;
  const bathEdge = segment({ x: bathX, y: min.y }, { x: bathX, y: kitchenY });
  const bathHinge = pointOnSegment(bathEdge, 0.48);
  const bathWidth = circle(bathHinge, 0.74).radius;
  const bathSwing = angle(bathHinge, 268, { radius: bathWidth });

  const north = segment({ x: min.x, y: max.y }, max);
  const windowCenter = pointOnSegment(north, 0.38);
  const windowWidth = circle(windowCenter, 1.55).radius;

  const kitchenMid = {
    x: (min.x + bathX) / 2,
    y: (min.y + kitchenY) / 2,
  };
  const island = vector(kitchenMid, 0.35, 0.22);

  const livingGuide = line(
    { x: (min.x + bedroomX) / 2, y: kitchenY },
    { x: (min.x + bedroomX) / 2, y: max.y },
  );
  const aisle = offsetLine(livingGuide, 0.55);
  void aisle;

  return {
    bounds: { min, max },
    wall,
    bedroomX,
    kitchenY,
    bathW,
    entry: { hinge: entryHinge, width: entryWidth, swing: entrySwing },
    bedDoor: { hinge: bedHinge, width: bedWidth, swing: bedSwing },
    bathDoor: { hinge: bathHinge, width: bathWidth, swing: bathSwing },
    window: { center: windowCenter, width: windowWidth },
    island,
    drawerCount,
  };
}
