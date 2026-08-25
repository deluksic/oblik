import { circle, dist, line, parallelLine, point, signedDist, defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Shared loop",
  hint: "Five rings, one radius. Drag any ring — all follow. Offset is signedDist to p3.",
  camera: { x: 0.4, y: 1.4, scale: 48 },
  build() {
    const o = point(0, -0.03, "o_o");
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const p = {
        x: o.x + Math.cos(ang) * 2.2,
        y: o.y + Math.sin(ang) * 2.2,
      };
      circle(p, 1, "o_ring");
    }
    const p2 = point(3.37, 3.63, "o_lp2");
    const ln = line(o, p2, "o_ln");
    const p3 = point(2.45, 4.84, "o_p3");
    parallelLine(ln, signedDist(p3, ln), "o_off");
    circle(o, dist(o, p2), "o_reach");
    return { o, p2, p3, ln };
  },
});
