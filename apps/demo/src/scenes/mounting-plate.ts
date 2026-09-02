import { defineScene } from "oblik";

import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "euclid2",
  title: "Mounting plate",
  hint: "plate.face is declared cheese: outer cycle plus four circular holes. Snap plate.drill from build; overlapping or escaping holes empty the region. Select a private to dive.",
  camera: { x: 2, y: 1.6, scale: 72 },
  build() {
    const plate = mountingPlateLayout();
  },
});
