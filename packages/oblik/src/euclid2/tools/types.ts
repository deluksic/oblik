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
};

export type FieldKind = "number" | "ident";

/** One Tab stop. Declared on the verb; the dispatcher only cycles/types. */
export type Field<S extends ToolSession = ToolSession> = {
  id: string;
  kind: FieldKind;
  placeholder: string;
  open: (session: S) => boolean;
  get: (session: S) => string;
  set: (session: S, raw: string) => S;
};

export type Draft = {
  id: string;
  kind: FieldKind;
  value: string;
  placeholder: string;
  invalid: boolean;
  error?: string;
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
  | { verb: "point"; focus: "x" | "y" | "name"; x: string; y: string; name: string }
  | { verb: "circle"; focus: "typed" | "name"; center?: Placed; typed: string; name: string }
  | { verb: "line"; focus: "name"; a?: Placed; name: string }
  | { verb: "segment"; focus: "name"; a?: Placed; name: string }
  | {
      verb: "parallelLine";
      focus: "typed" | "name";
      carrier?: { expr: Expr; geom: LineLike };
      typed: string;
      name: string;
    };

export type Ghost =
  | { kind: "point"; at: Vec2 }
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "line" | "segment"; a: Vec2; b: Vec2 }
  | { kind: "parallelLine"; geom: LineLike; distance: number };

export type InsertJob = {
  from: ToolId | "lineIntersection" | "circleLineIntersection" | "circleCircleIntersection";
  args: Expr[];
  bind?: string;
};

export type ToolStep = { session: ToolSession } | { insert: InsertJob };

export type Preview = {
  line: string;
  hint: string;
  draft?: Draft;
  /** Source around the focused field; the caret lives between these. */
  before?: string;
  after?: string;
  token?: string;
};

export type ToolKey = { key: string; shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean };

/**
 * One Space verb. Click / ghost / preview / fields / commit live with the spec.
 * Pane only routes pointer and keys — it must not switch on `verb`.
 */
export type Tool<S extends ToolSession = ToolSession> = {
  spec: ToolSpec;
  start(): S;
  click(session: S, hit: PlaceHit): ToolStep;
  ghost(session: S, place: PlaceHit | null): Ghost | null;
  preview(session: S, place: PlaceHit | null, usedNames: readonly string[]): Preview;
  fields?: readonly Field<S>[];
  focus?(session: S): string;
  setFocus?(session: S, id: string): S;
  /** Enter. `null` means the key was not a commit (stay in session). */
  commit?(session: S, place: PlaceHit | null): ToolStep | null;
  hit?(session: S, hit: PlaceHit, ctx: PlaceCtx): PlaceHit;
  hover?(session: S, hit: PlaceHit, trace: readonly TraceNode[]): string | null;
};
