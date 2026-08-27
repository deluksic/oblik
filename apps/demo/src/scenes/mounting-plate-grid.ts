import { defineScene } from "oblik";

import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "euclid2",
  title: "Plate grid",
  hint: "Six plates from one looped call. Build cannot name plate.drill (the bind is in the loop). Select a private to dive; sibling plates mute.",
  camera: { x: 6.2, y: 3.3, scale: 40 },
  build() {
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 2; row++) {
        mountingPlateLayout(col * 4.15, row * 3.2);
      }
    }
  },
});
