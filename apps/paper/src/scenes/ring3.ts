import { withoutWidgets } from "@design-scenes/euclid2";
import { drawRing3 } from "../demo/ring.ts";
import { ringLayout } from "./ring.ts";

export const view = "euclid3" as const;
export const sceneFile = "ring3.ts";

let readRing = ringLayout;

if (import.meta.hot) {
  import.meta.hot.accept("./ring.ts", (mod) => {
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
