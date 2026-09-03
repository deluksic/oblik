import {
  along,
  circle,
  diff,
  intersect,
  leftOf,
  perpendicularLine,
  pick,
  point,
  region,
  rightOf,
  segment,
  slider,
  union,
} from "oblik";

/**
 * Nested booleans for the CSG tree demo:
 *   shell = diff( union([stock, earL, earR]), [drills…, slot] )
 *   west  = intersect([ shell, leftOf(midline) ])
 *   east  = intersect([ shell, rightOf(midline) ])
 *   hold  = pick(shell, probe)
 *
 * Stock, ears, and cutters are plain geometry — only `shell` and its children are the CSG field.
 */
export function csgTreeLayout() {
  const origin = point(0.2, 0.25, "o_ct_origin");
  const opp = point(5.1, 3.35, "o_ct_opp");
  const minX = Math.min(origin.x, opp.x);
  const maxX = Math.max(origin.x, opp.x);
  const minY = Math.min(origin.y, opp.y);
  const maxY = Math.max(origin.y, opp.y);
  const bl = { x: minX, y: minY };
  const br = { x: maxX, y: minY };
  const tr = { x: maxX, y: maxY };
  const tl = { x: minX, y: maxY };
  const bot = segment(bl, br, "o_ct_bot");
  const rhs = segment(br, tr, "o_ct_rhs");
  const top = segment(tr, tl, "o_ct_top");
  const lhs = segment(tl, bl, "o_ct_lhs");
  const stock = region([bl, bot, br, rhs, tr, top, tl, lhs], [], "o_ct_stock");

  const earW = slider(0.55, { min: 0.2, max: 1.1, step: 0.02 }, "o_ct_earW");
  const earH = slider(0.95, { min: 0.35, max: 1.5, step: 0.02 }, "o_ct_earH");
  const earLift = slider(0.55, { min: 0.1, max: 1.4, step: 0.02 }, "o_ct_earLift");
  const earL = region(
    [
      { x: minX - earW, y: minY + earLift },
      segment({ x: minX - earW, y: minY + earLift }, { x: minX, y: minY + earLift }),
      { x: minX, y: minY + earLift },
      segment({ x: minX, y: minY + earLift }, { x: minX, y: minY + earLift + earH }),
      { x: minX, y: minY + earLift + earH },
      segment({ x: minX, y: minY + earLift + earH }, { x: minX - earW, y: minY + earLift + earH }),
      { x: minX - earW, y: minY + earLift + earH },
      segment({ x: minX - earW, y: minY + earLift + earH }, { x: minX - earW, y: minY + earLift }),
    ],
    [],
    "o_ct_earL",
  );
  const earR = region(
    [
      { x: maxX, y: minY + earLift },
      segment({ x: maxX, y: minY + earLift }, { x: maxX + earW, y: minY + earLift }),
      { x: maxX + earW, y: minY + earLift },
      segment({ x: maxX + earW, y: minY + earLift }, { x: maxX + earW, y: minY + earLift + earH }),
      { x: maxX + earW, y: minY + earLift + earH },
      segment({ x: maxX + earW, y: minY + earLift + earH }, { x: maxX, y: minY + earLift + earH }),
      { x: maxX, y: minY + earLift + earH },
      segment({ x: maxX, y: minY + earLift + earH }, { x: maxX, y: minY + earLift }),
    ],
    [],
    "o_ct_earR",
  );
  const frame = union([stock, earL, earR], "o_ct_frame");

  const drillR = slider(0.15, { min: 0.05, max: 0.42, step: 0.01 }, "o_ct_drillR");
  const inset = 0.55;
  const c0 = point(minX + inset, minY + inset, "o_ct_c0");
  const c1 = point(maxX - inset, minY + inset, "o_ct_c1");
  const c2 = point(maxX - inset, maxY - inset, "o_ct_c2");
  const c3 = point(minX + inset, maxY - inset, "o_ct_c3");
  const d0 = circle(c0, drillR, "o_ct_d0");
  const d1 = circle(c1, drillR, "o_ct_d1");
  const d2 = circle(c2, drillR, "o_ct_d2");
  const d3 = circle(c3, drillR, "o_ct_d3");

  const slotX = slider(2.65, { min: 0.5, max: 4.8, step: 0.02 }, "o_ct_slotX");
  const slotY = slider(1.8, { min: 0.4, max: 3, step: 0.02 }, "o_ct_slotY");
  const slotL = slider(1.35, { min: 0.35, max: 3.5, step: 0.02 }, "o_ct_slotL");
  const slotW = slider(0.38, { min: 0.14, max: 0.9, step: 0.02 }, "o_ct_slotW");
  const r = slotW / 2;
  const half = Math.max(slotL, slotW) / 2 - r;
  const Lc = { x: slotX - half, y: slotY };
  const Rc = { x: slotX + half, y: slotY };
  const leftC = circle(Lc, r);
  const rightC = circle(Rc, r);
  const P = { x: Lc.x, y: Lc.y + r };
  const Q = { x: Rc.x, y: Rc.y + r };
  const botR = { x: Rc.x, y: Rc.y - r };
  const T = { x: Lc.x, y: Lc.y - r };
  const slot = region(
    [P, segment(P, Q), Q, along(rightC, -1), botR, segment(botR, T), T, along(leftC, -1)],
    [],
    "o_ct_slot",
  );

  const shell = diff(frame, [d0, d1, d2, d3, slot], "o_ct_shell");

  const midAt = point((minX + maxX) / 2, (minY + maxY) / 2, "o_ct_midAt");
  const midline = perpendicularLine(bot, midAt, "o_ct_midline");
  const probe = point(1.15, 1.75, "o_ct_probe");
  const hold = pick(shell, probe, "o_ct_hold");
  const west = intersect([shell, leftOf(midline)], "o_ct_west");
  const east = intersect([shell, rightOf(midline)], "o_ct_east");

  return {
    origin,
    opp,
    stock,
    earL,
    earR,
    frame,
    drillR,
    slot,
    midline,
    midAt,
    probe,
    shell,
    hold,
    west,
    east,
    d0,
  };
}
