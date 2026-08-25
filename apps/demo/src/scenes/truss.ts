import { add, circle, lerp, mul, norm, perp, point, pointOnSegment, segment, sub, defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Truss",
  hint: "Gliders on the span. Middle ring sets the roof. Drag a radius — posts follow that circle.",
  camera: { x: 0.3, y: 1.4, scale: 42 },
  build() {
    const a = point(-3.87, 0.16, "o_tr_a");
    const b = point(4.41, -0.23, "o_tr_b");
    const span = segment(a, b, "o_span");
    const p0 = pointOnSegment(span, 0.25, "o_p0");
    const p1 = pointOnSegment(span, 0.48, "o_p1");
    const p2 = pointOnSegment(span, 0.75, "o_p2");
    const c0 = circle(p0, 1.29, "o_tr_c0");
    const c1 = circle(p1, 1.86, "o_tr_c1");
    const c2 = circle(p2, 1.17, "o_tr_c2");
    const normal = norm(perp(sub(b, a)));
    const peak = add(p1, mul(normal, c1.radius));
    segment(a, peak, "o_ra");
    segment(peak, b, "o_rb");
    segment(p0, add(p0, mul(normal, c0.radius)), "o_t0");
    segment(p1, add(p1, mul(normal, c1.radius)), "o_t1");
    segment(p2, add(p2, mul(normal, c2.radius)), "o_t2");
    for (let i = 0; i < 4; i++) {
      const q = lerp(a, b, (i + 1) / 5);
      const m = mul(normal, 0.22);
      segment(sub(q, m), add(q, m), "o_tick");
    }
    return { a, b, span, p0, p1, p2, c0, c1, c2 };
  },
});
