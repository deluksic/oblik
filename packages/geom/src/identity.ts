import { captureCallSite } from "./provenance";

export type Provenance = {
  file: string;
  line: number;
  column: number;
  createdBy: string;
};

export type Base = {
  /** Opaque pick identity — unique per geometric value this frame. */
  id: string;
  /** Human breadcrumb (group[0]/line[2]); groups namespace this, not id. */
  path: string;
  parentId: string | null;
  provenance: Provenance;
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

export function makeBase(kind: string, createdBy: string): Base {
  const local = nextPathLocal(kind);
  return {
    id: crypto.randomUUID(),
    path: makePath(local),
    parentId: currentParentId,
    provenance: captureProvenance(createdBy),
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
