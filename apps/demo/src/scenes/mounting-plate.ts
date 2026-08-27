import { defineScene } from "oblik";

import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "euclid2",
  title: "Mounting plate",
  hint: "Parent binds the helper as plate. Snap plate.drill from build; select a private to dive and insert in the layout file.",
  camera: { x: 2, y: 1.6, scale: 72 },
  build() {
    const plate = mountingPlateLayout();
  },
});
