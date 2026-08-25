import { circle, line, parallelLine, point, pointOnLine, segment, circleLineIntersection, pointOnCircle } from "oblik";
import { defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Shelf",
    hint: "Space: Point snaps to crossings and slides on lines, segments, and circles.",
  camera: { x: 2.5, y: 1.2, scale: 72 },
  build() {
    const A = point(0, 0, "o_a");
    const B = point(5.02, 1.77, "o_b");
    const ground = line(A, B, "o_g");
    const shelf = parallelLine(ground, 1.76, "o_par");
    const reach = circle(A, 2.5, "o_r");
    const P = circleLineIntersection(reach, shelf, 1, "o_p");
    const lamp = pointOnLine(shelf, 4.94, "o_lamp");
    segment(A, P, "o_s");
    const g = pointOnLine(ground, -3.37, "o_d7df92d8de");
    const g2 = pointOnCircle(reach, 0.68, 0.73, "o_9be85acae0");
    const p = point(2.8, 3.44, "o_118203e7b1");
    const l = line(p, B, "o_0fd938420c");
    return { A, B, ground, shelf, reach, P, lamp };
  },
});
