import { circle, paint, point, segment, defineScene } from "oblik";

import { mountingPlateLayout } from "../layout/mounting-plate";

const COL = [0.45, 3.35, 6.25] as const;
const STATES = ["idle", "hover", "selected"] as const;

const COLORS: readonly { id: string; stroke: string }[] = [
  { id: "black", stroke: "#1c1917" },
  { id: "brush", stroke: "#c23b22" },
  { id: "coral", stroke: "#c45c3e" },
  { id: "blue", stroke: "#3b82c4" },
  { id: "cyan", stroke: "#7ec8e3" },
  { id: "navy", stroke: "#1f5fa8" },
];

function paintSeg(
  y: number,
  prefix: string,
  look: { stroke: string; width: number; dash?: readonly number[] },
) {
  for (const [i, st] of STATES.entries()) {
    const x = COL[i]!;
    const s = segment({ x, y }, { x: x + 2.35, y }, `${prefix}_${st}_s`);
    paint(s, look, `${prefix}_${st}`);
  }
}

export default defineScene({
  kind: "figure",
  title: "Chrome figure",
  hint: "Columns: idle · hover · selected (frozen). Rows: black, brush red, selection coral, hover blue, cyan, navy — then thin/mid/thick, dash, fill, points. Right: unpainted plate (Shift = ghost, not mute). Bottom: overlapping pick. &pin=1&hover=o_pick_red:0 freezes live hover. &frame=1 selects the page.",
  camera: { x: 6.2, y: 3.7, scale: 58 },
  paper: "cream",
  frame: { x: -0.35, y: -0.45, width: 13.1, height: 8.15 },
  build() {
    let y = 7.25;
    for (const row of COLORS) {
      paintSeg(y, `o_${row.id}`, { stroke: row.stroke, width: 1.35 });
      y -= 0.52;
    }

    paintSeg(3.72, "o_thin", { stroke: "#1c1917", width: 1 });
    paintSeg(3.18, "o_mid", { stroke: "#1c1917", width: 2.8 });
    paintSeg(2.52, "o_thick", { stroke: "#1c1917", width: 5.6 });
    paintSeg(1.92, "o_dash", { stroke: "#1c1917", width: 1.35, dash: [5, 3.5] });

    for (const [i, st] of STATES.entries()) {
      const x = COL[i]! + 1.15;
      const face = circle({ x, y: 1.22 }, 0.32, `o_fill_${st}_c`);
      paint(face, { stroke: "#1c1917", width: 1.2, fill: "#f3c5bc" }, `o_fill_${st}`);
      const pt = point(x, 0.58, `o_dot_${st}_p`);
      paint(pt, { stroke: COLORS[i === 0 ? 0 : i === 1 ? 1 : 3]!.stroke, width: 1.2, point: "dot" }, `o_dot_${st}`);
    }

    const a = segment({ x: 0.45, y: 0.08 }, { x: 4.2, y: 0.22 }, "o_pick_red_s");
    const b = segment({ x: 0.45, y: 0.24 }, { x: 4.2, y: 0.02 }, "o_pick_blue_s");
    paint(a, { stroke: "#c23b22", width: 2.8 }, "o_pick_red");
    paint(b, { stroke: "#3b82c4", width: 2.8 }, "o_pick_blue");

    const plate = mountingPlateLayout(8.55, 0.35);
    paint(plate.drill, { stroke: "#1c1917", width: 1.2, fill: "none" }, "o_ghost_drill");
    paint(plate.origin, { stroke: "#1c1917", width: 1.2, point: "open" }, "o_ghost_origin");
  },
});
