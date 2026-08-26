import { fillet, point, profile, segment, slider, defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Fillet",
  hint: "A and C are fillet(A, r) in the same profile as the sharp corners. Drag r or a point.",
  camera: { x: 2, y: 1.4, scale: 88 },
  build() {
    const A = point(0, 0, "o_fil_a");
    const B = point(4, 0, "o_fil_b");
    const C = point(4, 2.8, "o_fil_c");
    const D = point(0, 2.8, "o_fil_d");
    const ab = segment(A, B, "o_fil_ab");
    const bc = segment(B, C, "o_fil_bc");
    const cd = segment(C, D, "o_fil_cd");
    const da = segment(D, A, "o_fil_da");
    const r = slider(0.55, { min: 0, max: 1.1, step: 0.01 }, "o_fil_r");
    const face = profile([fillet(A, r), ab, B, bc, fillet(C, r), cd, D, da], "o_fil_face");
    return { A, B, C, D, ab, bc, cd, da, r, face };
  },
});
