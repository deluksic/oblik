import type { Geom, Vec2 } from "../geom";
import type { Annotation } from "../source/analyze";
import type { ImageValue } from "./image";
import type { EvalMemo } from "./memo";
import type { FigureStyle, PaintValue } from "./paint";
import { $node } from "./site";
import type { CallSite } from "./stack";

export type SliderValue = {
  kind: "slider";
  n: number;
  min: number;
  max: number;
  step: number;
};

export type TraceValue = Geom | SliderValue | FigureStyle | PaintValue | ImageValue;

/**
 * Anything the app hands around as data: a recorded value, a plain
 * number/string/point/bag, or a list of those. Constructor arguments, `paint`
 * bags, `emit` values, memo fingerprints, tool arguments, drag payloads and
 * request bodies are all this one union, so a wrong argument is a compile error
 * at the call site instead of a NaN — or a crash — somewhere downstream.
 *
 * It is deliberately the same space as JSON, which is what lets a decoded
 * request body be typed with it and still be validated field by field.
 */
export type SceneBag = { readonly [key: string]: SceneValue };

export type SceneValue =
  | TraceValue
  | Vec2
  | number
  | string
  | boolean
  | null
  | undefined
  | readonly SceneValue[]
  | SceneBag;

/**
 * A scene value that is a named bag — not `null`, not an array, not a primitive.
 * Structural comparison and `Object.values` walks narrow through this, so the bag
 * arm of `SceneValue` never has to be re-asserted at each use.
 */
export function isSceneBag(value: SceneValue): value is SceneBag {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** What a scene's `build()` may return: a value, or nothing at all. */
export type SceneResult = SceneValue | void;

export type TraceInv = {
  file: string;
  name?: string;
  callerFile: string;
  callerLine: number;
  callerColumn: number;
  serial: number;
};

export type TraceNodeKind = TraceValue["kind"];

/** Fields every node carries, whatever value it records. */
type TraceNodeBase = {
  id: string;
  occ: number;
  bind?: string;
  editable: boolean;
  at?: { line: number; column: number };
  module?: string;
  stack: CallSite[];
  inv?: TraceInv;
};

type TraceNodeFor<K extends TraceNodeKind> = TraceNodeBase & {
  kind: K;
  value: Extract<TraceValue, { kind: K }>;
};

/**
 * A node whose `kind` and recorded `value` agree. Built as a union over the
 * kind, so checking `n.kind` narrows `n.value` with it — and so a node pairing
 * a circle value with `kind: "segment"` is not constructible at all.
 */
export type TraceNode = { [K in TraceNodeKind]: TraceNodeFor<K> }[TraceNodeKind];

/**
 * A node of a known kind: `TraceNodeOf<"circle">` has `value: Circle`. Assumes
 * no check — the caller states which kind it requires, so a dispatcher that
 * legitimately knows the kind needs no assertion, and a function that returns
 * one says so in its signature.
 */
export type TraceNodeOf<K extends TraceNodeKind> = Extract<TraceNode, { kind: K }>;

export type EvalCtx = {
  draft: Map<string, number[]>;
  trace: TraceNode[];
  annotations: Map<string, Annotation>;
  occ: Map<string, number>;
  module?: string;
  /** When false, constructors skip `captureUserStack` (live drag preview). */
  captureStack: boolean;
  /** Per-scene-module constructor memo. Ghost/tool evals leave it unset. */
  memo?: EvalMemo;
  stats: { built: number; hits: number };
  /** Call tallies for `memo(fn)` sites, reset per eval. */
  userMemoOcc?: Map<object, number>;
};

export type Traced<T> = T & { readonly [$node]: TraceNode };

let current: EvalCtx | undefined;

export function currentEval(): EvalCtx | undefined {
  return current;
}

export function withEval<T>(ctx: EvalCtx, fn: () => T): T {
  const prev = current;
  current = ctx;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

export function nodeOf<T>(value: T): TraceNode | undefined {
  if (!value || typeof value !== "object") return undefined;
  return (value as Traced<T>)[$node];
}

export function brand<T extends object>(value: T, node: TraceNode): Traced<T> {
  Object.defineProperty(value, $node, { value: node, enumerable: false });
  return value as Traced<T>;
}
