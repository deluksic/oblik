import {
  along,
  circle,
  inset,
  point,
  pointOnCircle,
  profile,
  segment,
  slider,
  defineScene,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Slice",
  hint: "Circular segment plus inset. Drag n: positive shrinks the cap; negative grows it with round tips.",
  camera: { x: 0.6, y: 0.8, scale: 72 },
  build() {
    const O = point(0, 0, "o_slc_o");
    const reach = circle(O, 2, "o_slc_r");
    const A = pointOnCircle(reach, 1, 0, "o_slc_a");
    const B = pointOnCircle(reach, 0, 1, "o_slc_b");
    const chord = segment(A, B, "o_slc_ch");
    const slice = profile([A, chord, B, along(reach, -1)], "o_slc_pr");
    const n = slider(0.2, { min: -0.4, max: 0.45, step: 0.01 }, "o_slc_n");
    const inner = inset(slice, n, "o_slc_ins");
    return { O, reach, A, B, chord, slice, n, inner };
  },
});
