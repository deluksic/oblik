import { pointOnSegment, segment, type Vec2, paint, lineIntersection } from "oblik";

export function recursiveQuad(x: number, p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2, depth = 0) {
  const s1 = segment(p1, p2, "o_b6a183ac7d");
  const s2 = segment(p2, p3, "o_6c558e6757");
  const s3 = segment(p3, p4, "o_5b8fc56f5d");
  const s4 = segment(p4, p1, "o_bc224d4308");
  const g1 = pointOnSegment(s1, x, "o_4ef5567f70");
  const g2 = pointOnSegment(s2, x, "o_ea4597bbe1");
  const g3 = pointOnSegment(s3, x, "o_7145bff362");
  const g4 = pointOnSegment(s4, x, "o_44f1f73826");
  if (depth > 0) {
    recursiveQuad(x, g1, g2, g3, g4, depth - 1);
  }
  const k1 = segment(p1, g1, "o_d28d181c4a");
  const k2 = segment(p3, g3, "o_d61730dfe0");
  const style = { stroke: `rgb(${255 * Math.sin(depth * 0.1)},0,${depth * 10})`, width: 5.6 };
  paint(s2, style, "o_71876b1657");
  paint(s4, style, "o_d6a42746be");
  paint(k1, style, "o_7a6e9bd7fe");
  paint(k2, style, "o_b8afa5c994");
  if (depth === 0) {
    paint(s1, style, "o_f2e4f47dfe");
    paint(s3, style, "o_45099a9961");
  }
}
