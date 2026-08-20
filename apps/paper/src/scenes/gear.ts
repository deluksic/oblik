import { line } from "@design-scenes/geom";
import {
  editDistanceToPoint,
  editNumber,
  editPoint,
} from "@design-scenes/euclid2";
import {
  centerDistance,
  drawSpurGear,
  gearModule,
  lineOfAction,
  meshMateRotation,
  pitchRadiusFor,
} from "../demo/gear.ts";

export const sceneFile = "gear.ts";

/**
 * Involute spur pair. Module is 2·pitch / z. The wheel is derived
 * (same module, same pressure angle, centres on +X). Mesh ° turns the pinion;
 * the mate rotates opposite so a tooth meets a space.
 */
export function scene() {
  const pinion = editPoint(-4.75, 0.05);
  const z1 = editNumber(16, { label: "Pinion teeth", min: 8, max: 36, step: 1 });
  const z2 = editNumber(24, { label: "Wheel teeth", min: 8, max: 40, step: 1 });
  const pitch1 = editDistanceToPoint(pinion, 3.2);
  const pressureDeg = editNumber(20, {
    label: "Pressure °",
    min: 14.5,
    max: 25,
    step: 0.5,
  });
  const meshDeg = editNumber(0, { label: "Mesh °", min: 0, max: 360, step: 1 });

  const m = gearModule(pitch1, z1);
  const pitch2 = pitchRadiusFor(m, z2);
  const wheel = { x: pinion.x + centerDistance(pitch1, pitch2), y: pinion.y };
  const alpha = (pressureDeg * Math.PI) / 180;
  const rot1 = (meshDeg * Math.PI) / 180;
  const rot2 = meshMateRotation(z1, z2, rot1);

  return [
    line(pinion, wheel),
    lineOfAction(pinion, pitch1, alpha, pitch1 + pitch2 * 0.35),
    drawSpurGear({
      center: pinion,
      teeth: z1,
      pitchRadius: pitch1,
      pressureAngle: alpha,
      rotation: rot1,
    }),
    drawSpurGear({
      center: wheel,
      teeth: z2,
      pitchRadius: pitch2,
      pressureAngle: alpha,
      rotation: rot2,
    }),
  ];
}
