import { defineScene, point } from "oblik";

import { csgTreeLayout } from "../layout/csg-tree";

export default defineScene({
  kind: "euclid2-typegpu",
  title: "CSG tree (typegpu)",
  hint: "WebGPU twin of CSG tree. Same world, rendered through the P12 prototype.",
  camera: { x: 2.65, y: 1.8, scale: 68 },
  build() {
    const p = point(4.13, 4.58, "o_6ea6913a14");
    return csgTreeLayout();
  },
});
