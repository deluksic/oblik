import {
  along,
  circle,
  defineScene,
  fillet,
  point,
  pointOnCircle,
  profile,
  roundOffset,
  segment,
  slider,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Round offset",
  hint: "Blue leftover is a numeric roundOffset — grab the fill and pull. Holes grow on inset, shrink on outset. Two-hole web pinches; dogbone splits; U bay closes. Shared gap is a slider (not blue).",
  camera: { x: 7.8, y: 5.0, scale: 40 },
  build() {
    // Sharp square inset — drag until the leftover vanishes.
    const Sa = point(0, 0, "o_ro_sa");
    const Sb = point(2.2, 0, "o_ro_sb");
    const Sc = point(2.2, 2.2, "o_ro_sc");
    const Sd = point(0, 2.2, "o_ro_sd");
    const sq = profile(
      [
        Sa,
        segment(Sa, Sb, "o_ro_sab"),
        Sb,
        segment(Sb, Sc, "o_ro_sbc"),
        Sc,
        segment(Sc, Sd, "o_ro_scd"),
        Sd,
        segment(Sd, Sa, "o_ro_sda"),
      ],
      "o_ro_sq",
    );
    const sqInset = roundOffset(sq, -0.22, "o_ro_sqi");

    // Sharp square outset — joins grow into quarter circles.
    const Oa = point(3.5, 0, "o_ro_oa");
    const Ob = point(5.7, 0, "o_ro_ob");
    const Oc = point(5.7, 2.2, "o_ro_oc");
    const Od = point(3.5, 2.2, "o_ro_od");
    const sqOut = profile(
      [
        Oa,
        segment(Oa, Ob, "o_ro_oab"),
        Ob,
        segment(Ob, Oc, "o_ro_obc"),
        Oc,
        segment(Oc, Od, "o_ro_ocd"),
        Od,
        segment(Od, Oa, "o_ro_oda"),
      ],
      "o_ro_sqo_p",
    );
    const sqOutset = roundOffset(sqOut, 0.24, "o_ro_sqo");

    // 90° sector inset — diameter + arc.
    const So = point(8.0, 0.15, "o_ro_so");
    const Sreach = circle(So, 1.85, "o_ro_sr");
    const Sp = pointOnCircle(Sreach, 1, 0, "o_ro_sp");
    const Sq = pointOnCircle(Sreach, 0, 1, "o_ro_sqp");
    const sector = profile(
      [So, segment(So, Sp, "o_ro_soa"), Sp, along(Sreach, 1), Sq, segment(Sq, So, "o_ro_soq")],
      "o_ro_sec_p",
    );
    const secInset = roundOffset(sector, -0.16, "o_ro_sec");

    // Filleted plate with a square hole.
    const Fa = point(11.2, 0, "o_ro_fa");
    const Fb = point(14.0, 0, "o_ro_fb");
    const Fc = point(14.0, 2.4, "o_ro_fc");
    const Fd = point(11.2, 2.4, "o_ro_fd");
    const Fh0 = point(11.9, 0.55, "o_ro_fh0");
    const Fh1 = point(13.3, 0.55, "o_ro_fh1");
    const Fh2 = point(13.3, 1.75, "o_ro_fh2");
    const Fh3 = point(11.9, 1.75, "o_ro_fh3");
    const filHole = profile(
      [
        fillet(Fa, 0.28),
        segment(Fa, Fb, "o_ro_fab"),
        fillet(Fb, 0.28),
        segment(Fb, Fc, "o_ro_fbc"),
        fillet(Fc, 0.28),
        segment(Fc, Fd, "o_ro_fcd"),
        fillet(Fd, 0.28),
        segment(Fd, Fa, "o_ro_fda"),
      ],
      {
        holes: [
          [
            Fh0,
            segment(Fh0, Fh1, "o_ro_fhab"),
            Fh1,
            segment(Fh1, Fh2, "o_ro_fhbc"),
            Fh2,
            segment(Fh2, Fh3, "o_ro_fhcd"),
            Fh3,
            segment(Fh3, Fh0, "o_ro_fhda"),
          ],
        ],
      },
      "o_ro_fil_p",
    );
    const filInset = roundOffset(filHole, -0.12, "o_ro_fil");

    // Square hole inset — hole grows, wall thins.
    const Ha = point(0, 3.5, "o_ro_ha");
    const Hb = point(2.8, 3.5, "o_ro_hb");
    const Hc = point(2.8, 6.1, "o_ro_hc");
    const Hd = point(0, 6.1, "o_ro_hd");
    const Hh0 = point(0.7, 4.2, "o_ro_hh0");
    const Hh1 = point(2.1, 4.2, "o_ro_hh1");
    const Hh2 = point(2.1, 5.4, "o_ro_hh2");
    const Hh3 = point(0.7, 5.4, "o_ro_hh3");
    const frameIn = profile(
      [
        Ha,
        segment(Ha, Hb, "o_ro_hab"),
        Hb,
        segment(Hb, Hc, "o_ro_hbc"),
        Hc,
        segment(Hc, Hd, "o_ro_hcd"),
        Hd,
        segment(Hd, Ha, "o_ro_hda"),
      ],
      {
        holes: [
          [
            Hh0,
            segment(Hh0, Hh1, "o_ro_hhab"),
            Hh1,
            segment(Hh1, Hh2, "o_ro_hhbc"),
            Hh2,
            segment(Hh2, Hh3, "o_ro_hhcd"),
            Hh3,
            segment(Hh3, Hh0, "o_ro_hhda"),
          ],
        ],
      },
      "o_ro_hi_p",
    );
    const holeInset = roundOffset(frameIn, -0.14, "o_ro_hi");

    // Square hole outset — hole shrinks, outer grows rounds.
    const Ga = point(3.6, 3.5, "o_ro_ga");
    const Gb = point(6.4, 3.5, "o_ro_gb");
    const Gc = point(6.4, 6.1, "o_ro_gc");
    const Gd = point(3.6, 6.1, "o_ro_gd");
    const Gh0 = point(4.3, 4.2, "o_ro_gh0");
    const Gh1 = point(5.7, 4.2, "o_ro_gh1");
    const Gh2 = point(5.7, 5.4, "o_ro_gh2");
    const Gh3 = point(4.3, 5.4, "o_ro_gh3");
    const frameOut = profile(
      [
        Ga,
        segment(Ga, Gb, "o_ro_gab"),
        Gb,
        segment(Gb, Gc, "o_ro_gbc"),
        Gc,
        segment(Gc, Gd, "o_ro_gcd"),
        Gd,
        segment(Gd, Ga, "o_ro_gda"),
      ],
      {
        holes: [
          [
            Gh0,
            segment(Gh0, Gh1, "o_ro_ghab"),
            Gh1,
            segment(Gh1, Gh2, "o_ro_ghbc"),
            Gh2,
            segment(Gh2, Gh3, "o_ro_ghcd"),
            Gh3,
            segment(Gh3, Gh0, "o_ro_ghda"),
          ],
        ],
      },
      "o_ro_ho_p",
    );
    const holeOutset = roundOffset(frameOut, 0.18, "o_ro_ho");

    // Two holes — drag inset until the web pinches.
    const Ta = point(7.2, 3.5, "o_ro_ta");
    const Tb = point(11.4, 3.5, "o_ro_tb");
    const Tc = point(11.4, 6.1, "o_ro_tc");
    const Td = point(7.2, 6.1, "o_ro_td");
    const T0 = point(7.7, 4.15, "o_ro_t0");
    const T1 = point(9.15, 4.15, "o_ro_t1");
    const T2 = point(9.15, 5.45, "o_ro_t2");
    const T3 = point(7.7, 5.45, "o_ro_t3");
    const U0 = point(9.55, 4.15, "o_ro_u0");
    const U1 = point(11.0, 4.15, "o_ro_u1");
    const U2 = point(11.0, 5.45, "o_ro_u2");
    const U3 = point(9.55, 5.45, "o_ro_u3");
    const twoHoles = profile(
      [
        Ta,
        segment(Ta, Tb, "o_ro_tab"),
        Tb,
        segment(Tb, Tc, "o_ro_tbc"),
        Tc,
        segment(Tc, Td, "o_ro_tcd"),
        Td,
        segment(Td, Ta, "o_ro_tda"),
      ],
      {
        holes: [
          [
            T0,
            segment(T0, T1, "o_ro_t01"),
            T1,
            segment(T1, T2, "o_ro_t12"),
            T2,
            segment(T2, T3, "o_ro_t23"),
            T3,
            segment(T3, T0, "o_ro_t30"),
          ],
          [
            U0,
            segment(U0, U1, "o_ro_u01"),
            U1,
            segment(U1, U2, "o_ro_u12"),
            U2,
            segment(U2, U3, "o_ro_u23"),
            U3,
            segment(U3, U0, "o_ro_u30"),
          ],
        ],
      },
      "o_ro_tw_p",
    );
    const twoInset = roundOffset(twoHoles, -0.12, "o_ro_tw");

    // Circular hole — two semicircle walks.
    const Ca = point(12.2, 3.5, "o_ro_ca");
    const Cb = point(15.2, 3.5, "o_ro_cb");
    const Cc = point(15.2, 6.1, "o_ro_cc");
    const Cd = point(12.2, 6.1, "o_ro_cd");
    const Co = point(13.7, 4.8, "o_ro_co");
    const Creach = circle(Co, 0.52, "o_ro_cr");
    const Cp = pointOnCircle(Creach, 1, 0, "o_ro_cp");
    const Cq = pointOnCircle(Creach, -1, 0, "o_ro_cq");
    const circHole = profile(
      [
        Ca,
        segment(Ca, Cb, "o_ro_cab"),
        Cb,
        segment(Cb, Cc, "o_ro_cbc"),
        Cc,
        segment(Cc, Cd, "o_ro_ccd"),
        Cd,
        segment(Cd, Ca, "o_ro_cda"),
      ],
      { holes: [[Cp, along(Creach, 1), Cq, along(Creach, 1)]] },
      "o_ro_ch_p",
    );
    const circInset = roundOffset(circHole, -0.12, "o_ro_ch");

    // Dogbone inset — past the neck it splits into two islands.
    const B0 = point(0, 7.3, "o_ro_b0");
    const B1 = point(1.6, 7.3, "o_ro_b1");
    const B2 = point(1.6, 7.94, "o_ro_b2");
    const B3 = point(2.4, 7.94, "o_ro_b3");
    const B4 = point(2.4, 7.3, "o_ro_b4");
    const B5 = point(4.0, 7.3, "o_ro_b5");
    const B6 = point(4.0, 8.9, "o_ro_b6");
    const B7 = point(2.4, 8.9, "o_ro_b7");
    const B8 = point(2.4, 8.26, "o_ro_b8");
    const B9 = point(1.6, 8.26, "o_ro_b9");
    const B10 = point(1.6, 8.9, "o_ro_b10");
    const B11 = point(0, 8.9, "o_ro_b11");
    const bone = profile(
      [
        B0,
        segment(B0, B1, "o_ro_b01"),
        B1,
        segment(B1, B2, "o_ro_b12"),
        B2,
        segment(B2, B3, "o_ro_b23"),
        B3,
        segment(B3, B4, "o_ro_b34"),
        B4,
        segment(B4, B5, "o_ro_b45"),
        B5,
        segment(B5, B6, "o_ro_b56"),
        B6,
        segment(B6, B7, "o_ro_b67"),
        B7,
        segment(B7, B8, "o_ro_b78"),
        B8,
        segment(B8, B9, "o_ro_b89"),
        B9,
        segment(B9, B10, "o_ro_b910"),
        B10,
        segment(B10, B11, "o_ro_b1011"),
        B11,
        segment(B11, B0, "o_ro_b110"),
      ],
      "o_ro_bone_p",
    );
    const boneInset = roundOffset(bone, -0.12, "o_ro_bone");

    // U outset — drag until the bay closes.
    const V0 = point(5.1, 7.3, "o_ro_v0");
    const V1 = point(7.5, 7.3, "o_ro_v1");
    const V2 = point(7.5, 9.7, "o_ro_v2");
    const V3 = point(6.7, 9.7, "o_ro_v3");
    const V4 = point(6.7, 8.1, "o_ro_v4");
    const V5 = point(5.9, 8.1, "o_ro_v5");
    const V6 = point(5.9, 9.7, "o_ro_v6");
    const V7 = point(5.1, 9.7, "o_ro_v7");
    const u = profile(
      [
        V0,
        segment(V0, V1, "o_ro_v01"),
        V1,
        segment(V1, V2, "o_ro_v12"),
        V2,
        segment(V2, V3, "o_ro_v23"),
        V3,
        segment(V3, V4, "o_ro_v34"),
        V4,
        segment(V4, V5, "o_ro_v45"),
        V5,
        segment(V5, V6, "o_ro_v56"),
        V6,
        segment(V6, V7, "o_ro_v67"),
        V7,
        segment(V7, V0, "o_ro_v70"),
      ],
      "o_ro_u_p",
    );
    const uOutset = roundOffset(u, 0.22, "o_ro_u");

    // Shared slider — not a numeric literal, so not blue / not grabbable.
    const gap = slider(0.14, { min: 0, max: 0.4, step: 0.01 }, "o_ro_gap");
    const Pa = point(8.6, 7.3, "o_ro_pa");
    const Pb = point(12.0, 7.3, "o_ro_pb");
    const Pc = point(12.0, 9.7, "o_ro_pc");
    const Pd = point(8.6, 9.7, "o_ro_pd");
    const Ph0 = point(9.3, 7.95, "o_ro_ph0");
    const Ph1 = point(11.3, 7.95, "o_ro_ph1");
    const Ph2 = point(11.3, 9.05, "o_ro_ph2");
    const Ph3 = point(9.3, 9.05, "o_ro_ph3");
    const sharedPlate = profile(
      [
        Pa,
        segment(Pa, Pb, "o_ro_pab"),
        Pb,
        segment(Pb, Pc, "o_ro_pbc"),
        Pc,
        segment(Pc, Pd, "o_ro_pcd"),
        Pd,
        segment(Pd, Pa, "o_ro_pda"),
      ],
      {
        holes: [
          [
            Ph0,
            segment(Ph0, Ph1, "o_ro_phab"),
            Ph1,
            segment(Ph1, Ph2, "o_ro_phbc"),
            Ph2,
            segment(Ph2, Ph3, "o_ro_phcd"),
            Ph3,
            segment(Ph3, Ph0, "o_ro_phda"),
          ],
        ],
      },
      "o_ro_sh_p",
    );
    const shared = roundOffset(sharedPlate, -gap, "o_ro_sh");

    return {
      sqInset,
      sqOutset,
      secInset,
      filInset,
      holeInset,
      holeOutset,
      twoInset,
      circInset,
      boneInset,
      uOutset,
      shared,
      gap,
    };
  },
});
