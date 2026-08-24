export { defineScene, type Euclid2Scene } from "./eval/scene";
export { evaluate, emit, type Draft, type EvaluateOpts } from "./eval/evaluate";
export { nodeOf, type TraceNode } from "./eval/context";
export { $site, $node } from "./eval/site";
export {
  point,
  circle,
  segment,
  line,
  offsetLine,
  lineIntersection,
  circleLineIntersection,
  dist,
  constructors,
} from "./eval/constructors";
export {
  analyze,
  siteSpecs,
  type Annotation,
} from "./source/analyze";
export { stamp } from "./source/stamp";
export { patchLiterals, formatNum } from "./source/patch";
export { convergeDraft } from "./source/converge";
export { oblikPlugin } from "./source/vite-plugin";
export type { Camera2 } from "./euclid2/camera";
export * from "./geom";
