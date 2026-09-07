import {
  defineScene,
  point,
  circle,
  pointOnCircle,
  circleCircleIntersection,
  region,
  along,
  roundOffset,
  paint,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Flower",
  hint: "Just some art example.",
  camera: { x: 4, y: 3, scale: 60 },
  build() {
    // Blank board — insert tools here with Space.

    const p = point(0, 0, "o_7b14d3f6b5");
    const c = circle(p, 2.09, "o_1479620888");
    const g = pointOnCircle(c, -0.49, 0.87, "o_1ea7174572");
    const c2 = circle(g, c.radius, "o_9a7da85261");
    const x = circleCircleIntersection(c, c2, 1, "o_0e39b6676c");
    const c3 = circle(x, c.radius, "o_cbfae50aff");
    const x2 = circleCircleIntersection(c, c3, 1, "o_5da16c17f1");
    const c4 = circle(x2, c.radius, "o_c46e3544af");
    const x3 = circleCircleIntersection(c, c4, 1, "o_e79f98a77b");
    const c5 = circle(x3, c.radius, "o_25324f66f2");

    const x4 = circleCircleIntersection(c, c5, 1, "o_836a316256");
    const c6 = circle(x4, c.radius, "o_c09f1989a0");
    const x5 = circleCircleIntersection(c, c6, 1, "o_b6c3d02271");
    const c7 = circle(x5, c.radius, "o_87a1cbae29");
    const x6 = circleCircleIntersection(c2, c7, 1, "o_335d302292");
    const x7 = circleCircleIntersection(c6, c7, -1, "o_5d0d9508e6");
    const x8 = circleCircleIntersection(c5, c6, -1, "o_7eb4ce56c6");
    const x9 = circleCircleIntersection(c4, c5, -1, "o_0abf9ba1d9");
    const x10 = circleCircleIntersection(c3, c4, -1, "o_454f5e0ccd");
    const x11 = circleCircleIntersection(c2, c3, -1, "o_e0c49c6140");
    const c8 = circle(p, 0.61, "o_33f0d2d77f");
    const x12 = circleCircleIntersection(c7, c8, -1, "o_2054f67834");
    const x13 = circleCircleIntersection(c3, c8, 1, "o_96f4c73d14");
    const x14 = circleCircleIntersection(c6, c8, -1, "o_827804d6ff");
    const x15 = circleCircleIntersection(c2, c8, 1, "o_491d84fc42");
    const x16 = circleCircleIntersection(c5, c8, -1, "o_417ea40a18");
    const x17 = circleCircleIntersection(c7, c8, 1, "o_2a82f544fb");
    const x18 = circleCircleIntersection(c4, c8, -1, "o_934ab5de91");
    const x19 = circleCircleIntersection(c6, c8, 1, "o_28215e0244");
    const x20 = circleCircleIntersection(c3, c8, -1, "o_f51420cb39");
    const x21 = circleCircleIntersection(c5, c8, 1, "o_0010540770");
    const x22 = circleCircleIntersection(c2, c8, -1, "o_75c6b763f4");
    const x23 = circleCircleIntersection(c4, c8, 1, "o_8c2fe88da5");
    const rg = region(
      [
        x11,
        along(c3, -1),
        g,
        along(c7, 1),
        x12,
        along(c8, -1),
        x13,
        along(c3, 1),
        g,
        along(c7, -1),
        x6,
        along(c2, -1),
        x5,
        along(c6, 1),
        x14,
        along(c8, -1),
        x15,
        along(c2, 1),
        x5,
        along(c6, -1),
        x7,
        along(c7, -1),
        x4,
        along(c5, 1),
        x16,
        along(c8, -1),
        x17,
        along(c7, 1),
        x4,
        along(c5, -1),
        x8,
        along(c6, -1),
        x3,
        along(c4, 1),
        x18,
        along(c8, -1),
        x19,
        along(c6, 1),
        x3,
        along(c4, -1),
        x9,
        along(c5, -1),
        x2,
        along(c3, 1),
        x20,
        along(c8, -1),
        x21,
        along(c5, 1),
        x2,
        along(c3, -1),
        x10,
        along(c4, -1),
        x,
        along(c2, 1),
        x22,
        along(c8, -1),
        x23,
        along(c4, 1),
        x,
        along(c2, -1),
      ],
      [],
      "o_0a3052cdf9",
    );

    const off = roundOffset(rg, -0.11, "o_4491f0a752");

    return { off, rg };
  },
});
