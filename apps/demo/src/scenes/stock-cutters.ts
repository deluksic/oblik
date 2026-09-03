import { defineScene } from "oblik";

import { stockCuttersLayout } from "../layout/stock-cutters";

export default defineScene({
  kind: "euclid2",
  title: "Stock and cutters",
  hint: "face = csg2(diff(stock, cutters)). split (midline) is a construction divider for left/right — not stock, not a cutter. Only csg2(...) nodes are on the tape.",
  camera: { x: 2.25, y: 1.6, scale: 72 },
  build() {
    return stockCuttersLayout();
  },
});
