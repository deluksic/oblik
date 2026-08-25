import {
  circle,
  circleLineIntersection,
  dist,
  line,
  parallelLine,
  point,
  pointOnLine,
  segment,
  defineScene,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Shelf",
  hint: "Shelf offset, cellar = -shelf.distance, lamp glides on the cellar. Beam is dist(lamp, P).",
  camera: { x: 3, y: 1.2, scale: 52 },
  build() {
    const A = point(0, 0, "o_a");
    const B = point(5.02, 1.77, "o_b");
    const ground = line(A, B, "o_g");
    const shelf = parallelLine(ground, 1.76, "o_par");
    const cellar = parallelLine(ground, -shelf.distance, "o_cellar");
    const reach = circle(A, 2.5, "o_r");
    const P = circleLineIntersection(reach, shelf, 1, "o_p");
    segment(A, P, "o_s");
    const lamp = pointOnLine(cellar, 2.2, "o_lamp");
    const beam = circle(lamp, dist(lamp, P), "o_beam");
    const Q = circleLineIntersection(beam, ground, 1, "o_q");
    line(P, Q, "o_pq");
    return { A, B, ground, shelf, cellar, reach, P, lamp, beam, Q };
  },
});
