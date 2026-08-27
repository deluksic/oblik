import type { Geom } from "../geom";
import type { Annotation } from "../source/analyze";
import type { CallSite } from "./stack";
import { $node } from "./site";
import type { FigureStyle, PaintValue } from "./paint";

export type SliderValue = {
  kind: "slider";
  n: number;
  min: number;
  max: number;
  step: number;
};

export type TraceValue = Geom | SliderValue | FigureStyle | PaintValue;

export type TraceInv = {
  file: string;
  name?: string;
  callerFile: string;
  callerLine: number;
  callerColumn: number;
  serial: number;
};

export type TraceNode = {
  id: string;
  occ: number;
  kind: TraceValue["kind"];
  value: TraceValue;
  bind?: string;
  editable: boolean;
  at?: { line: number; column: number };
  module?: string;
  stack: CallSite[];
  inv?: TraceInv;
};

export type EvalCtx = {
  draft: Map<string, number[]>;
  trace: TraceNode[];
  annotations: Map<string, Annotation>;
  occ: Map<string, number>;
  module?: string;
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
