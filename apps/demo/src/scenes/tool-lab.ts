import { defineScene, point, dist, segment, line, circleLineIntersection } from "oblik";

import { rect, ring, boltCircle, bisect, keyhole } from "../layout/tools";

export default defineScene({
  kind: "euclid2",
  title: "Tool lab",
  hint: "Try the registered tools: Rect, Bolt circle, Ring, Keyhole.",
  camera: { x: 4, y: 3, scale: 60 },
  build() {
    // Blank board — insert tools here with Space.
  
    const p = point(2.1, 5.63, "o_563d71f5c9");
    const p2 = point(3.4, 5, "o_a3c345b9ce");
    const bc = boltCircle(p2, 1.39, 6);
    const p3 = point(4.64, 6.67, "o_63299da4f8");
    const rng = ring(p3, 1.22, 0.5);
    const l = line(p2, p, "o_2dc303487e");
    const l2 = line(p2, p3, "o_4df0a15f0d");
    const l3 = line(p, p3, "o_b80677326b");
    const x = circleLineIntersection(rng.outer, l3, -1, "o_048ac967f4");
    const x2 = circleLineIntersection(rng.inner, l3, -1, "o_1cea3d3603");
},
});
