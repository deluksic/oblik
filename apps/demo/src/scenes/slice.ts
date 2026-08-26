import {
  along,
  circle,
  point,
  pointOnCircle,
  profile,
  segment,
  defineScene,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Slice",
  hint: "Circular segment: named chord plus along(reach, -1). Drag A, B, or the radius; the fill follows.",
  camera: { x: 0.6, y: 0.8, scale: 72 },
  build() {
    const O = point(0, 0, "o_slc_o");
    const reach = circle(O, 2, "o_slc_r");
    const A = pointOnCircle(reach, 1, 0, "o_slc_a");
    const B = pointOnCircle(reach, 0, 1, "o_slc_b");
    const chord = segment(A, B, "o_slc_ch");
    const slice = profile([A, chord, B, along(reach, -1)], "o_slc_pr");
    return { O, reach, A, B, chord, slice };
  },
});
