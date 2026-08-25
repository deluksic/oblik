export { defineScene, type Euclid2Scene, type Scene } from "./eval/scene";
export { evaluate, emit, type Draft, type EvaluateOpts } from "./eval/evaluate";
export { nodeOf, type TraceNode } from "./eval/context";
export { $site, $node } from "./eval/site";
export {
  point,
  circle,
  segment,
  line,
  parallelLine,
  perpendicularLine,
  pointOnSegment,
  pointOnLine,
  pointOnCircle,
  signedDist,
  lineIntersection,
  circleLineIntersection,
  circleCircleIntersection,
  dist,
  slider,
  constructors,
} from "./eval/constructors";
export type { SliderOpts } from "./eval/constructors";
export { analyze, listAnnotationSites, siteSpecs, type Annotation } from "./source/analyze";
export { stamp, freshSiteId } from "./source/stamp";
export { patchLiterals, formatNum } from "./source/patch";
export { insertCall, type Insert } from "./source/insert";
export { printExpr, type Expr } from "./source/expr";
export type { OblikSceneEntry, DuplicateId, DuplicateIdSite } from "./source/catalog";
export { sceneLoaderKey, findDuplicateIds } from "./source/catalog";
export type { Camera2 } from "./euclid2/camera";
export type {
  StyleKind,
  NodeStyle,
  StyleSheet,
  SheetEntry,
  StyleMismatch,
} from "./eval/style";
export { parseStyleSheet, findStyleMismatches } from "./eval/style";
export * from "./geom";
