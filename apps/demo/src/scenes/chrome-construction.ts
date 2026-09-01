import {
  circle,
  circleLineIntersection,
  line,
  parallelLine,
  point,
  pointOnLine,
  segment,
  slider,
  defineScene,
} from "oblik";

const COL = [0.55, 3.65, 6.75] as const;
const STATES = ["idle", "hover", "selected"] as const;

export default defineScene({
  kind: "euclid2",
  title: "Chrome construction",
  hint: "Top: Fusion-style free vs derived (idle). Grid: idle · hover · selected frozen by id suffix — pointer does not change them. Bottom: overlapping pick. Dive Nested circles for out-of-scope mute (should not be pickable). Pin live hover with &pin=1&hover=o_pick_a",
  camera: { x: 5.1, y: 3.15, scale: 58 },
  build() {
    const FreeA = point(0.7, 5.65, "o_free_a");
    const FreeB = point(3.55, 5.55, "o_free_b");
    const ground = line(FreeA, FreeB, "o_ground");
    const reach = circle(FreeA, 1.18, "o_free_r");
    const Derived = circleLineIntersection(reach, ground, 1, "o_derived");
    const copy = circle(FreeB, reach.radius, "o_derived_r");
    const offset = parallelLine(ground, 0.82, "o_free_off");
    const Glider = pointOnLine(ground, 1.55, "o_glider");
    segment(FreeA, Derived, "o_ink_ab");

    const Idle = point(COL[0] + 1.1, 4.22, "o_col_idle");
    const Hover = point(COL[1] + 1.1, 4.22, "o_col_hover");
    const Selected = point(COL[2] + 1.1, 4.22, "o_col_selected");

    for (const [i, st] of STATES.entries()) {
      const x = COL[i]!;
      segment({ x, y: 3.45 }, { x: x + 2.2, y: 3.45 }, `o_ink_${st}`);
      circle({ x: x + 1.1, y: 2.55 }, 0.38, `o_circ_${st}`);
      point(x + 1.1, 1.72, `o_pt_${st}`);
    }

    segment({ x: 0.5, y: 0.28 }, { x: 4.4, y: 0.42 }, "o_pick_a");
    segment({ x: 0.5, y: 0.48 }, { x: 4.4, y: 0.22 }, "o_pick_b");
    circle({ x: 5.6, y: 0.35 }, 0.42, "o_pick_c");

    const gap = slider(0.12, { min: 0, max: 0.4, step: 0.01 }, "o_lab_gap");
    return {
      FreeA,
      FreeB,
      ground,
      reach,
      Derived,
      copy,
      offset,
      Glider,
      Idle,
      Hover,
      Selected,
      gap,
    };
  },
});
