import { defineScene } from "oblik";

import { stockCuttersLayout } from "../layout/stock-cutters";

export default defineScene({
  kind: "euclid2",
  title: "Stock and cutters",
  hint: "face = diff(stock, cutters). split (midline) is a construction divider for left/right — not stock, not a cutter. Select o_sc_left or o_sc_right to see the half-plane slices. Drag a drill off the plate and that hole vanishes.",
  camera: { x: 2.25, y: 1.6, scale: 72 },
  build() {
    return stockCuttersLayout();
  },
});
