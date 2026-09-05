import {
  along,
  circle,
  csg2,
  leftOf,
  perpendicularLine,
  point,
  diff,
  intersect,
  pick,
  region,
  rightOf,
  segment,
  slider,
} from "oblik";

const { max, min } = Math;
/**
 * Geometry layers:
 *   stock, d0–d3, slot — declared regions/circles (construction + operands).
 *   face = diff(stock, cutters) — the CSG field.
 *   split — infinite midline through splitAt; only used to build left/right half-planes.
 *   left / right = intersect(face, half-plane) — not separate stock or cutters.
 */
export function stockCuttersLayout() {
  const origin = point(0.15, 0.2, "o_sc_origin");
  const opp = point(4.35, 3.0, "o_sc_opp");
  const minX = min(origin.x, opp.x);
  const maxX = max(origin.x, opp.x);
  const minY = min(origin.y, opp.y);
  const maxY = max(origin.y, opp.y);
  const bl = { x: minX, y: minY };
  const br = { x: maxX, y: minY };
  const tr = { x: maxX, y: maxY };
  const tl = { x: minX, y: maxY };
  const bot = segment(bl, br, "o_sc_bot");
  const rhs = segment(br, tr, "o_sc_rhs");
  const top = segment(tr, tl, "o_sc_top");
  const lhs = segment(tl, bl, "o_sc_lhs");
  const stock = region([bl, bot, br, rhs, tr, top, tl, lhs], [], "o_sc_stock");

  const drillR = slider(0.16, { min: 0.04, max: 0.45, step: 0.01 }, "o_sc_drillR");
  const inset = 0.42;
  const c0 = point(minX + inset, minY + inset, "o_sc_c0");
  const c1 = point(maxX - inset, minY + inset, "o_sc_c1");
  const c2 = point(maxX - inset, maxY - inset, "o_sc_c2");
  const c3 = point(minX + inset, maxY - inset, "o_sc_c3");
  const d0 = circle(c0, drillR, "o_sc_d0");
  const d1 = circle(c1, drillR, "o_sc_d1");
  const d2 = circle(c2, drillR, "o_sc_d2");
  const d3 = circle(c3, drillR, "o_sc_d3");

  const slotX = slider(3.55, { min: -1, max: 6, step: 0.02 }, "o_sc_slotX");
  const slotY = slider(1.6, { min: -1, max: 4, step: 0.02 }, "o_sc_slotY");
  const slotL = slider(1.7, { min: 0.4, max: 6, step: 0.02 }, "o_sc_slotL");
  const slotW = slider(0.42, { min: 0.16, max: 1.2, step: 0.02 }, "o_sc_slotW");
  const r = slotW / 2;
  const half = max(slotL, slotW) / 2 - r;
  const Lc = { x: slotX - half, y: slotY };
  const Rc = { x: slotX + half, y: slotY };
  const leftC = circle(Lc, r);
  const rightC = circle(Rc, r);
  const P = { x: Lc.x, y: Lc.y + r };
  const Q = { x: Rc.x, y: Rc.y + r };
  const botR = { x: Rc.x, y: Rc.y - r };
  const T = { x: Lc.x, y: Lc.y - r };
  const slotTop = segment(P, Q);
  const slotBot = segment(botR, T);
  const slot = region(
    [P, slotTop, Q, along(rightC, -1), botR, slotBot, T, along(leftC, -1)],
    [],
    "o_sc_slot",
  );

  const splitAt = point((minX + maxX) / 2, (minY + maxY) / 2, "o_sc_splitAt");
  const midline = perpendicularLine(bot, splitAt, "o_sc_split");
  const probe = point(1.05, 1.6, "o_sc_probe");

  const faceF = diff(stock, [d0, d1, d2, d3, slot]);
  const face = csg2(faceF, "o_sc_face");
  const hold = csg2(pick(faceF, probe), "o_sc_hold");
  const left = csg2(intersect([faceF, leftOf(midline)]), "o_sc_left");
  const right = csg2(intersect([faceF, rightOf(midline)]), "o_sc_right");

  return {
    origin,
    opp,
    stock,
    drillR,
    slot,
    midline,
    splitAt,
    probe,
    face,
    hold,
    left,
    right,
    d0,
  };
}
