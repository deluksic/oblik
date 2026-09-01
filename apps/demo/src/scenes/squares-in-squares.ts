import { point, slider } from "oblik";

import { defineScene } from "@/index";

import { recursiveQuad } from "../layout/recursive-squares";

export default defineScene({
  title: "Squares in Squares",
  kind: "euclid2",
  hint: "Oblik supports recursive function calls",
  build() {
    const x = slider(
      0.18,
      {
        min: 0,
        max: 1,
      },
      "o_1f7899e5f7",
    );
    const depth = slider(
      20,
      {
        min: 0,
        max: 20,
        step: 1,
      },
      "o_84ed47d37a",
    );
    const p1 = point(0, 0, "o_a0d21a3868");
    const p2 = point(10, 0, "o_a9fb3f012b");
    const p3 = point(10, 10, "o_19aea0a513");
    const p4 = point(0, 10, "o_9d2aebd219");
    recursiveQuad(x, p1, p2, p3, p4, depth);
  },
});
