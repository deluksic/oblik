import { defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Tool lab",
  hint: "Try the registered tools: Rect, Bolt circle, Ring, Keyhole.",
  camera: { x: 4, y: 3, scale: 60 },
  build() {
    // Blank board — insert tools here with Space.
  },
});
