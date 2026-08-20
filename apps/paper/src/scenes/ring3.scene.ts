import { withoutWidgets } from "@design-scenes/euclid2";
import { drawRing3 } from "../demo/ring.ts";
import { ringLayout } from "./ring.scene.ts";

export const title = "Signet wrap";
export const view = "euclid3" as const;
export const sceneFile = "ring3.scene.ts";
export const camera3 = {
  position: [16, -18, 11],
  target: [0, 0, 3.2],
};
export const hint = "No widgets here — the developed band is ring.ts · LMB orbit";

let readRing = ringLayout;

if (import.meta.hot) {
  import.meta.hot.accept("./ring.scene.ts", (mod) => {
    if (mod && "ringLayout" in mod) {
      readRing = mod.ringLayout as typeof ringLayout;
    }
  });
}

/**
 * Wrap of the developed band. No widgets here — this file is a view
 * of ring.ts (PLAN: two scene types looking at the same library).
 */
export function scene() {
  const r = withoutWidgets(() => readRing(), "ring");
  return drawRing3({
    origin: r.origin,
    innerR: r.innerR,
    shank: r.shank,
    signet: r.signet,
    gauge: r.gauge,
  });
}
