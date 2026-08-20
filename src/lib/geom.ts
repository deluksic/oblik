import type { Vec2 } from "./vec.ts";

export type Provenance = {
  file: string;
  line: number;
  column: number;
  createdBy: string;
};

type Base = {
  id: string;
  parentId: string | null;
  provenance: Provenance;
};

export type Point = Base & { kind: "point"; x: number; y: number };
export type Line = Base & { kind: "line"; a: Point; b: Point };
export type Circle = Base & { kind: "circle"; center: Point; radius: number };
export type Polyline = Base & { kind: "polyline"; points: Point[] };
export type Group = Base & { kind: "group"; children: Geom[] };
export type Geom = Point | Line | Circle | Polyline | Group;

const counts = new Map<string, number>();
let currentParent: string | null = null;

export function beginGeomFrame(): void {
  counts.clear();
  currentParent = null;
}

function nextIndex(kind: string): number {
  const key = `${currentParent ?? ""}::${kind}`;
  const n = counts.get(key) ?? 0;
  counts.set(key, n + 1);
  return n;
}

function makeId(kind: string, index: number): string {
  const local = `${kind}[${index}]`;
  return currentParent ? `${currentParent}/${local}` : local;
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
  const index = nextIndex(kind);
  return {
    id: makeId(kind, index),
    parentId: currentParent,
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
  const index = nextIndex("group");
  const id = makeId("group", index);
  const node: Group = {
    id,
    parentId: currentParent,
    provenance: captureProvenance("group"),
    kind: "group",
    children: [],
  };
  const prev = currentParent;
  currentParent = id;
  node.children = fn();
  currentParent = prev;
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

export function breadcrumb(id: string): string {
  return id.replaceAll("/", " › ");
}
