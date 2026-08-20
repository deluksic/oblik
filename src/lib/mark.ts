import {
  circle,
  group,
  line,
  polyline,
  type Geom,
  type Line,
} from "./geom.ts";
import { add, lerp, mul, norm, perp, sub, type Vec2 } from "./vec.ts";

export type Ring = { post: Vec2; radius: number };

/** Span, a roof through the middle ring, circles from a loop, and tick marks. */
export function assembleBeam(opts: { span: Line; rings: Ring[] }): Geom {
  const a = opts.span.a;
  const b = opts.span.b;
  const dir = sub(b, a);
  const normal = norm(perp(dir));
  const hub = opts.rings[Math.floor(opts.rings.length / 2)] ?? opts.rings[0];
  const peak = hub
    ? add(hub.post, mul(normal, hub.radius))
    : add(a, mul(normal, 1));

  return group(() => {
    const parts: Geom[] = [opts.span, polyline([a, peak, b])];

    for (const ring of opts.rings) {
      parts.push(line(ring.post, add(ring.post, mul(normal, ring.radius))));
      parts.push(circle(ring.post, Math.abs(ring.radius)));
    }

    for (let i = 0; i < 4; i++) {
      const t = (i + 1) / 5;
      const q = lerp(a, b, t);
      const m = mul(normal, 0.22);
      parts.push(line(sub(q, m), add(q, m)));
    }

    return parts;
  });
}
