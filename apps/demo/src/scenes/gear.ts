import {
  add,
  circle,
  csg2,
  defineScene,
  diff,
  point,
  pointOnCircle,
  polar,
  polarRepeat,
  segment,
  slider,
  union,
  type Vec2,
} from "oblik";

import {
  centerDistance,
  gearModule,
  gearTooth,
  meshMateRotation,
  pitchRadiusFor,
  pitchPoint,
} from "../layout/gear";

const { PI, atan2 } = Math;

export default defineScene({
  kind: "euclid2",
  title: "Involute gears",
  hint: "Each gear is one tooth repeated around its centre — `polarRepeat`, so the field folds into the nearest tooth instead of walking every tooth's edges: 40 teeth cost one tooth of work per pixel, and the tooth count is a number rather than a rebuilt outline. Drag the pinion centre, its pitch radius, or the mesh handle; tooth counts and pressure angle are sliders. The wheel is derived.",
  camera: { x: 0.4, y: 0.15, scale: 28 },
  build() {
    const pinion = point(-4.75, 0.05, "o_gear_p");
    const z1 = slider(36, { min: 8, max: 36, step: 1 }, "o_gear_z1");
    const z2 = slider(40, { min: 8, max: 40, step: 1 }, "o_gear_z2");
    const pitch1 = circle(pinion, 1.52, "o_gear_p1");
    const pressureDeg = slider(25, { min: 14.5, max: 25, step: 0.5 }, "o_gear_a");
    const alpha = (pressureDeg * PI) / 180;
    // Mesh handle: spin the pinion on its pitch circle; the wheel follows.
    // (0.6561, 0.7547) is the unit of 49° — kept as literals so the glider is draggable.
    const mesh = pointOnCircle(pitch1, 0.84, 0.54, "o_gear_mesh");
    const rot1 = atan2(mesh.y - pinion.y, mesh.x - pinion.x);
    const bore1 = circle(pinion, pitch1.radius * 0.32, "o_gear_b1");
    // One cell — the tooth plus its wedge of root disc — repeated around the
    // pinion: the teeth cost one cell of geometry, and the tooth count is a
    // number the field folds with rather than an outline to rebuild.
    const tooth1 = gearTooth(
      { center: pinion, teeth: z1, pitchRadius: pitch1.radius, pressureAngle: alpha },
      16,
    );
    // The hub goes in as a separate operand: the cells' radial edges are inside
    // it, so the union's distance field never sees them and the repeat's seams
    // stay invisible.
    const face1 = csg2(
      diff(union([tooth1.hub, polarRepeat(tooth1.cell, z1, pinion, rot1)]), [bore1]),
      "o_gear_face1",
    );

    // Wheel is derived: same module, same pressure angle, centre on +X.
    const m = gearModule(pitch1.radius, z1);
    const pitch2 = pitchRadiusFor(m, z2);
    const wheel: Vec2 = { x: pinion.x + centerDistance(pitch1.radius, pitch2), y: pinion.y };
    const rot2 = meshMateRotation(z1, z2, rot1);
    const bore2 = circle(wheel, pitch2 * 0.32, "o_gear_b2");
    const tooth2 = gearTooth(
      { center: wheel, teeth: z2, pitchRadius: pitch2, pressureAngle: alpha },
      16,
    );
    const face2 = csg2(
      diff(union([tooth2.hub, polarRepeat(tooth2.cell, z2, wheel, rot2)]), [bore2]),
      "o_gear_face2",
    );

    const pitch2c = circle(wheel, pitch2, "o_gear_p2");
    const axis = segment(pinion, wheel, "o_gear_axis");
    // Line of action through the pitch point at the pressure angle.
    const pp = pitchPoint(pinion, pitch1.radius);
    const la = polar(pitch1.radius + pitch2 * 0.35, PI / 2 - alpha);
    const action = segment(
      add(pp, { x: -la.x, y: -la.y }),
      add(pp, { x: la.x, y: la.y }),
      "o_gear_action",
    );
    // Tooth marker from centre to the pitch point at the gear rotation.
    const marker1 = segment(pinion, add(pinion, polar(pitch1.radius, rot1)), "o_gear_m1");
    const marker2 = segment(wheel, add(wheel, polar(pitch2, rot2)), "o_gear_m2");

    return {
      pinion,
      z1,
      z2,
      pitch1,
      pitch2: pitch2c,
      mesh,
      bore1,
      bore2,
      face1,
      face2,
      axis,
      action,
      marker1,
      marker2,
    };
  },
});
