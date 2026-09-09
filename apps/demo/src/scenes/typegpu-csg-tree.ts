import { defineScene } from "oblik";

import { csgTreeLayout } from "../layout/csg-tree";

export default defineScene({
  kind: "euclid2-typegpu",
  title: "CSG tree (typegpu)",
  hint: "WebGPU twin of CSG tree. Same world, rendered through the P12 prototype.",
  camera: { x: 2.65, y: 1.8, scale: 68 },
  build() {
    return csgTreeLayout();
  },
});
