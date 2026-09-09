import { vec2f, vec3f } from "typegpu/data";

import { CONSTRUCTION_STROKE_PX } from "../../euclid2/view/chrome";
import type { StrokeDrawValue } from "./schemas";
import { StrokeCtrl, StrokeDraw, StrokeRun } from "./schemas";

const HALF_PX = CONSTRUCTION_STROKE_PX / 2;

/** M1 checkpoint geometry: reference segments + a chained polyline that
 * exercises round joins. Rebuilt on zoom — width is screen-consistent. */
export function buildPreviewDraws(ink: [number, number, number], scale: number): StrokeDrawValue[] {
  const r = HALF_PX / scale;
  const color = () => vec3f(ink[0], ink[1], ink[2]);
  const run = () => StrokeRun({ color: color(), start: 0, count: 0, flags: 0 });

  const seg = (ax: number, ay: number, bx: number, by: number): StrokeDrawValue => {
    const a = StrokeCtrl({ position: vec2f(ax, ay), radius: r });
    const d = StrokeCtrl({ position: vec2f(bx, by), radius: r });
    return StrokeDraw({ a, b: a, c: d, d, run: run() });
  };

  const pts: [number, number][] = [
    [-6, -3],
    [-4, -3.6],
    [-2, -2.6],
    [0, -3.6],
  ];
  const ctrl = (i: number) =>
    StrokeCtrl({ position: vec2f(pts[i][0], pts[i][1]), radius: r });

  return [
    seg(-2, 0, 2, 0),
    seg(0, -2, 0, 2),
    seg(1, -2, 3, 2),
    StrokeDraw({ a: ctrl(0), b: ctrl(0), c: ctrl(1), d: ctrl(2), run: run() }),
    StrokeDraw({ a: ctrl(0), b: ctrl(1), c: ctrl(2), d: ctrl(3), run: run() }),
    StrokeDraw({ a: ctrl(1), b: ctrl(2), c: ctrl(3), d: ctrl(3), run: run() }),
  ];
}
