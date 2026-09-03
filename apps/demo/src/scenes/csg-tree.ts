import { defineScene } from "oblik";

import { csgTreeLayout } from "../layout/csg-tree";

export default defineScene({
  kind: "euclid2",
  title: "CSG tree",
  hint: "Formulas compose with diff/union/intersect/pick; csg2(...) puts a node on the tape. west/east are csg2(intersect(...)). midline is construction only.",
  camera: { x: 2.65, y: 1.8, scale: 68 },
  build() {
    return csgTreeLayout();
  },
});
