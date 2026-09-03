import { defineScene } from "oblik";

import { csgTreeLayout } from "../layout/csg-tree";

export default defineScene({
  kind: "euclid2",
  title: "CSG tree",
  hint: "shell = diff( union([stock, earL, earR]), cutters ). west / east slice shell with midline — a construction divider, not a cutter. hold is pick(shell, probe). Select each formula node in the tree; stock and cutters stay raw geometry.",
  camera: { x: 2.65, y: 1.8, scale: 68 },
  build() {
    return csgTreeLayout();
  },
});
