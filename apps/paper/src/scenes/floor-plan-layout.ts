import { angle, slider, vector } from "@design-scenes/euclid2";
import { circle, offsetLine, point, segment, type Vec2 } from "@design-scenes/geom";

import type { FloorPlanOpts } from "../demo/floor-plan";

/** One offset call site — positive distance; mirror picks the other side. */
const innerWall = (edge: ReturnType<typeof segment>, d: number, mirror = false) =>
  offsetLine(edge, d, { mirror });
const doorOpen = (hinge: Vec2, closed: number, width: number, mirror = false) =>
  angle(hinge, 60, { radius: width, from: closed, mirror });

/** Move hinge to the far jamb and reverse closed when `flip` is true. */
const doorSide = (anchor: Vec2, closed: number, width: number, flip: boolean) => {
  if (!flip) return { hinge: anchor, closed };
  return {
    hinge: {
      x: anchor.x + Math.cos(closed) * width,
      y: anchor.y + Math.sin(closed) * width,
    },
    closed: closed + Math.PI,
  };
};

/**
 * One-bed flat, Y-up: kitchen/bath on the south, living/bedroom on the north.
 * Inner partitions are offsetLine distances from the outer shell.
 */
export function floorPlanLayout(): FloorPlanOpts {
  const origin = point(0.67, 0.71);
  const unitW = slider(13, { label: "Width m", min: 8, max: 14, step: 0.25 });
  const unitD = slider(8.25, { label: "Depth m", min: 7, max: 12, step: 0.25 });
  const wall = slider(0.22, { label: "Wall m", min: 0.08, max: 0.22, step: 0.02 });

  const min: Vec2 = { x: origin.x, y: origin.y };
  const max: Vec2 = { x: origin.x + unitW, y: origin.y + unitD };

  const south = segment(min, { x: max.x, y: min.y });
  const west = segment(min, { x: min.x, y: max.y });
  const east = segment({ x: max.x, y: min.y }, max);

  const kitchenPart = innerWall(south, 2.7);
  const bedroomPart = innerWall(west, 6.69, true);
  const bathPart = innerWall(east, 2.89);

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

  const entryT = slider(0.29, { label: "Entry", min: 0.12, max: 0.4, step: 0.01 });
  const entryAnchor = point(min.x + entryT * unitW, min.y);
  const entry = doorSide(entryAnchor, 0, doorW, false);
  const entrySwing = doorOpen(entry.hinge, entry.closed, doorW, false);

  const bedT = slider(0.58, { label: "Bed door", min: 0.2, max: 0.75, step: 0.01 });
  const bedAnchor = point(bedX, kY + bedT * (max.y - kY));
  const bedDoorSide = doorSide(bedAnchor, Math.PI / 2, doorW, false);
  const bedSwing = doorOpen(bedDoorSide.hinge, bedDoorSide.closed, doorW, true);

  const bathT = slider(0.54, { label: "Bath door", min: 0.2, max: 0.75, step: 0.01 });
  const bathAnchor = point(bathX, min.y + bathT * (kY - min.y));
  const bathDoorSide = doorSide(bathAnchor, Math.PI / 2, doorW, true);
  const bathSwing = doorOpen(bathDoorSide.hinge, bathDoorSide.closed, doorW, true);

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
    entry: { hinge: entry.hinge, width: doorW, swing: entrySwing, closed: entry.closed },
    bedDoor: { hinge: bedDoorSide.hinge, width: doorW, swing: bedSwing, closed: bedDoorSide.closed },
    bathDoor: { hinge: bathDoorSide.hinge, width: doorW, swing: bathSwing, closed: bathDoorSide.closed },
    window: { center: windowCenter, width: windowWidth },
    island,
    drawerCount,
  };
}
