import {
  along,
  circle,
  point,
  pointOnCircle,
  regionValue,
  roundOffset,
  segment,
  slider,
  defineScene,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Pie",
  hint: "Three slices of one pie. Drag A, B, or C to recut; drag gap to pull them apart.",
  camera: { x: 0, y: 0, scale: 88 },
  build() {
    const O = point(0, 0, "o_pie_o");
    const reach = circle(O, 2, "o_pie_r");
    const A = pointOnCircle(reach, 1, 0, "o_pie_a");
    const B = pointOnCircle(reach, 0, 1, "o_pie_b");
    const C = pointOnCircle(reach, -0.87, -0.5, "o_pie_c");
    const oa = segment(O, A, "o_pie_oa");
    const ob = segment(O, B, "o_pie_ob");
    const oc = segment(O, C, "o_pie_oc");
    const gap = slider(0.12, { min: 0, max: 0.4, step: 0.01 }, "o_pie_g");
    const one = roundOffset(regionValue([O, oa, A, along(reach, 1), B, ob], []), -gap, "o_pie_1");
    const two = roundOffset(regionValue([O, ob, B, along(reach, 1), C, oc], []), -gap, "o_pie_2");
    const three = roundOffset(regionValue([O, oc, C, along(reach, 1), A, oa], []), -gap, "o_pie_3");
    return { O, reach, A, B, C, oa, ob, oc, gap, one, two, three };
  },
});
