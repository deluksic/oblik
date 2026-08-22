import { captureCallSite } from "./provenance";

export type Provenance = {
  file: string;
  line: number;
  column: number;
  createdBy: string;
};

export type GeomSite = { file: string; line: number; column: number };

export type GeomAnnotations = {
  file?: string;
  at?: [number, number];
  editable?: boolean;
};

export type GeomSiteOpts = {
  file?: string;
  at?: [number, number];
  editable?: boolean;
  __annotations__?: GeomAnnotations;
};

function annotationsOf(opts?: GeomSiteOpts): GeomAnnotations | undefined {
  if (!opts) return undefined;
  const a = opts.__annotations__;
  return {
    file: a?.file ?? opts.file,
    at: a?.at ?? opts.at,
    editable: a?.editable ?? opts.editable,
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
  /** Opaque pick identity — unique per geometric value this frame. */
  id: string;
  /** Human breadcrumb (group[0]/line[2]); groups namespace this, not id. */
  path: string;
  parentId: string | null;
  provenance: Provenance;
  /** Stable construction site when the call-site annotator injected `__annotations__`. */
  site?: GeomSite;
  /** True when this constructor owns numeric literals in source. */
  editable?: boolean;
};

const pathCounts = new Map<string, number>();
let currentParentPath: string | null = null;
let currentParentId: string | null = null;
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

export function beginGeomFrame(): void {
  pathCounts.clear();
  currentParentPath = null;
  currentParentId = null;
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

function nextPathLocal(kind: string): string {
  const key = `${currentParentPath ?? ""}::${kind}`;
  const n = pathCounts.get(key) ?? 0;
  pathCounts.set(key, n + 1);
  return `${kind}[${n}]`;
}

function makePath(local: string): string {
  return currentParentPath ? `${currentParentPath}/${local}` : local;
}

function captureProvenance(createdBy: string): Provenance {
  const site = captureCallSite();
  return { ...site, createdBy };
}

export function makeBase(kind: string, createdBy: string, site?: GeomSite, editable?: boolean): Base {
  const local = nextPathLocal(kind);
  return {
    id: crypto.randomUUID(),
    path: makePath(local),
    parentId: currentParentId,
    provenance: site ? { ...site, createdBy } : captureProvenance(createdBy),
    site,
    editable,
  };
}

export type Group = Base & { kind: "group"; children: unknown[] };

/** Optional path namespace. Does not affect pick identity. */
export function group<T>(fn: () => T[] | void): Group {
  const local = nextPathLocal("group");
  const path = makePath(local);
  const id = crypto.randomUUID();
  const node: Group = {
    id,
    path,
    parentId: currentParentId,
    provenance: captureProvenance("group"),
    kind: "group",
    children: [],
  };
  const prevPath = currentParentPath;
  const prevId = currentParentId;
  currentParentPath = path;
  currentParentId = id;
  node.children = fn() ?? [];
  currentParentPath = prevPath;
  currentParentId = prevId;
  return node;
}

export function breadcrumb(path: string): string {
  return path.replaceAll("/", " › ");
}
