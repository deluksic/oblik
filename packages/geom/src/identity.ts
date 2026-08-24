import { captureUserStack, type CallSite } from "./provenance";

export type { CallSite };

export type Provenance = CallSite & {
  createdBy: string;
  /** User frames, innermost (the helper that called the constructor) first. */
  stack: CallSite[];
};

export type GeomSite = { file: string; line: number; column: number };

export type GeomAnnotations = {
  file?: string;
  at?: [number, number];
  editable?: boolean;
  bind?: string;
  /** Reserved; unused until loop disambiguation. */
  key?: string;
};

export type LineDash = "solid" | "dashed" | "dotted";

export type LineStyle = {
  color?: string;
  width?: number;
  dash?: LineDash;
};

export type PointStyle = {
  color?: string;
  size?: number;
};

/** Constructor ink. Missing means the object uses the view default. */
export type GeomStyle = {
  line?: LineStyle;
  point?: PointStyle;
};

export type GeomSiteOpts = {
  file?: string;
  at?: [number, number];
  editable?: boolean;
  bind?: string;
  /** Reserved; unused until loop disambiguation. */
  key?: string;
  style?: GeomStyle;
  __annotations__?: GeomAnnotations;
};

function annotationsOf(opts?: GeomSiteOpts): GeomAnnotations | undefined {
  if (!opts) return undefined;
  const a = opts.__annotations__;
  return {
    file: a?.file ?? opts.file,
    at: a?.at ?? opts.at,
    editable: a?.editable ?? opts.editable,
    bind: a?.bind ?? opts.bind,
    key: a?.key ?? opts.key,
  };
}

export function geomSiteFromOpts(opts?: GeomSiteOpts): GeomSite | undefined {
  const a = annotationsOf(opts);
  if (!a?.file || !a.at || a.at.length < 2) return undefined;
  const line = a.at[0];
  const column = a.at[1];
  if (typeof line !== "number" || typeof column !== "number") return undefined;
  return { file: a.file, line, column };
}

export function geomEditableFromOpts(opts?: GeomSiteOpts): boolean {
  return annotationsOf(opts)?.editable === true;
}

export function geomBindFromOpts(opts?: GeomSiteOpts): string | undefined {
  const bind = annotationsOf(opts)?.bind;
  return bind && bind.length > 0 ? bind : undefined;
}

export function geomStyleFromOpts(opts?: GeomSiteOpts): GeomStyle | undefined {
  const s = opts?.style;
  if (!s || typeof s !== "object") return undefined;
  if (!hasStoredStyle(s)) return undefined;
  return s;
}

export function hasStoredStyle(style: GeomStyle | null | undefined): boolean {
  if (!style) return false;
  const line = style.line;
  const point = style.point;
  return !!(
    (line && (line.color != null || line.width != null || line.dash != null)) ||
    (point && (point.color != null || point.size != null))
  );
}

export type GeomLiveReader = (site: GeomSite) => number[] | undefined;

let liveReader: GeomLiveReader | null = null;

/** Host overlay for live widget drags. geom stays gizmo-free. */
export function setGeomLiveReader(reader: GeomLiveReader | null): void {
  liveReader = reader;
}

export function geomLiveValues(site: GeomSite | undefined): number[] | undefined {
  if (!site || !liveReader) return undefined;
  return liveReader(site);
}

export type Base = {
  /**
   * Sticky pick key this program shape.
   * Annotated: `file:line:column#bind` or `file:line:column#k`.
   * Unannotated: `kind#bind` or `kind#k`.
   */
  id: string;
  /** Const binding that owned this construction, when known. */
  bind?: string;
  provenance: Provenance;
  /** Write target when the call-site annotator injected `__annotations__`. */
  site?: GeomSite;
  /** True when this constructor owns numeric literals in source. */
  editable?: boolean;
  /** Constructor ink from `{ style }` on the call. Omitted → view default. */
  style?: GeomStyle;
};

const occurrence = new Map<string, number>();
const bindStack: string[] = [];
let constructDepth = 0;
let drawSilent = 0;
const frameGeoms: unknown[] = [];

const DRAWN_KINDS = new Set([
  "point",
  "segment",
  "line",
  "circle",
  "arc",
  "polyline",
  "point3",
  "segment3",
  "circle3",
  "box3",
  "cylinder3",
  "mesh3",
]);

export function resetIdentity(): void {
  occurrence.clear();
  bindStack.length = 0;
}

export function currentBind(): string | undefined {
  return bindStack.at(-1);
}

/** Push a const name so nested constructors inherit it. Pair with `popBind`. */
export function pushBind(name: string): void {
  bindStack.push(name);
}

/** Pop the bind stack and return `value` (comma-operator form in the annotator). */
export function popBind<T>(value: T): T {
  bindStack.pop();
  return value;
}

export function withBind<T>(name: string, fn: () => T): T {
  pushBind(name);
  try {
    return fn();
  } finally {
    bindStack.pop();
  }
}

/**
 * Pick id for this evaluate. A unique bind at an origin is `origin#bind`.
 * A second construction with the same bind at the same origin (wall spans
 * under `const south = wallRun(…)`, a helper called twice) keeps the bind
 * and suffixes occurrence so `collectDrawables` does not drop the extra ink.
 */
export function allocId(origin: string, bind?: string): string {
  const label = bind || currentBind();
  const key = label ? `${origin}#${label}` : origin;
  const n = occurrence.get(key) ?? 0;
  occurrence.set(key, n + 1);
  if (label) return n === 0 ? key : `${key}#${n}`;
  return `${origin}#${n}`;
}

export function beginGeomFrame(): void {
  resetIdentity();
  constructDepth = 0;
  frameGeoms.length = 0;
}

/** Skip drawing (widgets). */
export function withoutDraw<T>(fn: () => T): T {
  drawSilent += 1;
  try {
    return fn();
  } finally {
    drawSilent -= 1;
  }
}

/** Register a constructor result unless nested inside another constructor or `withoutDraw`. */
export function constructGeom<T>(fn: () => T): T {
  constructDepth += 1;
  try {
    const v = fn();
    if (constructDepth === 1 && drawSilent === 0 && isDrawnKind(v)) {
      frameGeoms.push(v);
    }
    return v;
  } finally {
    constructDepth -= 1;
  }
}

function isDrawnKind(v: unknown): boolean {
  if (!v || typeof v !== "object" || !("kind" in v)) return false;
  return DRAWN_KINDS.has((v as { kind: string }).kind);
}

export function takeFrameGeoms(): unknown[] {
  return frameGeoms.slice();
}

function captureProvenance(createdBy: string, site?: GeomSite): Provenance {
  const stack = captureUserStack();
  const leaf = stack[0] ?? { file: "unknown", line: 0, column: 0 };
  const loc = site ?? leaf;
  return {
    file: loc.file,
    line: loc.line,
    column: loc.column,
    createdBy,
    stack: stack.length > 0 ? stack : [leaf],
  };
}

export function makeBase(
  kind: string,
  createdBy: string,
  site?: GeomSite,
  editable?: boolean,
  bind?: string,
  style?: GeomStyle,
): Base {
  const label = bind || currentBind();
  const origin = site ? `${site.file}:${site.line}:${site.column}` : kind;
  return {
    id: allocId(origin, label),
    ...(label ? { bind: label } : {}),
    provenance: captureProvenance(createdBy, site),
    site,
    editable,
    ...(style && hasStoredStyle(style) ? { style } : {}),
  };
}
