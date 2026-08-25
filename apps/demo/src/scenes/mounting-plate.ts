import { defineScene } from "oblik";

import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "euclid2",
  title: "Mounting plate",
  hint: "Constructors live in src/layout/mounting-plate.ts. Inset is one parallel distance; holes reuse that and the first drill radius.",
  camera: { x: 2, y: 1.6, scale: 72 },
  build() {
    return mountingPlateLayout();
  },
});
