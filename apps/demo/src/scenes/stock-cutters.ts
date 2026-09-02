import { defineScene } from "oblik";

import { stockCuttersLayout } from "../layout/stock-cutters";

export default defineScene({
  kind: "euclid2",
  title: "Stock and cutters",
  hint: "o_sc_face is the formula, not a compiled loop. Drag a drill off the plate — that hole vanishes, no XOR cap. Lengthen the slot until it severs; o_sc_hold follows the probe. NaN the split and o_sc_left / o_sc_right drop, not the face.",
  camera: { x: 2.25, y: 1.6, scale: 72 },
  build() {
    return stockCuttersLayout();
  },
});
