import {
  along,
  circle,
  defineScene,
  diff,
  fillet,
  pick,
  point,
  region,
  segment,
  slider,
  union,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Islands",
  hint: "Only pick is filled — the CSG stays unmarked, so the fill is evaluateRegions. Drag a probe to jump islands; drop it in the void to empty. Lengthen the slot until the plate severs. Grow the disks until they merge into one peanut.",
  camera: { x: 6.3, y: 1.55, scale: 58 },
  build() {
    const ra = slider(0.82, { min: 0.25, max: 1.45, step: 0.02 }, "o_is_ra");
    const A = point(1.05, 1.55, "o_is_a");
    const B = point(2.9, 1.55, "o_is_b");
    const ca = circle(A, ra, "o_is_ca");
    const cb = circle(B, ra, "o_is_cb");
    const pair = union([ca, cb]);
    const probePair = point(1.05, 1.55, "o_is_p0");
    const holdPair = pick(pair, probePair, "o_is_pair");

    const origin = point(4.45, 0.28, "o_is_origin");
    const opp = point(8.55, 2.82, "o_is_opp");
    const minX = Math.min(origin.x, opp.x);
    const maxX = Math.max(origin.x, opp.x);
    const minY = Math.min(origin.y, opp.y);
    const maxY = Math.max(origin.y, opp.y);
    const bl = { x: minX, y: minY };
    const br = { x: maxX, y: minY };
    const tr = { x: maxX, y: maxY };
    const tl = { x: minX, y: maxY };
    const bot = segment(bl, br, "o_is_bot");
    const rhs = segment(br, tr, "o_is_rhs");
    const top = segment(tr, tl, "o_is_top");
    const lhs = segment(tl, bl, "o_is_lhs");
    const stock = region([bl, bot, br, rhs, tr, top, tl, lhs], []);

    const drillR = slider(0.16, { min: 0.04, max: 0.4, step: 0.01 }, "o_is_drillR");
    const inset = 0.38;
    const c0 = point(minX + inset, minY + inset, "o_is_c0");
    const c1 = point(maxX - inset, maxY - inset, "o_is_c1");
    const d0 = circle(c0, drillR, "o_is_d0");
    const d1 = circle(c1, drillR, "o_is_d1");

    const slotX = slider(6.5, { min: 3.5, max: 9.5, step: 0.02 }, "o_is_slotX");
    const slotY = slider(1.55, { min: 0, max: 3.2, step: 0.02 }, "o_is_slotY");
    const slotL = slider(4.4, { min: 0.5, max: 6, step: 0.02 }, "o_is_slotL");
    const slotW = slider(0.4, { min: 0.16, max: 1.1, step: 0.02 }, "o_is_slotW");
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
    );
    const probe = point(5.15, 2.35, "o_is_probe");
    const face = diff(stock, [d0, d1, slot]);
    const hold = pick(face, probe, "o_is_hold");

    const fr = slider(0.28, { min: 0, max: 0.7, step: 0.01 }, "o_is_fr");
    const Fa = point(9.85, 0.35, "o_is_fa");
    const Fb = point(12.15, 0.35, "o_is_fb");
    const Fc = point(12.15, 2.65, "o_is_fc");
    const Fd = point(9.85, 2.65, "o_is_fd");
    const fab = segment(Fa, Fb, "o_is_fab");
    const fbc = segment(Fb, Fc, "o_is_fbc");
    const fcd = segment(Fc, Fd, "o_is_fcd");
    const fda = segment(Fd, Fa, "o_is_fda");
    const plate = region(
      [fillet(Fa, fr), fab, fillet(Fb, fr), fbc, fillet(Fc, fr), fcd, fillet(Fd, fr), fda],
      [],
    );
    const holeC = point(11, 1.5, "o_is_hc");
    const hole = circle(holeC, 0.42, "o_is_hole");
    const cheese = diff(plate, [hole]);
    const probeFil = point(10.2, 1.5, "o_is_p1");
    const holdFil = pick(cheese, probeFil, "o_is_fillet");

    return {
      A,
      B,
      ca,
      cb,
      probePair,
      holdPair,
      origin,
      opp,
      stock,
      slot,
      probe,
      hold,
      Fa,
      hole,
      probeFil,
      holdFil,
    };
  },
});
