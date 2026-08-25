import { point, segment, defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Triangle",
  hint: "Drag the corners. Space inserts like the shelf scene.",
  camera: { x: 2, y: 1.5, scale: 72 },
  build() {
    const A = point(0, 0, "o_a");
    const B = point(4, 0, "o_b");
    const C = point(2, 3, "o_c");
    segment(A, B, "o_ab");
    segment(B, C, "o_bc");
    segment(C, A, "o_ca");
    return { A, B, C };
  },
});
