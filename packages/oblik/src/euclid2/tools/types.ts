import type { SceneValue, TraceNode } from "#eval/context";
import type { Branch, Circle, Loop, LineLike, Region, LoopEdge } from "#geom";
import type { Expr } from "#source/expr";

import type { Camera2, PaneSize } from "../camera";
import type { SnapNode } from "../pick";
import type { Vec2 } from "../pick";
import type { PlacePoint } from "../place";

/** The hand-written euclid2 verbs. */
export type BuiltinToolId =
  | "point"
  | "circle"
  | "line"
  | "segment"
  | "parallelLine"
  | "perpendicularLine"
  | "tangent"
  | "slider"
  | "region"
  | "roundOffset"
  | "fillet";

/**
 * Any tool id the pane can route. Built-ins keep autocomplete; user tools
 * registered with `defineTool` use their registered name as the id.
 */
export type ToolId = BuiltinToolId | (string & {});

export type ToolSpec = {
  id: ToolId;
  title: string;
  hint: string;
  prefix: string;
  aliases?: readonly string[];
};

/**
 * One positional argument of a registered composite tool. Positional, matching
 * the fn's params in order; `label` is the field placeholder / anchor key.
 *
 * - `point`: click empty space (literal point) or mention an existing point.
 * - `region`: click a face or mention an existing region.
 * - `segment`: click an existing segment stroke or mention its name.
 * - `length`: a length *expression* — type a number / `p.radius` /
 *   `par.distance` / slider, click an existing length to reuse it live, or with
 *   `anchor` (label of an earlier point/region arg) click to measure
 *   `dist`/signed offset from that anchor. Anchors enable cursor-draft ghosts.
 * - `number`: a numeric *literal* — typed value (or `def`); clicking an
 *   existing length reuses it as an evaluated number. Never measured from an
 *   anchor, never an expression.
 *
 * Args without a `def` are **required**: the ghost and the insert wait until
 * they are populated (typed, clicked, or measured). A `def` pre-fills the arg
 * so Enter can commit a default call immediately.
 */
export type ToolArg =
  | { kind: "point"; label: string }
  | { kind: "region"; label: string }
  | { kind: "segment"; label: string }
  | { kind: "length"; label: string; def?: number; anchor?: string }
  | { kind: "number"; label: string; def?: number; integer?: boolean };

export type ToolDef = {
  /**
   * Registry key = palette id = the callee written into source. Defaults to
   * `fn.name` and must match the module's exported binding. Unique per page.
   */
  name?: string;
  title: string;
  hint?: string;
  /** Bind-name prefix (`bc` → `bc1`, `bc2`). */
  prefix: string;
  args: readonly ToolArg[];
  /** Caller module, for tests / exotic toolchains. Defaults to the stack. */
  module?: string;
};

export type RegisteredTool = {
  name: string;
  title: string;
  hint: string;
  prefix: string;
  args: readonly ToolArg[];
  /**
   * The tool fn, invoked with the slot values it declared. Declared as a method
   * so a precisely-typed `(...args: A) => R` fn is assignable here without a
   * cast: method parameters compare bivariantly.
   */
  fn(...values: SceneValue[]): SceneValue;
  /** Vite-root URL pathname (dev) or absolute path (node/tests). */
  module: string;
};

/** Per-arg session state: what was typed, or what a gesture resolved to. */
export type CompositeFill =
  | { kind: "text"; raw: string }
  | {
      /** A gesture (click) resolved this arg. `at`/`value` cache concrete values for ghost/measure. */
      kind: "expr";
      expr: Expr;
      at?: Vec2;
      value?: number;
    };

export type FieldKind = "number" | "ident" | "ref" | "length";

/** One Tab stop. Declared on the verb; the dispatcher only cycles/types. */
export type Field<S extends ToolSession = ToolSession> = {
  id: string;
  kind: FieldKind;
  placeholder: string;
  /** For `ref`: existing point vs line/segment/parallel vs circle vs region vs either point-or-circle operand. For `length`: slider bind. */
  looks?: "point" | "carrier" | "circle" | "region" | "operand" | "length";
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

/** One operand of the Tangent verb: a point the line passes through, or a circle it touches. */
export type TangentOp =
  | { kind: "point"; placed: Placed }
  | { kind: "circle"; circle: Scope["circles"][string] };

export type PlaceHit = {
  world: Vec2;
  point: PlacePoint;
  /** `key` is the snapped node's trace key (`id:occ`) — the exact occurrence. */
  carrier?: { bind: string; geom: LineLike | Circle; key?: string };
  region?: { bind: string; geom: Region; id?: string; key?: string };
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
  print?: (n: SnapNode) => string | undefined;
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
      verb: "tangent";
      focus: "a" | "b" | "name";
      /** Operands — each a point or a circle, either order. */
      a?: TangentOp;
      b?: TangentOp;
      aRef: string;
      bRef: string;
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
    }
  | {
      /** Registered user tool; `tool.name` is the palette id / callee. */
      verb: "composite";
      tool: RegisteredTool;
      /** Focused arg label (or `"name"`). */
      focus: string;
      fills: Record<string, CompositeFill>;
      name: string;
    };

export type Ghost =
  | { kind: "point"; at: Vec2 }
  | { kind: "corner"; at: Vec2 }
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "line" | "segment"; a: Vec2; b: Vec2 }
  | {
      /**
       * Candidate tangent strokes of the Tangent verb. Each stroke runs
       * between its two contact endpoints; the view clips it to the pane.
       * `chosen` (index into `strokes`) is drawn at full strength, the rest
       * dimmed — the user clicks a stroke to commit that candidate.
       */
      kind: "tangent";
      strokes: ReadonlyArray<{ a: Vec2; b: Vec2 }>;
      chosen: number;
    }
  | { kind: "parallelLine"; geom: LineLike; distance: number }
  | {
      kind: "region";
      edges: LoopEdge[];
      /** Disjoint closed walks; when set, fill/stroke do not chain islands. */
      loops?: Loop[];
      hover?: LoopEdge;
      arrow?: { at: Vec2; tx: number; ty: number };
    }
  | {
      /** Draft-evaluated trace of a registered tool; the view renders these muted. */
      kind: "trace";
      /** Unique per draft; view keys are `${stamp}:${key}` so they never collide with live ids. */
      stamp: string;
      nodes: TraceNode[];
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
    | "pointOnCircle"
    | "image";
  args: Expr[];
  bind?: string;
  patchVertex?: { id: string; index: number };
  /**
   * Present on registered-tool inserts: `from` is the registered name (not a
   * constructor), `module` is where to import it from (server maps it to a
   * relative specifier), and `prefix` drives the fallback bind name.
   */
  tool?: { module: string; prefix: string };
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
