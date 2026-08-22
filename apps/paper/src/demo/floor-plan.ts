import {
  add,
  arc,
  circle,
  mul,
  polyline,
  segment,
  type Geom,
  type Vec2,
} from "@design-scenes/geom";

export type Bounds = { min: Vec2; max: Vec2 };

export type FloorPlanOpts = {
  bounds: Bounds;
  wall: number;
  bedroomX: number;
  kitchenY: number;
  bathW: number;
  entry: { hinge: Vec2; width: number; swing: number };
  bedDoor: { hinge: Vec2; width: number; swing: number };
  bathDoor: { hinge: Vec2; width: number; swing: number };
  window: { center: Vec2; width: number };
  island: Vec2;
  drawerCount: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
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

function wallWithGaps(a: Vec2, b: Vec2, gaps: { t0: number; t1: number }[]): Geom[] {
  const spans = gaps
    .map((g) => ({ t0: Math.min(g.t0, g.t1), t1: Math.max(g.t0, g.t1) }))
    .sort((x, y) => x.t0 - y.t0);
  const parts: Geom[] = [];
  let t = 0;
  for (const gap of spans) {
    if (gap.t0 > t + 1e-4) {
      parts.push(
        segment(
          { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
          { x: a.x + (b.x - a.x) * gap.t0, y: a.y + (b.y - a.y) * gap.t0 },
        ),
      );
    }
    t = Math.max(t, gap.t1);
  }
  if (t < 1 - 1e-4) {
    parts.push(
      segment(
        { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        b,
      ),
    );
  }
  return parts;
}

function doorLeaf(hinge: Vec2, width: number, swing: number): Geom[] {
  const tip = {
    x: hinge.x + Math.cos(swing) * width,
    y: hinge.y + Math.sin(swing) * width,
  };
  const a0 = Math.atan2(hinge.y - tip.y, hinge.x - tip.x);
  return [segment(hinge, tip), arc(hinge, width, a0, swing)];
}

function windowMark(center: Vec2, width: number): Geom[] {
  const half = width / 2;
  const a = { x: center.x - half, y: center.y };
  const b = { x: center.x + half, y: center.y };
  return [segment(a, b), segment({ x: a.x, y: a.y - 0.05 }, { x: b.x, y: b.y - 0.05 })];
}

export function drawToilet(origin: Vec2, width = 0.4): Geom[] {
  const tank = rectRing(origin, { x: origin.x + width, y: origin.y + width * 0.55 });
  const bowl = { x: origin.x + width * 0.5, y: origin.y + width * 0.72 };
  return [tank, circle(bowl, width * 0.32), circle(bowl, width * 0.18)];
}

export function drawSink(origin: Vec2, width: number, depth: number): Geom[] {
  const basin = { x: origin.x + width * 0.55, y: origin.y + depth * 0.45 };
  return [rectRing(origin, { x: origin.x + width, y: origin.y + depth }), circle(basin, width * 0.2)];
}

export function drawShower(origin: Vec2, size: number): Geom[] {
  const max = { x: origin.x + size, y: origin.y + size };
  const drain = { x: origin.x + size * 0.5, y: origin.y + size * 0.35 };
  return [rectRing(origin, max), circle(drain, size * 0.05)];
}

export function drawBed(origin: Vec2, width: number, depth: number): Geom[] {
  const max = { x: origin.x + width, y: origin.y + depth };
  const pillowY = origin.y + depth * 0.78;
  return [
    rectRing(origin, max),
    segment({ x: origin.x, y: pillowY }, { x: max.x, y: pillowY }),
  ];
}

export function drawDrawers(origin: Vec2, width: number, depth: number, drawers: number): Geom[] {
  const max = { x: origin.x + width, y: origin.y + depth };
  const n = Math.max(2, Math.round(drawers));
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
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const chair = add(center, mul({ x: Math.cos(a), y: Math.sin(a) }, r + 0.32));
    parts.push(rectRing({ x: chair.x - 0.2, y: chair.y - 0.18 }, { x: chair.x + 0.2, y: chair.y + 0.18 }));
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
    parts.push(
      circle({ x: origin.x + width * b.x, y: origin.y + depth * b.y }, width * 0.1),
    );
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
    rectRing(origin, { x: origin.x + width, y: origin.y + depth * 0.72 }),
    rectRing(
      { x: origin.x, y: origin.y + depth * 0.62 },
      { x: origin.x + width, y: origin.y + depth },
    ),
  ];
}

export function drawIsland(center: Vec2, width: number, depth: number): Geom[] {
  const min = { x: center.x - width / 2, y: center.y - depth / 2 };
  return [rectRing(min, { x: min.x + width, y: min.y + depth })];
}

export function drawFloorPlan(opts: FloorPlanOpts): Geom[] {
  const { min, max } = opts.bounds;
  const w = opts.wall;
  const bedX = opts.bedroomX;
  const kY = opts.kitchenY;
  const bathX = max.x - opts.bathW;
  const spanX = max.x - min.x;
  const spanBedY = max.y - kY;
  const spanBathY = kY - min.y;

  const outer: Geom[] = [
    ...wallWithGaps(min, { x: max.x, y: min.y }, [
      { t0: 0.14, t1: 0.14 + opts.entry.width / spanX },
    ]),
    segment({ x: max.x, y: min.y }, max),
    ...wallWithGaps({ x: max.x, y: max.y }, min, [
      { t0: 0.22, t1: 0.22 + opts.window.width / spanX },
    ]),
    segment(min, { x: min.x, y: max.y }),
  ];

  const interior: Geom[] = [
    ...wallWithGaps({ x: bedX, y: kY }, max, [
      { t0: 0.38, t1: 0.38 + opts.bedDoor.width / spanBedY },
    ]),
    segment({ x: min.x, y: kY }, { x: bathX, y: kY }),
    ...wallWithGaps({ x: bathX, y: min.y }, { x: bathX, y: kY }, [
      { t0: 0.42, t1: 0.42 + opts.bathDoor.width / spanBathY },
    ]),
  ];

  const livingW = bedX - min.x - w * 3;
  const livingD = max.y - kY - w * 3;
  const bedW = max.x - bedX - w * 3;
  const bedD = max.y - kY - w * 3;
  const kitchenW = bathX - min.x - w * 2;

  const livingC = { x: min.x + livingW / 2 + w * 1.5, y: kY + livingD / 2 + w * 1.5 };

  const fixtures: Geom[] = [
    ...drawSofa({ x: min.x + w * 1.5, y: kY + w * 1.5 }, clamp(livingW * 0.75, 1.8, 2.4), 0.85),
    ...drawDiningTable(livingC, clamp(Math.min(livingW, livingD) * 0.35, 0.9, 1.2)),
    ...drawBed(
      { x: bedX + w * 1.5, y: kY + w * 1.5 },
      clamp(bedW * 0.72, 1.3, 1.6),
      clamp(bedD * 0.68, 1.7, 2),
    ),
    ...drawDrawers(
      { x: max.x - w * 1.5 - 0.9, y: kY + w * 1.5 },
      0.9,
      clamp(bedD * 0.42, 1, 1.25),
      opts.drawerCount,
    ),
    ...drawStove({ x: min.x + w * 1.2, y: min.y + w * 1.2 }, clamp(kitchenW * 0.14, 0.6, 0.75)),
    ...drawFridge(
      { x: min.x + w * 1.2, y: min.y + w * 1.2 + 0.85 },
      clamp(kitchenW * 0.12, 0.55, 0.65),
      clamp(kitchenD - w * 2.4, 0.75, 0.95),
    ),
    ...drawIsland(opts.island, 1.1, 0.65),
    ...drawToilet({ x: bathX + w * 1.1, y: min.y + w * 1.1 }),
    ...drawSink({ x: bathX + w * 1.1 + 0.48, y: min.y + w * 1.1 }, 0.58, 0.44),
    ...drawShower({ x: max.x - w * 1.1 - 0.9, y: min.y + w * 1.1 }, 0.9),
  ];

  const doors: Geom[] = [
    ...doorLeaf(opts.entry.hinge, opts.entry.width, opts.entry.swing),
    ...doorLeaf(opts.bedDoor.hinge, opts.bedDoor.width, opts.bedDoor.swing),
    ...doorLeaf(opts.bathDoor.hinge, opts.bathDoor.width, opts.bathDoor.swing),
  ];

  return [
    ...outer,
    ...interior,
    ...fixtures,
    ...doors,
    ...windowMark(opts.window.center, opts.window.width),
  ];
}
