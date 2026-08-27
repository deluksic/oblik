import { defineScene, paint } from "oblik";

import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "figure",
  title: "Plate figure",
  hint: "Same mountingPlateLayout() as Mounting plate. Paint what this build can name. Outline is not returned, so it stays onioned until you dive and paint it there.",
  camera: { x: 2, y: 1.6, scale: 72 },
  paper: "cream",
  frame: { width: 5.2, height: 4.2 },
  build() {
    const plate = mountingPlateLayout();
    paint(plate.drill, { stroke: "#1c1917", width: 1.2, fill: "none" }, "o_fpdrill");
    paint(plate.origin, { stroke: "#1c1917", width: 1.2, fill: "none", point: "open" }, "o_fporig");
    paint(plate.opp, { stroke: "#1c1917", width: 1.2, point: "dot" }, "o_fpopp");
    paint(plate.hBottom, { stroke: "#1c1917", width: 1.05, dash: [5, 3.5] }, "o_fpin");
  },
});
