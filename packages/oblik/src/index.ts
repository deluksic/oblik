export { defineScene, type Euclid2Scene, type FigureScene, type Scene } from "./eval/scene";
export {
  evaluate,
  tryEvaluate,
  emit,
  type Draft,
  type EvaluateOpts,
  type EvaluateResult,
} from "./eval/evaluate";
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
  along,
  fillet,
  region,
  roundOffset,
  leftOf,
  rightOf,
  diff,
  union,
  intersect,
  pick,
  style,
  paint,
  constructors,
} from "./eval/constructors";
export type { SliderOpts } from "./eval/constructors";
export {
  isStyle,
  isPaint,
  paintsFromTrace,
  paintStrokesFromTrace,
  type FigureStyle,
  type FigurePointMark,
  type PaintValue,
  type PaintStroke,
} from "./eval/paint";
export { analyze, listAnnotationSites, siteSpecs, type Annotation } from "./source/analyze";
export {
  analyzeMentions,
  fnAt,
  fnNamed,
  insertPointNames,
  type FnReturn,
  type HelperCall,
  type MentionFile,
  type MentionFn,
} from "./source/mention";
export { stamp, freshSiteId } from "./source/stamp";
export { patchLiterals, formatNum } from "./source/patch";
export { insertCall, exposeReturnBag, namesInFunctionScope, type Insert } from "./source/insert";
export { patchPaintStyle, removePaintCall } from "./source/paint-edit";
export { patchFrame, type FrameValues } from "./source/frame-edit";
export { printExpr, member, parsePath, type Expr, type ProductField } from "./source/expr";
export type { OblikSceneEntry, DuplicateId, DuplicateIdSite } from "./source/catalog";
export { sceneLoaderKey, findDuplicateIds } from "./source/catalog";
export type { Camera2 } from "./euclid2/camera";
export * from "./geom";
