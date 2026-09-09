import type { Camera2, PaneSize } from "../../../euclid2/camera";
import { vec2f, vec3f } from "typegpu/data";

import type { StrokeDrawValue } from "../schemas";
import { StrokeCtrl, StrokeDraw, StrokeRun } from "../schemas";

const { ceil, floor } = Math;

/**
 * Grid hairlines, port of euclid2/view/Grid.tsx tick logic: integer-spaced
 * vertical/horizontal lines with a 1-world-unit overscan, axis lines recolored.
 * Full width is 1 CSS px ⇒ radius 0.5/scale.
 */
export function buildGridDraws(
  cam: Camera2,
  size: PaneSize,
  colors: { grid: readonly [number, number, number]; axis: readonly [number, number, number] },
  maxDraws: number,
): { draws: StrokeDrawValue[]; count: number } {
  const halfH = size.h / 2 / cam.scale + 1;
  const halfW = size.w / 2 / cam.scale + 1;
  const x0 = floor(cam.x - halfW);
  const x1 = ceil(cam.x + halfW);
  const y0 = floor(cam.y - halfH);
  const y1 = ceil(cam.y + halfH);
  const radius = 0.5 / cam.scale;

  const xs = intsIn(x0, x1, maxDraws - (y1 - y0 + 1));
  const ys = intsIn(y0, y1, maxDraws - xs.length);

  const draws: StrokeDrawValue[] = [];
  for (const x of xs) {
    draws.push(hairline([x, y0], [x, y1], x === 0 ? colors.axis : colors.grid, radius));
  }
  for (const y of ys) {
    draws.push(hairline([x0, y], [x1, y], y === 0 ? colors.axis : colors.grid, radius));
  }
  return { draws, count: draws.length };
}

/** Integers in [lo, hi], trimmed to a centered window of at most `cap` ticks. */
function intsIn(lo: number, hi: number, cap: number): number[] {
  const limit = Math.max(0, cap);
  const out: number[] = [];
  for (let v = lo; v <= hi; v++) out.push(v);
  if (out.length > limit) {
    const drop = out.length - limit;
    out.splice(0, Math.floor(drop / 2));
    out.length = limit;
  }
  return out;
}

function hairline(
  from: [number, number],
  to: [number, number],
  color: readonly [number, number, number],
  radius: number,
): StrokeDrawValue {
  const a = StrokeCtrl({ position: vec2f(from[0], from[1]), radius });
  const d = StrokeCtrl({ position: vec2f(to[0], to[1]), radius });
  return StrokeDraw({
    a,
    b: a,
    c: d,
    d,
    run: StrokeRun({ color: vec3f(color[0], color[1], color[2]), alpha: 1, start: 0, count: 0, flags: 0 }),
  });
}
