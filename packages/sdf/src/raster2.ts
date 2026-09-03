import type { Sdf2 } from "./tree2";
import { evalSdf2 } from "./tree2";


const { max, round } = Math;
export type Cam2 = { x: number; y: number; scale: number };

const BG = [18, 20, 28, 255] as const;
const INSIDE = [196, 184, 168, 255] as const;
const LIP = [232, 135, 106, 230] as const;

/**
 * Paint a 2D SDF into `ctx` in the same camera as euclid2 (Y up).
 * Outside the solid is left transparent.
 */
export function fillSdf2(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  cam: Cam2,
  sdf: Sdf2,
): void {
  const dpr = ctx.getTransform().a || 1;
  const w = max(1, round(cssW * dpr));
  const h = max(1, round(cssH * dpr));
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const lip = 1.5 / cam.scale;
  for (let y = 0; y < h; y++) {
    const wy = cam.y - ((y + 0.5) / dpr - cssH / 2) / cam.scale;
    for (let x = 0; x < w; x++) {
      const wx = cam.x + ((x + 0.5) / dpr - cssW / 2) / cam.scale;
      const d = evalSdf2(sdf, { x: wx, y: wy });
      const i = (y * w + x) * 4;
      const col = d < 0 ? INSIDE : d < lip ? LIP : BG;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = col[3];
    }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  ctx.restore();
}
