import { defineScene } from "oblik";

import { nestedCircles } from "../layout/nested-circles";

export default defineScene({
  kind: "euclid2",
  title: "Nested circles",
  hint: "build → nestedCircles → petal. Snap nest.hub from build; select the bead to dive two frames. Halo is private to the cluster.",
  camera: { x: 2.1, y: 1.45, scale: 88 },
  build() {
    const nest = nestedCircles();
  },
});
