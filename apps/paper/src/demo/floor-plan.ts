import {
  add,
  arc,
  circle,
  mul,
  polyline,
  segment,
  sweepCCW,
  type Geom,
  type Vec2,
} from "@design-scenes/geom";


const { PI, cos, max, min, round, sin, sqrt } = Math;
export type Bounds = { min: Vec2; max: Vec2 };

export type Opening = {
  hinge: Vec2;
  width: number;
  /** Leaf angle, radians CCW from +X. */
  swing: number;
  /** Closed door along the wall, radians CCW from +X. */
  closed: number;
};

export type FloorPlanOpts = {
  bounds: Bounds;
  wall: number;
  bedroomX: number;
  kitchenY: number;
  bathW: number;
  entry: Opening;
  bedDoor: Opening;
  bathDoor: Opening;
  window: { center: Vec2; width: number };
  island: Vec2;
  drawerCount: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return min(hi, max(lo, v));
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function tAlong(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

function rectRing(min: Vec2, max: Vec2): Geom {
  return polyline([
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y },
    { x: min.x, y: min.y },
  ]);
}

/** Axis-aligned or free wall as a thick box, with gaps in parameter t ∈ [0, 1]. */
function wallRun(a: Vec2, b: Vec2, thickness: number, gaps: { t0: number; t1: number }[]): Geom[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = sqrt((dx) * (dx) + (dy) * (dy));
  if (len < 1e-9) return [];
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  const spans = gaps
    .map((g) => ({
      t0: clamp(min(g.t0, g.t1), 0, 1),
      t1: clamp(max(g.t0, g.t1), 0, 1),
    }))
    .filter((g) => g.t1 - g.t0 > 1e-4)
    .toSorted((x, y) => x.t0 - y.t0);

  const box = (p: Vec2, q: Vec2): Geom =>
    polyline([
      { x: p.x + nx, y: p.y + ny },
      { x: q.x + nx, y: q.y + ny },
      { x: q.x - nx, y: q.y - ny },
      { x: p.x - nx, y: p.y - ny },
      { x: p.x + nx, y: p.y + ny },
    ]);

  const parts: Geom[] = [];
  let t = 0;
  for (const g of spans) {
    if (g.t0 > t + 1e-4) parts.push(box(lerp(a, b, t), lerp(a, b, g.t0)));
    t = max(t, g.t1);
  }
  if (t < 1 - 1e-4) parts.push(box(lerp(a, b, t), b));
  return parts;
}

function gapFromHinge(a: Vec2, b: Vec2, hinge: Vec2, width: number, closed: number): {
  t0: number;
  t1: number;
} {
  const end = {
    x: hinge.x + cos(closed) * width,
    y: hinge.y + sin(closed) * width,
  };
  return { t0: tAlong(a, b, hinge), t1: tAlong(a, b, end) };
}

function gapFromCenter(a: Vec2, b: Vec2, center: Vec2, width: number, along: number): {
  t0: number;
  t1: number;
} {
  const half = width / 2;
  const p0 = { x: center.x - cos(along) * half, y: center.y - sin(along) * half };
  const p1 = { x: center.x + cos(along) * half, y: center.y + sin(along) * half };
  return { t0: tAlong(a, b, p0), t1: tAlong(a, b, p1) };
}

function doorLeaf(opening: Opening, inset: Vec2): Geom[] {
  const hinge = { x: opening.hinge.x + inset.x, y: opening.hinge.y + inset.y };
  const w = opening.width;
  const tip = {
    x: hinge.x + cos(opening.swing) * w,
    y: hinge.y + sin(opening.swing) * w,
  };
  const ccw = sweepCCW(opening.closed, opening.swing);
  const a0 = ccw <= PI ? opening.closed : opening.swing;
  const a1 = ccw <= PI ? opening.swing : opening.closed;
  return [segment(hinge, tip), arc(hinge, w, a0, a1)];
}

function windowSill(center: Vec2, width: number, inward: Vec2): Geom[] {
  const half = width / 2;
  const a = { x: center.x - half, y: center.y };
  const b = { x: center.x + half, y: center.y };
  const innerA = { x: a.x + inward.x, y: a.y + inward.y };
  const innerB = { x: b.x + inward.x, y: b.y + inward.y };
  return [segment(a, b), segment(innerA, innerB), segment(a, innerA), segment(b, innerB)];
}

export function drawToilet(origin: Vec2, width = 0.4): Geom[] {
  const tank = rectRing(origin, { x: origin.x + width, y: origin.y + width * 0.5 });
  const bowl = { x: origin.x + width * 0.5, y: origin.y + width * 0.78 };
  return [tank, circle(bowl, width * 0.32)];
}

export function drawSink(origin: Vec2, width: number, depth: number): Geom[] {
  const basin = { x: origin.x + width * 0.5, y: origin.y + depth * 0.5 };
  return [rectRing(origin, { x: origin.x + width, y: origin.y + depth }), circle(basin, width * 0.18)];
}

export function drawShower(origin: Vec2, size: number): Geom[] {
  const max = { x: origin.x + size, y: origin.y + size };
  return [rectRing(origin, max), circle({ x: origin.x + size * 0.5, y: origin.y + size * 0.5 }, size * 0.06)];
}

export function drawBed(origin: Vec2, width: number, depth: number): Geom[] {
  const max = { x: origin.x + width, y: origin.y + depth };
  const pillowY = origin.y + depth * 0.82;
  return [rectRing(origin, max), segment({ x: origin.x, y: pillowY }, { x: max.x, y: pillowY })];
}

export function drawDrawers(origin: Vec2, width: number, depth: number, drawers: number): Geom[] {
  const max = { x: origin.x + width, y: origin.y + depth };
  const n = max(2, round(drawers));
  const parts: Geom[] = [rectRing(origin, max)];
  for (let i = 1; i < n; i++) {
    const y = origin.y + (depth * i) / n;
    parts.push(segment({ x: origin.x, y }, { x: max.x, y }));
  }
  return parts;
}

export function drawDiningTable(center: Vec2, diameter: number): Geom[] {
  const r = diameter / 2;
  const parts: Geom[] = [circle(center, r)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    const chair = add(center, mul({ x: cos(a), y: sin(a) }, r + 0.3));
    parts.push(
      rectRing({ x: chair.x - 0.18, y: chair.y - 0.16 }, { x: chair.x + 0.18, y: chair.y + 0.16 }),
    );
  }
  return parts;
}

export function drawStove(origin: Vec2, width: number): Geom[] {
  const depth = width * 0.85;
  const parts: Geom[] = [rectRing(origin, { x: origin.x + width, y: origin.y + depth })];
  for (const b of [
    { x: 0.28, y: 0.32 },
    { x: 0.72, y: 0.32 },
    { x: 0.28, y: 0.68 },
    { x: 0.72, y: 0.68 },
  ]) {
    parts.push(circle({ x: origin.x + width * b.x, y: origin.y + depth * b.y }, width * 0.1));
  }
  return parts;
}

export function drawFridge(origin: Vec2, width: number, depth: number): Geom[] {
  const max = { x: origin.x + width, y: origin.y + depth };
  const seamY = origin.y + depth * 0.34;
  return [rectRing(origin, max), segment({ x: origin.x, y: seamY }, { x: max.x, y: seamY })];
}

export function drawSofa(origin: Vec2, width: number, depth: number): Geom[] {
  return [
    rectRing(origin, { x: origin.x + width, y: origin.y + depth * 0.7 }),
    rectRing({ x: origin.x, y: origin.y + depth * 0.62 }, { x: origin.x + width, y: origin.y + depth }),
  ];
}

export function drawIsland(center: Vec2, width: number, depth: number): Geom[] {
  const min = { x: center.x - width / 2, y: center.y - depth / 2 };
  return [rectRing(min, { x: min.x + width, y: min.y + depth })];
}

export function drawFloorPlan(opts: FloorPlanOpts): Geom[] {
  const { min, max } = opts.bounds;
  const w = max(0.06, opts.wall);
  const bedX = opts.bedroomX;
  const kY = opts.kitchenY;
  const bathX = max.x - opts.bathW;
  const h = w / 2;

  const sw = { x: min.x + h, y: min.y + h };
  const se = { x: max.x - h, y: min.y + h };
  const ne = { x: max.x - h, y: max.y - h };
  const nw = { x: min.x + h, y: max.y - h };

  const south = wallRun(sw, se, w, [gapFromHinge(sw, se, opts.entry.hinge, opts.entry.width, opts.entry.closed)]);
  const east = wallRun(se, ne, w, []);
  const north = wallRun(nw, ne, w, [
    gapFromCenter(nw, ne, opts.window.center, opts.window.width, 0),
  ]);
  const west = wallRun(sw, nw, w, []);

  const bedA = { x: bedX, y: kY };
  const bedB = { x: bedX, y: max.y - h };
  const bedroomWall = wallRun(bedA, bedB, w, [
    gapFromHinge(bedA, bedB, opts.bedDoor.hinge, opts.bedDoor.width, opts.bedDoor.closed),
  ]);

  const bathA = { x: bathX, y: min.y + h };
  const bathB = { x: bathX, y: kY };
  const bathWall = wallRun(bathA, bathB, w, [
    gapFromHinge(bathA, bathB, opts.bathDoor.hinge, opts.bathDoor.width, opts.bathDoor.closed),
  ]);

  const kWest = { x: min.x + h, y: kY };
  const kEast = { x: max.x - h, y: kY };
  const passW = 1.15;
  const passEnd = min(bedX, bathX);
  const passGap = {
    t0: tAlong(kWest, kEast, { x: passEnd - passW - 0.25, y: kY }),
    t1: tAlong(kWest, kEast, { x: passEnd - 0.25, y: kY }),
  };
  const kitchenWall = wallRun(kWest, kEast, w, [passGap]);

  const living = {
    min: { x: min.x + w, y: kY + w },
    max: { x: bedX - h, y: max.y - w },
  };
  const bedroom = {
    min: { x: bedX + h, y: kY + w },
    max: { x: max.x - w, y: max.y - w },
  };
  const kitchen = {
    min: { x: min.x + w, y: min.y + w },
    max: { x: bathX - h, y: kY - h },
  };
  const bath = {
    min: { x: bathX + h, y: min.y + w },
    max: { x: max.x - w, y: kY - h },
  };

  const livingW = living.max.x - living.min.x;
  const livingD = living.max.y - living.min.y;
  const bedW = bedroom.max.x - bedroom.min.x;
  const bedD = bedroom.max.y - bedroom.min.y;
  const kitW = kitchen.max.x - kitchen.min.x;
  const kitD = kitchen.max.y - kitchen.min.y;
  const bathW = bath.max.x - bath.min.x;
  const bathD = bath.max.y - bath.min.y;

  const sofaW = clamp(livingW * 0.62, 1.6, 2.4);
  const tableR = clamp(min(livingW, livingD) * 0.28, 0.85, 1.15);
  const mattressW = clamp(bedW * 0.72, 1.2, 1.6);
  const mattressD = clamp(bedD * 0.62, 1.6, 2.05);
  const dresserD = clamp(bedD * 0.4, 0.9, 1.2);
  const stoveW = clamp(kitW * 0.16, 0.55, 0.7);
  const fridgeW = clamp(kitW * 0.14, 0.5, 0.62);
  const fridgeD = clamp(kitD - stoveW * 0.85 - 0.2, 0.7, 0.95);
  const showerS = clamp(min(bathW, bathD) * 0.72, 0.8, 0.95);

  const fixtures: Geom[] = [
    ...drawSofa({ x: living.min.x + 0.12, y: living.min.y + 0.15 }, sofaW, 0.82),
    ...drawDiningTable(
      { x: living.min.x + livingW * 0.55, y: living.min.y + livingD * 0.55 },
      tableR,
    ),
    ...drawBed(
      { x: bedroom.min.x + 0.15, y: bedroom.max.y - mattressD - 0.12 },
      mattressW,
      mattressD,
    ),
    ...drawDrawers(
      { x: bedroom.max.x - 0.85, y: bedroom.min.y + 0.12 },
      0.72,
      dresserD,
      opts.drawerCount,
    ),
    ...drawStove({ x: kitchen.min.x + 0.08, y: kitchen.min.y + 0.08 }, stoveW),
    ...drawFridge({ x: kitchen.min.x + 0.08, y: kitchen.min.y + 0.08 + stoveW * 0.85 + 0.08 }, fridgeW, fridgeD),
    ...drawIsland(opts.island, 1.05, 0.6),
    ...drawToilet({ x: bath.min.x + 0.08, y: bath.min.y + 0.08 }),
    ...drawSink({ x: bath.min.x + 0.55, y: bath.min.y + 0.08 }, 0.55, 0.4),
    ...drawShower({ x: bath.max.x - showerS - 0.08, y: bath.min.y + 0.08 }, showerS),
  ];

  const doors: Geom[] = [
    ...doorLeaf(opts.entry, { x: 0, y: w }),
    ...doorLeaf(opts.bedDoor, { x: 0, y: 0 }),
    ...doorLeaf(opts.bathDoor, { x: 0, y: 0 }),
  ];

  return [
    ...south,
    ...east,
    ...north,
    ...west,
    ...bedroomWall,
    ...bathWall,
    ...kitchenWall,
    ...fixtures,
    ...doors,
    ...windowSill(opts.window.center, opts.window.width, { x: 0, y: -w }),
  ];
}
