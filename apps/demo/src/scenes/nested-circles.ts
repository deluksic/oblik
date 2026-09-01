import { circle, defineScene, point } from "oblik";

import { nestedCircles } from "../layout/nested-circles";

export default defineScene({
  kind: "euclid2",
  title: "Nested circles",
  hint: "build reuses nest.origin and nest.hub.radius. Dive the bead for petal; halo is private (out of scope, muted — should not be pickable).",
  camera: { x: 3.6, y: 1.45, scale: 64 },
  build() {
    const nest = nestedCircles();
    const twin = point(nest.origin.x + 3.15, nest.origin.y, "o_nest_twin");
    circle(twin, nest.hub.radius, "o_nest_twin_c");
  },
});
