import type { Vec2 } from "./vec.ts";

export type Provenance = {
  file: string;
  line: number;
  column: number;
  createdBy: string;
};

type Base = {
  /** Opaque pick identity — unique per geometric value. */
  id: string;
  /** Human breadcrumb path (group[0]/line[2]); not used for picking. */
  path: string;
  parentId: string | null;
  provenance: Provenance;
};

export type Point = Base & { kind: "point"; x: number; y: number };
export type Line = Base & { kind: "line"; a: Point; b: Point };
export type Circle = Base & { kind: "circle"; center: Point; radius: number };
export type Polyline = Base & { kind: "polyline"; points: Point[] };
export type Group = Base & { kind: "group"; children: Geom[] };
export type Geom = Point | Line | Circle | Polyline | Group;

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
  const stack = new Error().stack ?? "";
  for (const raw of stack.split("\n")) {
    // Vite stacks look like: .../mark.ts?t=1739:25:18
    const line = raw.replace(/\.(tsx?|jsx?|mjs)\?[^:]*:/, ".$1:");
    const m = line.match(
      /(?:https?:\/\/[^/]+\/)?([^:\s)]+\.(?:ts|tsx|js|mjs)):(\d+):(\d+)/,
    );
    if (!m?.[1] || !m[2] || !m[3]) continue;
    const file = m[1].replace(/^\//, "");
    if (
      file.endsWith("/lib/geom.ts") ||
      file.endsWith("/lib/vec.ts") ||
      file.includes("/euclid2/") ||
      file.endsWith("/main.ts")
    ) {
      continue;
    }
    return {
      file,
      line: Number(m[2]),
      column: Number(m[3]),
      createdBy,
    };
  }
  return { file: "unknown", line: 0, column: 0, createdBy };
}

function base(kind: string, createdBy: string): Base {
  const local = nextPathLocal(kind);
  return {
    id: crypto.randomUUID(),
    path: makePath(local),
    parentId: currentParentId,
    provenance: captureProvenance(createdBy),
  };
}

export function point(x: number, y: number): Point {
  return { ...base("point", "point"), kind: "point", x, y };
}

export function line(a: Vec2, b: Vec2): Line {
  return {
    ...base("line", "line"),
    kind: "line",
    a: point(a.x, a.y),
    b: point(b.x, b.y),
  };
}

export function circle(center: Vec2, radius: number): Circle {
  return {
    ...base("circle", "circle"),
    kind: "circle",
    center: point(center.x, center.y),
    radius,
  };
}

export function polyline(points: Vec2[]): Polyline {
  return {
    ...base("polyline", "polyline"),
    kind: "polyline",
    points: points.map((p) => point(p.x, p.y)),
  };
}

export function group(fn: () => Geom[]): Group {
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

export type Drawable =
  | { geom: Point }
  | { geom: Line }
  | { geom: Circle }
  | { geom: Polyline };

export function flatten(geom: Geom | Geom[]): Drawable[] {
  const out: Drawable[] = [];
  const walk = (g: Geom) => {
    switch (g.kind) {
      case "group":
        for (const c of g.children) walk(c);
        break;
      case "point":
        out.push({ geom: g });
        break;
      case "line":
        out.push({ geom: g });
        break;
      case "circle":
        out.push({ geom: g });
        break;
      case "polyline":
        out.push({ geom: g });
        break;
    }
  };
  if (Array.isArray(geom)) {
    for (const g of geom) walk(g);
  } else {
    walk(geom);
  }
  return out;
}

export function breadcrumb(path: string): string {
  return path.replaceAll("/", " › ");
}
