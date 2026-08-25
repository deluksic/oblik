import type { TraceNode } from "../../eval/context";
import type { LineLike } from "../../geom";
import type { Expr } from "../../source/expr";
import type { Camera2, PaneSize } from "../camera";
import type { Vec2 } from "../pick";
import type { PlacePoint } from "../place";

export type ToolId = "point" | "circle" | "line" | "segment" | "parallelLine";

export type ToolSpec = {
  id: ToolId;
  title: string;
  hint: string;
  prefix: string;
  aliases?: readonly string[];
  /** Length/number can be typed while a slot is open (P5 number bar). */
  draft?: boolean;
};

export type Placed = { expr: Expr; at: Vec2 };

export type PlaceHit = {
  world: Vec2;
  point: PlacePoint;
  carrier?: { bind: string; geom: LineLike };
};

export type PlaceCtx = {
  trace: readonly TraceNode[];
  camera: Camera2;
  size: PaneSize;
};

export type ToolSession =
  | { verb: "point" }
  | { verb: "circle"; center?: Placed; typed?: string }
  | { verb: "line"; a?: Placed }
  | { verb: "segment"; a?: Placed }
  | { verb: "parallelLine"; carrier?: { expr: Expr; geom: LineLike }; typed?: string };

export type Ghost =
  | { kind: "point"; at: Vec2 }
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "line" | "segment"; a: Vec2; b: Vec2 }
  | { kind: "parallelLine"; geom: LineLike; distance: number };

export type InsertJob = {
  from: ToolId | "lineIntersection" | "circleLineIntersection" | "circleCircleIntersection";
  args: Expr[];
};

export type ToolStep = { session: ToolSession } | { insert: InsertJob };

export type Preview = { line: string; hint: string };

/**
 * One Space verb. Click / ghost / preview live with the spec.
 * Optional `hit` / `hover` keep pointer code verb-agnostic.
 * A later number bar can add `key` (digits, Tab, Enter) without touching View.
 */
export type Tool<S extends ToolSession = ToolSession> = {
  spec: ToolSpec;
  start(): S;
  click(session: S, hit: PlaceHit): ToolStep;
  ghost(session: S, place: PlaceHit | null): Ghost | null;
  preview(session: S, place: PlaceHit | null, usedNames: readonly string[]): Preview;
  hit?(session: S, hit: PlaceHit, ctx: PlaceCtx): PlaceHit;
  hover?(session: S, hit: PlaceHit, trace: readonly TraceNode[]): string | null;
};
