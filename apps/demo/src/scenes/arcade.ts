import {
  along,
  circle,
  diff,
  point,
  pointOnCircle,
  region,
  segment,
  union,
  defineScene,
} from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Arcade",
  hint: "Pac-Man is a disk minus a wedge. The ghost is a union of head, tunic, and scallops, minus the eyes. Drag a mouth point to chew; drag an eye off the ghost and that hole vanishes.",
  camera: { x: 4.35, y: 1.7, scale: 68 },
  build() {
    const O = point(1.55, 1.6, "o_ar_o");
    const disk = circle(O, 1.38, "o_ar_disk");
    const A = pointOnCircle(disk, 0.766, 0.643, "o_ar_a");
    const B = pointOnCircle(disk, 0.766, -0.643, "o_ar_b");
    const oa = segment(O, A, "o_ar_oa");
    const ob = segment(O, B, "o_ar_ob");
    const mouth = region([O, oa, A, along(disk, -1), B, ob], []);
    const pac = diff(disk, [mouth], "o_ar_pac");

    circle(point(3.28, 1.6, "o_ar_p0"), 0.11, "o_ar_d0");
    circle(point(3.78, 1.6, "o_ar_p1"), 0.11, "o_ar_d1");
    circle(point(4.28, 1.6, "o_ar_p2"), 0.11, "o_ar_d2");

    const G = point(6.55, 1.85, "o_ar_g");
    const head = circle(G, 1.05, "o_ar_head");
    const left = G.x - head.radius;
    const right = G.x + head.radius;
    const top = G.y;
    const bot = 0.42;
    const bl = { x: left, y: bot };
    const br = { x: right, y: bot };
    const tr = { x: right, y: top };
    const tl = { x: left, y: top };
    const tunicBot = segment(bl, br, "o_ar_tb");
    const tunicRhs = segment(br, tr, "o_ar_tr");
    const tunicTop = segment(tr, tl, "o_ar_tt");
    const tunicLhs = segment(tl, bl, "o_ar_tl");
    const tunic = region([bl, tunicBot, br, tunicRhs, tr, tunicTop, tl, tunicLhs], []);
    const scallop = 0.35;
    const s0 = circle(point(left + scallop, bot, "o_ar_s0"), scallop, "o_ar_c0");
    const s1 = circle(point(G.x, bot, "o_ar_s1"), scallop, "o_ar_c1");
    const s2 = circle(point(right - scallop, bot, "o_ar_s2"), scallop, "o_ar_c2");
    const eyeL = circle(point(G.x - 0.38, G.y + 0.12, "o_ar_el"), 0.24, "o_ar_eyeL");
    const eyeR = circle(point(G.x + 0.38, G.y + 0.12, "o_ar_er"), 0.24, "o_ar_eyeR");
    const ghost = diff(union([head, tunic, s0, s1, s2]), [eyeL, eyeR], "o_ar_ghost");

    return { O, disk, A, B, pac, G, head, eyeL, eyeR, ghost };
  },
});
