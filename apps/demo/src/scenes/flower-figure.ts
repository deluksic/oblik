import { defineScene, paint } from "oblik";

import flowerScene from "./flower";

export default defineScene({
  title: "Flower",
  kind: "figure",
  paper: "white",
  frame: {
    width: 10,
    height: 10,
    x: -5,
    y: -5,
  },
  build() {
    const flower = flowerScene.build();
    paint(flower.off, { stroke: "#d97706", fill: "#f3c5bc", width: 5.6 }, "o_9630d7ece5");
    paint(flower.rg, { stroke: "#c23b22", fill: "#f3c5bc", width: 5.6 }, "o_7f46437dd3");
  },
});
