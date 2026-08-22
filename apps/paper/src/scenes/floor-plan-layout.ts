import { angle, slider, vector } from "@design-scenes/euclid2";
import { circle, offsetLine, point, segment, type Vec2 } from "@design-scenes/geom";

import type { FloorPlanOpts } from "../demo/floor-plan";

/** One angle call site — every door shares the same open sweep. */
const doorOpen = (hinge: Vec2, closed: number, width: number) =>
  angle(hinge, 62, { radius: width, from: closed });

/**
 * One-bed flat, Y-up: kitchen/bath on the south, living/bedroom on the north.
 * Inner partitions are offsetLine distances from the outer shell.
 */
export function floorPlanLayout(): FloorPlanOpts {
  const origin = point(0.42, 0.55);
  const unitW = slider(13, { label: "Width m", min: 8, max: 14, step: 0.25 });
  const unitD = slider(8.25, { label: "Depth m", min: 7, max: 12, step: 0.25 });
  const wall = slider(0.22, { label: "Wall m", min: 0.08, max: 0.22, step: 0.02 });

  const min: Vec2 = { x: origin.x, y: origin.y };
  const max: Vec2 = { x: origin.x + unitW, y: origin.y + unitD };

  const south = segment(min, { x: max.x, y: min.y });
  const west = segment(min, { x: min.x, y: max.y });
  const east = segment({ x: max.x, y: min.y }, max);

  const kitchenPart = offsetLine(south, 2.7);
  const bedroomPart = offsetLine(west, -6.69);
  const bathPart = offsetLine(east, 3.71);

  const kY = kitchenPart.line.origin.y;
  const bedX = bedroomPart.line.origin.x;
  const bathX = bathPart.line.origin.x;
  const bathW = bathPart.distance;

  const drawerCount = slider(6, {
    label: "Drawers",
    min: 2,
    max: 6,
    step: 1,
  });
  const doorW = slider(1.1, { label: "Door m", min: 0.7, max: 1.1, step: 0.02 });

  const entryClosed = 0;
  const entryT = slider(0.29, { label: "Entry", min: 0.12, max: 0.4, step: 0.01 });
  const entryHinge = point(min.x + entryT * unitW, min.y);
  const entrySwing = doorOpen(entryHinge, entryClosed, doorW);

  const bedClosed = Math.PI / 2;
  const bedT = slider(0.58, { label: "Bed door", min: 0.2, max: 0.75, step: 0.01 });
  const bedHinge = point(bedX, kY + bedT * (max.y - kY));
  const bedSwing = doorOpen(bedHinge, bedClosed, doorW);

  const bathClosed = Math.PI / 2;
  const bathT = slider(0.54, { label: "Bath door", min: 0.2, max: 0.75, step: 0.01 });
  const bathHinge = point(bathX, min.y + bathT * (kY - min.y));
  const bathSwing = doorOpen(bathHinge, bathClosed, doorW);

  const windowT = slider(0.32, { label: "Window", min: 0.18, max: 0.62, step: 0.01 });
  const windowCenter = point(min.x + windowT * unitW, max.y);
  const windowWidth = circle(windowCenter, 1.37).radius;

  const islandAnchor = point((min.x + bathX) / 2, (min.y + kY) / 2);
  const islandOff = vector(islandAnchor, -0.59, 0.07);
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
