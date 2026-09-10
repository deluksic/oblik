import type { Glider } from "./gliders";
import type { Vec2 } from "./vec";

export type Branch = 1 | -1;

export type Point = Vec2 & { kind: "point" };
export type Segment = { kind: "segment"; a: Vec2; b: Vec2 };
export type Line = { kind: "line"; origin: Vec2; direction: Vec2 };
export type Circle = { kind: "circle"; center: Vec2; radius: number };
export type ParallelLine = { kind: "parallelLine"; line: Line; distance: number };
export type LineLike = Segment | Line | ParallelLine;

export type Along = { kind: "along"; carrier: Circle; k: Branch };
/** Unmarked vertex witness. `at` is the sharp corner; `r` is the join radius. */
export type Fillet = { kind: "fillet"; at: Vec2; r: number };
export type LoopEdge = {
  a: Vec2;
  b: Vec2;
  carrier: LineLike | Circle;
  k?: Branch;
};
/**
 * Closed cycle: piecewise spans, or a full circle (zero vertices). Outer and
 * each hole of a region are this. Not a tape node. A `Circle` here is a
 * boundary, not a CSG disk — membership is still the walk interior.
 */
export type Loop = LoopEdge[] | Circle;
/** Declared cheese: one outer loop, holes inside, connected meat. */
export type Region = { kind: "region"; outer: Loop; holes: Loop[] };

/**
 * Computed-boundary face: a closed sampled chain of distinct points (closure
 * implicit last→first) plus hole loops (full circles or carrier cycles).
 * Not a `CsgOperand`: the boundary is a point chain, not spans on carrier
 * families, so CSG / offset / trim machinery never sees a polygon. Interact
 * with it through its own membership/fill; convert (tessellate) first if
 * region-level operations are wanted.
 */
export type Polygon = { kind: "polygon"; boundary: Vec2[]; holes: Loop[] };

/**
 * Unmarked half-space, like `along` / `fillet`. Side `1` is left of the directed
 * line (`signedDist >= 0`); `-1` is right.
 */
export type HalfPlane = { kind: "halfPlane"; line: LineLike; side: 1 | -1 };

/**
 * Minkowski offset of an operand by a disk of radius `|d|`. Positive `d`
 * grows (outward). Membership is `sdf(of) − d`. Envelope walks are paint-only.
 */
export type Offset = { kind: "offset"; of: CsgOperand; d: number };

export type CsgOp = "union" | "diff" | "intersect";

/** Planar boolean tree. Leaves are region, disk, half-plane, offset, or pick. */
export type Csg2 = {
  kind: "csg2";
  op: CsgOp;
  of: readonly CsgOperand[];
};

/**
 * Island of a CSG field at `at`. Paint and membership are the compiled
 * `Region[]` from `evaluateRegions` that contain the probe.
 */
export type Pick = { kind: "pick"; of: CsgOperand; at: Vec2 };

/**
 * `count` rotated copies of `of` about `about`, `2π/count` apart, the whole ring
 * spun by `rotation`.
 *
 * `of` is authored **once, unrotated**: it is cell 0, the copy lying on the `+x`
 * side of `about`. `rotation` spins the whole ring, so turning a gear is flipping
 * a number rather than rebuilding a tooth.
 *
 * Membership is a union — negative inside any copy — but nothing expands: the
 * fold takes the query point into the *nearest* copy's frame (rigid, so the
 * distance is preserved) and evaluates `of` once there, which is what makes a
 * 40-tooth gear one tooth of work per pixel. Exact under the recurrence's usual
 * preconditions, all of them about how `of` is authored: it must be centred on
 * its own cell (`+x` from `about`), fit inside that cell (half-sector `π/count`),
 * and not straddle the axis — see `repeat.test.ts`, which pins both the exact
 * cases and the three ways to break it.
 */
export type PolarRepeat = {
  kind: "polarRepeat";
  of: CsgOperand;
  count: number;
  about: Vec2;
  rotation: number;
};

export type CsgOperand = Region | Circle | HalfPlane | Offset | Csg2 | Pick | PolarRepeat;

export type Geom =
  | Point
  | Segment
  | Line
  | Circle
  | ParallelLine
  | Glider
  | Region
  | Polygon
  | Csg2
  | Pick
  | PolarRepeat;
