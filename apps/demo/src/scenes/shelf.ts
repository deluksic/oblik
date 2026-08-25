import { circle, line, parallelLine, point, pointOnLine, segment, circleLineIntersection } from "oblik";
import { defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Shelf",
    hint: "Space: Point snaps to crossings. Circle radius can pin dist() to a point.",
  camera: { x: 2.5, y: 1.2, scale: 72 },
  build() {
    const A = point(0, 0, "o_a");
    const B = point(5.02, 1.77, "o_b");
    const ground = line(A, B, "o_g");
    const shelf = parallelLine(ground, 1.76, "o_par");
    const reach = circle(A, 2.5, "o_r");
    const P = circleLineIntersection(reach, shelf, 1, "o_p");
    const lamp = pointOnLine(shelf, 2.2, "o_lamp");
    segment(A, P, "o_s");
    return { A, B, ground, shelf, reach, P, lamp };
  },
});
