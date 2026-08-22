import { angle, slider } from "@design-scenes/euclid2";
import { circle, point, segment, type Vec2 } from "@design-scenes/geom";

import {
  centerDistance,
  drawSpurGear,
  gearModule,
  lineOfAction,
  meshMateRotation,
  pitchRadiusFor,
  type GearLayout,
} from "../demo/gear";

export const title = "Gears";
export const sceneFile = "gear.scene.ts";
export const camera = { x: 0.4, y: 0.15, scale: 28 };

/**
 * Involute spur pair. Module is 2·pitch / z. The wheel is derived
 * (same module, same pressure angle, centres on +X). Mesh is a world
 * angle on the pinion pitch circle; the mate rotates opposite.
 * Helix ° is unused in 2D — the 3D scene reads it for twist.
 */
export function gearLayout(): GearLayout {
  const pinion = point(-4.75, 0.05);
  const z1 = slider(14, { label: "Pinion teeth", min: 8, max: 36, step: 1 });
  const z2 = slider(40, { label: "Wheel teeth", min: 8, max: 40, step: 1 });
  const pitch1 = circle(pinion, 1.8).radius;
  const pressureDeg = slider(25, {
    label: "Pressure °",
    min: 14.5,
    max: 25,
    step: 0.5,
  });
  const rot1 = angle(pinion, 49, { radius: pitch1 });
  const helixDeg = slider(35, {
    label: "Helix °",
    min: 0,
    max: 35,
    step: 0.5,
  });

  const m = gearModule(pitch1, z1);
  const pitch2 = pitchRadiusFor(m, z2);
  const wheel: Vec2 = {
    x: pinion.x + centerDistance(pitch1, pitch2),
    y: pinion.y,
  };
  const alpha = (pressureDeg * Math.PI) / 180;
  const rot2 = meshMateRotation(z1, z2, rot1);

  return {
    pinion,
    wheel,
    z1,
    z2,
    pitch1,
    pitch2,
    alpha,
    rot1,
    rot2,
    helixDeg,
  };
}

export function scene() {
  const g = gearLayout();
  return [
    segment(g.pinion, g.wheel),
    lineOfAction(g.pinion, g.pitch1, g.alpha, g.pitch1 + g.pitch2 * 0.35),
    ...drawSpurGear({
      center: g.pinion,
      teeth: g.z1,
      pitchRadius: g.pitch1,
      pressureAngle: g.alpha,
      rotation: g.rot1,
    }),
    ...drawSpurGear({
      center: g.wheel,
      teeth: g.z2,
      pitchRadius: g.pitch2,
      pressureAngle: g.alpha,
      rotation: g.rot2,
    }),
  ];
}
