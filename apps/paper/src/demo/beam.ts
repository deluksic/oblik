import {
  add,
  circle,
  group,
  lerp,
  segment,
  mul,
  norm,
  perp,
  polyline,
  sub,
  type Geom,
  type Segment,
  type Vec2,
} from "@design-scenes/geom";

export type Ring = { post: Vec2; radius: number };

function buildBeamParts(opts: {
  span: Segment;
  rings: Ring[];
  /** Roof height. Defaults to the middle ring’s radius. */
  hubRadius?: number;
}): Geom[] {
  const a = opts.span.a;
  const b = opts.span.b;
  const dir = sub(b, a);
  const normal = norm(perp(dir));
  const hub = opts.rings[Math.floor(opts.rings.length / 2)] ?? opts.rings[0];
  const hubR = opts.hubRadius ?? hub?.radius ?? 1;
  const peak = hub ? add(hub.post, mul(normal, hubR)) : add(a, mul(normal, hubR));

  const parts: Geom[] = [opts.span, polyline([a, peak, b])];

  for (const ring of opts.rings) {
    parts.push(segment(ring.post, add(ring.post, mul(normal, ring.radius))));
    parts.push(circle(ring.post, Math.abs(ring.radius)));
  }

  for (let i = 0; i < 4; i++) {
    const t = (i + 1) / 5;
    const q = lerp(a, b, t);
    const m = mul(normal, 0.22);
    parts.push(segment(sub(q, m), add(q, m)));
  }

  return parts;
}

/** Same shapes as assembleBeam, without a group path prefix. */
export function assembleBeamFlat(opts: { span: Segment; rings: Ring[]; hubRadius?: number }): Geom[] {
  return buildBeamParts(opts);
}

/** Span, roof, circles, ticks — paths namespaced under group[0]. */
export function assembleBeam(opts: { span: Segment; rings: Ring[]; hubRadius?: number }): Geom {
  return group(() => buildBeamParts(opts));
}
