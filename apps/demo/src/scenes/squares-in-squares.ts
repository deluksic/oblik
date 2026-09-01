import { gliderAt, point, segment, slider, pointOnSegment, type Vec2 } from "oblik";

import { defineScene } from "@/index";

function recursiveQuad(x: number, p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2, depth = 0) {
  const s = segment(p1, p2, "o_b6a183ac7d");
  const s2 = segment(p2, p3, "o_6c558e6757");
  const s3 = segment(p3, p4, "o_5b8fc56f5d");
  const s4 = segment(p4, p1, "o_bc224d4308");
  const g1 = pointOnSegment(s, x, "o_4ef5567f70");
  const g2 = pointOnSegment(s2, x, "o_ea4597bbe1");
  const g3 = pointOnSegment(s3, x, "o_7145bff362");
  const g4 = pointOnSegment(s4, x, "o_44f1f73826");
  if (depth > 0) {
    recursiveQuad(x, g1, g2, g3, g4, depth - 1);
  }
}

export default defineScene({
  title: "Squares in Squares",
  kind: "euclid2",
  hint: "Oblik supports recursive function calls",
  build() {
    const x = slider(
      0.11,
      {
        min: 0,
        max: 1,
      },
      "o_1f7899e5f7",
    );
    const depth = slider(
      20,
      {
        min: 0,
        max: 20,
        step: 1,
      },
      "o_84ed47d37a",
    );
    const p1 = point(0, 0, "o_a0d21a3868");
    const p2 = point(10, 0, "o_a9fb3f012b");
    const p3 = point(10, 10, "o_19aea0a513");
    const p4 = point(0, 10, "o_9d2aebd219");
    recursiveQuad(x, p1, p2, p3, p4, depth);
  },
});
