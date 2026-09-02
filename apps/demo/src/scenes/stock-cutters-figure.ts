import { defineScene, paint } from "oblik";

import { stockCuttersLayout } from "../layout/stock-cutters";

export default defineScene({
  kind: "figure",
  title: "Stock and cutters figure",
  hint: "paint(face) is one region. Idle hits that paint, not an island index. Onion is the undeclared stock and slot cycles.",
  camera: { x: 2.25, y: 1.6, scale: 72 },
  paper: "cream",
  frame: { width: 5.4, height: 4.0 },
  build() {
    const cut = stockCuttersLayout();
    paint(cut.face, { stroke: "#1c1917", width: 1.2, fill: "#cfe8d4" }, "o_sc_pface");
    paint(cut.probe, { stroke: "#c23b22", width: 1.2, point: "dot" }, "o_sc_pprobe");
    paint(cut.split, { stroke: "#1c1917", width: 1.05, dash: [5, 3.5] }, "o_sc_psplit");
  },
});
