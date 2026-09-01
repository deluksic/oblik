import { point, paint } from "oblik";

import { defineScene } from "@/index";

import { recursiveQuad } from "../layout/recursive-squares";

export default defineScene({
  title: "Squares in Squares Figure",
  kind: "figure",
  hint: "Coloring squares in squares",
  frame: {
    x: -1,
    y: -1,
    width: 12,
    height: 12,
  },
  build() {
    const p1 = point(0, 0, "o_aadfbc0cd3");
    const p2 = point(10, 0, "o_e61d3989c2");
    const p3 = point(10, 10, "o_807486d6e2");
    const p4 = point(0, 10, "o_da11ad18b7");
    recursiveQuad(0.048, p1, p2, p3, p4, 40);
  },
});
