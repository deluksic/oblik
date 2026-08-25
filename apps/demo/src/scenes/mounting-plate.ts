import { circle, lineIntersection, parallelLine, point, segment, defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Mounting plate",
  hint: "Diagonal corners. Inset is one parallel distance; holes reuse that and the first drill radius.",
  camera: { x: 2, y: 1.6, scale: 72 },
  build() {
    const origin = point(0.13, 0.25, "o_origin");
    const opp = point(3.86, 3.02, "o_opp");
    const minX = Math.min(origin.x, opp.x);
    const maxX = Math.max(origin.x, opp.x);
    const minY = Math.min(origin.y, opp.y);
    const maxY = Math.max(origin.y, opp.y);
    const bl = { x: minX, y: minY };
    const tr = { x: maxX, y: minY };
    const br = { x: maxX, y: maxY };
    const tl = { x: minX, y: maxY };
    const bottom = segment(bl, tr, "o_bot");
    const right = segment(tr, br, "o_right");
    const top = segment(br, tl, "o_top");
    const left = segment(tl, bl, "o_left");
    const hBottom = parallelLine(bottom, 0.49, "o_in");
    const hRight = parallelLine(right, hBottom.distance, "o_inr");
    const hTop = parallelLine(top, hBottom.distance, "o_int");
    const hLeft = parallelLine(left, hBottom.distance, "o_inl");
    const c0 = lineIntersection(hBottom, hLeft, "o_c0");
    const c1 = lineIntersection(hBottom, hRight, "o_c1");
    const c2 = lineIntersection(hTop, hRight, "o_c2");
    const c3 = lineIntersection(hTop, hLeft, "o_c3");
    const drill = circle(c0, 0.18, "o_drill");
    circle(c1, drill.radius, "o_h1");
    circle(c2, drill.radius, "o_h2");
    circle(c3, drill.radius, "o_h3");
    return { origin, opp, hBottom, drill, c0, c1, c2, c3 };
  },
});
