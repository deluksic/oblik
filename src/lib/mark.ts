import {
  circle,
  group,
  line,
  polyline,
  type Geom,
  type Line,
} from "./geom.ts";
import { add, lerp, mul, norm, perp, sub, type Vec2 } from "./vec.ts";

/** A beam with a sliding post, a roof, and four tick marks (loop identities). */
export function assembleBeam(opts: {
  span: Line;
  post: Vec2;
  height: number;
}): Geom {
  const a = opts.span.a;
  const b = opts.span.b;
  const dir = sub(b, a);
  const n = mul(norm(perp(dir)), opts.height);
  const peak = add(opts.post, n);

  return group(() => {
    const parts: Geom[] = [
      opts.span,
      polyline([a, peak, b]),
      line(opts.post, peak),
      circle(a, Math.abs(opts.height)),
    ];
    for (let i = 0; i < 4; i++) {
      const t = (i + 1) / 5;
      const q = lerp(a, b, t);
      const m = mul(norm(perp(dir)), 0.22);
      parts.push(line(sub(q, m), add(q, m)));
    }
    return parts;
  });
}
