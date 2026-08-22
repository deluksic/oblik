import { captureCallSite } from "./provenance";

export type Provenance = {
  file: string;
  line: number;
  column: number;
  createdBy: string;
};

export type GeomSite = { file: string; line: number; column: number };

export type GeomSiteOpts = { file?: string; at?: [number, number] };

export function geomSiteFromOpts(opts?: GeomSiteOpts): GeomSite | undefined {
  if (!opts?.file || !opts.at || opts.at.length < 2) return undefined;
  const line = opts.at[0];
  const column = opts.at[1];
  if (typeof line !== "number" || typeof column !== "number") return undefined;
  return { file: opts.file, line, column };
}

export type Base = {
  /** Opaque pick identity — unique per geometric value this frame. */
  id: string;
  /** Human breadcrumb (group[0]/line[2]); groups namespace this, not id. */
  path: string;
  parentId: string | null;
  provenance: Provenance;
  /** Stable construction site when Vite injected `{ file, at }` on the scene call. */
  site?: GeomSite;
};

const pathCounts = new Map<string, number>();
let currentParentPath: string | null = null;
let currentParentId: string | null = null;

export function beginGeomFrame(): void {
  pathCounts.clear();
  currentParentPath = null;
  currentParentId = null;
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

export function makeBase(kind: string, createdBy: string, site?: GeomSite): Base {
  const local = nextPathLocal(kind);
  return {
    id: crypto.randomUUID(),
    path: makePath(local),
    parentId: currentParentId,
    provenance: site ? { ...site, createdBy } : captureProvenance(createdBy),
    site,
  };
}

export type Group = Base & { kind: "group"; children: unknown[] };

/** Optional path namespace. Does not affect pick identity. */
export function group<T>(fn: () => T[]): Group {
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
  node.children = fn();
  currentParentPath = prevPath;
  currentParentId = prevId;
  return node;
}

export function breadcrumb(path: string): string {
  return path.replaceAll("/", " › ");
}
