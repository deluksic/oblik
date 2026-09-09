import { circle, defineScene, point } from "oblik";

import { nestedCircles } from "../layout/nested-circles";

export default defineScene({
  kind: "euclid2-typegpu",
  title: "Nested circles (typegpu)",
  hint: "WebGPU twin of nested circles. Same world, rendered through the P12 prototype.",
  camera: { x: 3.6, y: 1.45, scale: 64 },
  build() {
    const nest = nestedCircles();
    const twin = point(nest.origin.x + 3.15, nest.origin.y, "o_tgpu_nest_twin");
    circle(twin, nest.hub.radius, "o_tgpu_nest_twin_c");
  },
});
