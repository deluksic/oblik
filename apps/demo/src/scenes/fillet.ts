import {
  along,
  circle,
  fillet,
  point,
  pointOnCircle,
  profile,
  roundOffset,
  segment,
  slider,
  defineScene,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Fillet",
  hint: "Every fillet(·, r) shares r. Drag r until the small square vanishes (adjacent overlap). The semicircle never fills (fillet at a flat origin).",
  camera: { x: 6.4, y: 2.7, scale: 42 },
  build() {
    const r = slider(0.35, { min: 0, max: 0.8, step: 0.01 }, "o_fil_r");

    const A = point(0, 0, "o_fil_a");
    const B = point(3, 0, "o_fil_b");
    const C = point(3, 2, "o_fil_c");
    const D = point(0, 2, "o_fil_d");
    const ab = segment(A, B, "o_fil_ab");
    const bc = segment(B, C, "o_fil_bc");
    const cd = segment(C, D, "o_fil_cd");
    const da = segment(D, A, "o_fil_da");
    const mix = profile([fillet(A, r), ab, B, bc, fillet(C, r), cd, D, da], "o_fil_mix");

    const Ra = point(4.4, 0, "o_fil_ra");
    const Rb = point(6.4, 0, "o_fil_rb");
    const Rc = point(6.4, 2, "o_fil_rc");
    const Rd = point(4.4, 2, "o_fil_rd");
    const rab = segment(Ra, Rb, "o_fil_rab");
    const rbc = segment(Rb, Rc, "o_fil_rbc");
    const rcd = segment(Rc, Rd, "o_fil_rcd");
    const rda = segment(Rd, Ra, "o_fil_rda");
    const round = profile(
      [fillet(Ra, r), rab, fillet(Rb, r), rbc, fillet(Rc, r), rcd, fillet(Rd, r), rda],
      "o_fil_round",
    );
    const inset = roundOffset(round, -0.12, "o_fil_inset");

    const Aa = point(7.6, 0, "o_fil_aa");
    const Ab = point(9, 0, "o_fil_ab2");
    const Ac = point(9, 1.4, "o_fil_ac");
    const Ad = point(7.6, 1.4, "o_fil_ad");
    const aab = segment(Aa, Ab, "o_fil_aab");
    const abc = segment(Ab, Ac, "o_fil_abc");
    const acd = segment(Ac, Ad, "o_fil_acd");
    const ada = segment(Ad, Aa, "o_fil_ada");
    const adj = profile([fillet(Aa, r), aab, fillet(Ab, r), abc, Ac, acd, Ad, ada], "o_fil_adj");

    const E0 = point(0, 3.2, "o_fil_e0");
    const E1 = point(2, 3.2, "o_fil_e1");
    const E2 = point(2, 4.2, "o_fil_e2");
    const E3 = point(1, 4.2, "o_fil_e3");
    const E4 = point(1, 5.2, "o_fil_e4");
    const E5 = point(0, 5.2, "o_fil_e5");
    const e01 = segment(E0, E1, "o_fil_e01");
    const e12 = segment(E1, E2, "o_fil_e12");
    const e23 = segment(E2, E3, "o_fil_e23");
    const e34 = segment(E3, E4, "o_fil_e34");
    const e45 = segment(E4, E5, "o_fil_e45");
    const e50 = segment(E5, E0, "o_fil_e50");
    const ell = profile([E0, e01, E1, e12, E2, e23, fillet(E3, r), e34, E4, e45, E5, e50], "o_fil_ell");

    const Ro = point(4.4, 3.4, "o_fil_ro");
    const Rreach = circle(Ro, 1.5, "o_fil_rr");
    const Rp = pointOnCircle(Rreach, 1, 0, "o_fil_rp");
    const Rq = pointOnCircle(Rreach, 0, 1, "o_fil_rq");
    const roa = segment(Ro, Rp, "o_fil_roa");
    const rob = segment(Ro, Rq, "o_fil_rob");
    const rim = profile([Ro, roa, fillet(Rp, r), along(Rreach, 1), fillet(Rq, r), rob], "o_fil_rim");

    const To = point(7.8, 3.4, "o_fil_to");
    const Treach = circle(To, 1.5, "o_fil_tr");
    const Tp = pointOnCircle(Treach, 1, 0, "o_fil_tp");
    const Tq = pointOnCircle(Treach, 0, 1, "o_fil_tq");
    const toa = segment(To, Tp, "o_fil_toa");
    const tob = segment(To, Tq, "o_fil_tob");
    const tip = profile([fillet(To, r), toa, Tp, along(Treach, 1), Tq, tob], "o_fil_tip");

    const Fo = point(11.4, 4.2, "o_fil_fo");
    const Freach = circle(Fo, 1.5, "o_fil_fr");
    const Fp = pointOnCircle(Freach, 1, 0, "o_fil_fp");
    const Fq = pointOnCircle(Freach, -1, 0, "o_fil_fq");
    const foa = segment(Fo, Fp, "o_fil_foa");
    const fob = segment(Fo, Fq, "o_fil_fob");
    const flat = profile([fillet(Fo, r), foa, Fp, along(Freach, 1), Fq, fob], "o_fil_flat");

    const Wa = point(10.2, 0, "o_fil_wa");
    const Wb = point(10.2, 1.2, "o_fil_wb");
    const Wc = point(11.4, 1.2, "o_fil_wc");
    const Wd = point(11.4, 0, "o_fil_wd");
    const wab = segment(Wa, Wb, "o_fil_wab");
    const wbc = segment(Wb, Wc, "o_fil_wbc");
    const wcd = segment(Wc, Wd, "o_fil_wcd");
    const wda = segment(Wd, Wa, "o_fil_wda");
    const cw = profile([fillet(Wa, r), wab, Wb, wbc, Wc, wcd, Wd, wda], "o_fil_cw");

    return {
      r,
      mix,
      round,
      inset,
      adj,
      ell,
      rim,
      tip,
      flat,
      cw,
      A,
      B,
      C,
      D,
      Ra,
      Rb,
      Rc,
      Rd,
      Aa,
      Ab,
      Ac,
      Ad,
      E0,
      E1,
      E2,
      E3,
      E4,
      E5,
      Ro,
      Rp,
      Rq,
      To,
      Tp,
      Tq,
      Fo,
      Fp,
      Fq,
      Wa,
      Wb,
      Wc,
      Wd,
    };
  },
});
