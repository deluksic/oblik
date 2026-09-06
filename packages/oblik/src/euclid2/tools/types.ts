import type { TraceNode } from "#eval/context";
import type { Branch, Circle, Loop, LineLike, Region, LoopEdge } from "#geom";
import type { Expr } from "#source/expr";

import type { Camera2, PaneSize } from "../camera";
import type { Vec2 } from "../pick";
import type { PlacePoint } from "../place";

export type ToolId =
  | "point"
  | "circle"
  | "line"
  | "segment"
  | "parallelLine"
  | "perpendicularLine"
  | "slider"
  | "region"
  | "roundOffset"
  | "fillet";

export type ToolSpec = {
  id: ToolId;
  title: string;
  hint: string;
  prefix: string;
  aliases?: readonly string[];
};

export type FieldKind = "number" | "ident" | "ref" | "length";

/** One Tab stop. Declared on the verb; the dispatcher only cycles/types. */
export type Field<S extends ToolSession = ToolSession> = {
  id: string;
  kind: FieldKind;
  placeholder: string;
  /** For `ref`: existing point vs line/segment/parallel vs region. For `length`: slider bind. */
  looks?: "point" | "carrier" | "region" | "length";
  open: (session: S) => boolean;
  get: (session: S) => string;
  set: (session: S, raw: string) => S;
};

/** Named geometry on the tape. Pane builds this; tools look up without switching on verb. */
export type Scope = {
  used: readonly string[];
  points: Readonly<Record<string, Placed>>;
  carriers: Readonly<Record<string, { expr: Expr; geom: LineLike }>>;
  circles: Readonly<Record<string, { expr: Expr; geom: Circle }>>;
  regions: Readonly<Record<string, { expr: Expr; geom: Region }>>;
  /** Slider binds → live value (for length reuse). */
  lengths: Readonly<Record<string, number>>;
  /** Mentionable constructor id → expr in this focus. */
  byId: Readonly<Record<string, Expr>>;
  /**
   * Mentionable tape nodes (`id:occ`) → print. An empty object means this
   * scope has no snap. Unfiltered snap is any named node, not occurrence 0.
   */
  prints?: Readonly<Record<string, Expr>>;
  /**
   * Tape nodes drawn at full strength in this focus (`id:occ`). Nested helper
   * geometry is included so a parent call shows the callee in full. `undefined`
   * means do not mute.
   */
  liveKeys?: ReadonlySet<string>;
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
  carrier?: { bind: string; geom: LineLike | Circle };
  region?: { bind: string; geom: Region; id?: string };
  corner?: { index: number; at: Vec2 };
  length?: { expr: Expr; value: number };
};

export type PlaceCtx = {
  trace: readonly TraceNode[];
  camera: Camera2;
  size: PaneSize;
  screen?: { x: number; y: number };
  target?: EventTarget | undefined;
  /** Mentionable tape keys (`id:occ`). When set, snap only those nodes. */
  keys?: ReadonlySet<string>;
  print?: (n: TraceNode) => string | undefined;
  /** Pane scope for this place. Tools must not rebuild occ-0 scope from the tape. */
  scope?: Scope;
};

export type ToolSession =
  | { verb: "point"; focus: "x" | "y" | "name"; x: string; y: string; name: string }
  | {
      verb: "circle";
      focus: "center" | "typed" | "name";
      center?: Placed;
      centerRef: string;
      typed: string;
      name: string;
      lengthPick?: Expr;
    }
  | {
      verb: "line";
      focus: "a" | "b" | "name";
      a?: Placed;
      aRef: string;
      b?: Placed;
      bRef: string;
      name: string;
    }
  | {
      verb: "segment";
      focus: "a" | "b" | "name";
      a?: Placed;
      aRef: string;
      b?: Placed;
      bRef: string;
      name: string;
    }
  | {
      verb: "parallelLine";
      focus: "carrier" | "typed" | "name";
      carrier?: { expr: Expr; geom: LineLike };
      carrierRef: string;
      typed: string;
      name: string;
      lengthPick?: Expr;
    }
  | {
      verb: "perpendicularLine";
      focus: "carrier" | "through" | "name";
      carrier?: { expr: Expr; geom: LineLike };
      carrierRef: string;
      through?: Placed;
      throughRef: string;
      name: string;
    }
  | {
      verb: "slider";
      focus: "value" | "min" | "max" | "step" | "name";
      value: string;
      min: string;
      max: string;
      step: string;
      name: string;
    }
  | {
      verb: "region";
      focus: "cycle" | "name";
      vertices: Placed[];
      carriers: Array<{ expr: Expr; geom: LineLike | Circle; k?: Branch }>;
      name: string;
    }
  | {
      verb: "roundOffset";
      focus: "face" | "typed" | "name";
      face?: { expr: Expr; geom: Region };
      faceRef: string;
      typed: string;
      name: string;
      lengthPick?: Expr;
    }
  | {
      verb: "fillet";
      focus: "corner" | "typed";
      faceId: string;
      faceBind: string;
      geom?: Region;
      vertex?: number;
      at?: Vec2;
      vertexExpr?: Expr;
      typed: string;
      lengthPick?: Expr;
    };

export type Ghost =
  | { kind: "point"; at: Vec2 }
  | { kind: "corner"; at: Vec2 }
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "line" | "segment"; a: Vec2; b: Vec2 }
  | { kind: "parallelLine"; geom: LineLike; distance: number }
  | {
      kind: "region";
      edges: LoopEdge[];
      /** Disjoint closed walks; when set, fill/stroke do not chain islands. */
      loops?: Loop[];
      hover?: LoopEdge;
      arrow?: { at: Vec2; tx: number; ty: number };
    };

export type InsertJob = {
  from:
    | ToolId
    | "diff"
    | "union"
    | "intersect"
    | "pick"
    | "lineIntersection"
    | "circleLineIntersection"
    | "circleCircleIntersection"
    | "pointOnSegment"
    | "pointOnLine"
    | "pointOnCircle";
  args: Expr[];
  bind?: string;
  patchVertex?: { id: string; index: number };
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

export type ToolKey = {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
};

export type ToolChrome = {
  hideFills?: boolean;
  muteStrokes?: boolean;
  mutePoints?: boolean;
  hideSnap?: boolean;
};

/**
 * One Space verb. Click / ghost / preview / fields / commit live with the spec.
 * Pane only routes pointer and keys — it must not switch on `verb`.
 */
export type Tool<S extends ToolSession = ToolSession> = {
  spec: ToolSpec;
  start(): S;
  click(session: S, hit: PlaceHit, scope: Scope): ToolStep;
  ghost(session: S, place: PlaceHit | undefined, scope: Scope): Ghost | undefined;
  preview(session: S, place: PlaceHit | undefined, scope: Scope): Preview;
  fields?: readonly Field<S>[];
  focus?(session: S): string;
  setFocus?(session: S, id: string): S;
  /** Enter. `undefined` means the key was not a commit (stay in session). */
  commit?(session: S, place: PlaceHit | undefined, scope: Scope): ToolStep | undefined;
  hit?(session: S, hit: PlaceHit, ctx: PlaceCtx): PlaceHit;
  hover?(session: S, hit: PlaceHit, trace: readonly TraceNode[], scope?: Scope): string | undefined;
  /** If set, Tab uses this instead of cycling fields. */
  tab?(session: S, dir: 1 | -1): S;
  /** Dim construction chrome while this verb is live. */
  chrome?(session: S): ToolChrome;
};
