import {
  along,
  circle,
  point,
  pointOnCircle,
  profile,
  roundOffset,
  segment,
  slider,
  defineScene,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Slice",
  hint: "Circular segment plus roundOffset. Drag n: positive grows the cap with round tips; negative shrinks it.",
  camera: { x: 0.6, y: 0.8, scale: 72 },
  build() {
    const O = point(0, 0, "o_slc_o");
    const reach = circle(O, 2, "o_slc_r");
    const A = pointOnCircle(reach, 1, 0, "o_slc_a");
    const B = pointOnCircle(reach, 0, 1, "o_slc_b");
    const chord = segment(A, B, "o_slc_ch");
    const slice = profile([A, chord, B, along(reach, -1)], "o_slc_pr");
    const n = slider(0.2, { min: -0.4, max: 0.5, step: 0.01 }, "o_slc_n");
    const offset = roundOffset(slice, n, "o_slc_off");
    return { O, reach, A, B, chord, slice, n, offset };
  },
});
