import { defineScene, paint, style } from "oblik";

import { mountingPlateLayout } from "../layout/mounting-plate";

const hole = style({ stroke: "#1c1917", width: 1.2, fill: "none" }, "o_fhole");
const dash = style({ stroke: "#1c1917", width: 1.05, dash: [5, 3.5] }, "o_fdash");
const open = style({ stroke: "#1c1917", width: 1.2, fill: "none", point: "open" }, "o_fopen");
const dot = style({ stroke: "#1c1917", width: 1.2, point: "dot" }, "o_fdot");

export default defineScene({
  kind: "figure",
  title: "Plate figure",
  hint: "Same mountingPlateLayout() as Mounting plate. Paint what this build can name. Outline is not returned, so it stays onioned until you dive and paint it there.",
  camera: { x: 2, y: 1.6, scale: 72 },
  paper: "cream",
  frame: { width: 5.2, height: 4.2 },
  build() {
    const plate = mountingPlateLayout();
    paint(plate.drill, hole, "o_fpdrill");
    paint(plate.origin, open, "o_fporig");
    paint(plate.opp, dot, "o_fpopp");
    paint(plate.hBottom, dash, "o_fpin");
  },
});
