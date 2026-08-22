import {
  add,
  arc,
  circle,
  mul,
  polyline,
  segment,
  sub,
  type Geom,
  type Vec2,
} from "@design-scenes/geom";

export type Bounds = { min: Vec2; max: Vec2 };

export type FloorPlanOpts = {
  bounds: Bounds;
  wall: number;
  /** Vertical partition between living and bedroom. */
  bedroomX: number;
  /** Horizontal partition above kitchen / bath row. */
  kitchenY: number;
  /** Bathroom width along the south edge. */
  bathW: number;
  entry: { hinge: Vec2; width: number; swing: number };
  bedDoor: { hinge: Vec2; width: number; swing: number };
  bathDoor: { hinge: Vec2; width: number; swing: number };
  window: { center: Vec2; width: number };
  island: Vec2;
  drawerCount: number;
};

function shift(p: Vec2, dx: number, dy: number): Vec2 {
  return { x: p.x + dx, y: p.y + dy };
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

/** Wall segment with one or more door gaps (t along the span, 0–1). */
function wallWithGaps(a: Vec2, b: Vec2, gaps: { t0: number; t1: number }[]): Geom[] {
  const spans = gaps
    .map((g) => ({
      t0: Math.min(g.t0, g.t1),
      t1: Math.max(g.t0, g.t1),
    }))
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
  const a1 = swing;
  return [segment(hinge, tip), arc(hinge, width, a0, a1)];
}

function windowMark(center: Vec2, width: number, along: Vec2): Geom[] {
  const dir = { x: along.x, y: along.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const u = { x: dir.x / len, y: dir.y / len };
  const n = { x: -u.y, y: u.x };
  const half = width / 2;
  const a = add(center, mul(u, -half));
  const b = add(center, mul(u, half));
  return [
    segment(a, b),
    segment(add(a, mul(n, 0.06)), add(b, mul(n, 0.06))),
    segment(add(a, mul(n, -0.06)), add(b, mul(n, -0.06))),
  ];
}

/** Tank + bowl + seat. */
export function drawToilet(origin: Vec2, width = 0.42): Geom[] {
  const d = width;
  const tank = rectRing(origin, { x: origin.x + d, y: origin.y + d * 0.55 });
  const bowlC = { x: origin.x + d * 0.5, y: origin.y + d * 0.72 };
  return [tank, circle(bowlC, d * 0.34), circle(bowlC, d * 0.2)];
}

/** Vanity rectangle with basin. */
export function drawSink(origin: Vec2, width: number, depth: number): Geom[] {
  const rim = rectRing(origin, { x: origin.x + width, y: origin.y + depth });
  const basin = {
    x: origin.x + width * 0.55,
    y: origin.y + depth * 0.45,
  };
  return [rim, circle(basin, Math.min(width, depth) * 0.22)];
}

/** Square tray with drain and corner caddy arcs. */
export function drawShower(origin: Vec2, size: number): Geom[] {
  const max = { x: origin.x + size, y: origin.y + size };
  const drain = { x: origin.x + size * 0.5, y: origin.y + size * 0.38 };
  return [
    rectRing(origin, max),
    circle(drain, size * 0.05),
    arc(max, size * 0.22, Math.PI, Math.PI * 1.5),
    segment(origin, { x: origin.x + size, y: origin.y }),
    segment({ x: origin.x, y: max.y }, max),
  ];
}

/** Mattress with pillow end caps. */
export function drawBed(origin: Vec2, width: number, depth: number): Geom[] {
  const max = { x: origin.x + width, y: origin.y + depth };
  const pillowY = origin.y + depth * 0.78;
  return [
    rectRing(origin, max),
    segment({ x: origin.x, y: pillowY }, { x: max.x, y: pillowY }),
    circle({ x: origin.x + width * 0.28, y: origin.y + depth * 0.89 }, width * 0.11),
    circle({ x: origin.x + width * 0.72, y: origin.y + depth * 0.89 }, width * 0.11),
  ];
}

/** Dresser with `drawers` horizontal slots. */
export function drawDrawers(origin: Vec2, width: number, depth: number, drawers: number): Geom[] {
  const max = { x: origin.x + width, y: origin.y + depth };
  const n = Math.max(2, Math.round(drawers));
  const parts: Geom[] = [rectRing(origin, max)];
  for (let i = 1; i < n; i++) {
    const y = origin.y + (depth * i) / n;
    parts.push(segment({ x: origin.x, y }, { x: max.x, y }));
  }
  const knobX = origin.x + width * 0.86;
  for (let i = 0; i < n; i++) {
    const y = origin.y + (depth * (i + 0.5)) / n;
    parts.push(circle({ x: knobX, y }, width * 0.025));
  }
  return parts;
}

/** Round table with four chair footprints. */
export function drawDiningTable(center: Vec2, diameter: number): Geom[] {
  const r = diameter / 2;
  const parts: Geom[] = [circle(center, r)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const chair = add(center, { x: Math.cos(a) * (r + 0.38), y: Math.sin(a) * (r + 0.38) });
    parts.push(rectRing(shift(chair, -0.22, -0.2), shift(chair, 0.22, 0.2)));
  }
  return parts;
}

/** Four-burner cooktop. */
export function drawStove(origin: Vec2, width: number): Geom[] {
  const depth = width * 0.85;
  const max = { x: origin.x + width, y: origin.y + depth };
  const parts: Geom[] = [rectRing(origin, max)];
  const burners = [
    { x: 0.28, y: 0.32 },
    { x: 0.72, y: 0.32 },
    { x: 0.28, y: 0.68 },
    { x: 0.72, y: 0.68 },
  ];
  for (const b of burners) {
    parts.push(
      circle(
        { x: origin.x + width * b.x, y: origin.y + depth * b.y },
        width * 0.11,
      ),
    );
  }
  return parts;
}

/** Fridge box with freezer seam. */
export function drawFridge(origin: Vec2, width: number, depth: number): Geom[] {
  const max = { x: origin.x + width, y: origin.y + depth };
  const seamY = origin.y + depth * 0.34;
  return [
    rectRing(origin, max),
    segment({ x: origin.x, y: seamY }, { x: max.x, y: seamY }),
    segment(
      { x: origin.x + width * 0.82, y: origin.y + depth * 0.12 },
      { x: origin.x + width * 0.82, y: seamY - depth * 0.05 },
    ),
    segment(
      { x: origin.x + width * 0.82, y: seamY + depth * 0.08 },
      { x: origin.x + width * 0.82, y: max.y - depth * 0.08 },
    ),
  ];
}

/** Simple sofa: seat + back. */
export function drawSofa(origin: Vec2, width: number, depth: number): Geom[] {
  const seat = rectRing(origin, { x: origin.x + width, y: origin.y + depth * 0.72 });
  const back = rectRing(
    { x: origin.x, y: origin.y + depth * 0.62 },
    { x: origin.x + width, y: origin.y + depth },
  );
  return [seat, back];
}

/** Kitchen island counter. */
export function drawIsland(center: Vec2, width: number, depth: number): Geom[] {
  const min = { x: center.x - width / 2, y: center.y - depth / 2 };
  return [rectRing(min, { x: min.x + width, y: min.y + depth })];
}

function roomLabel(center: Vec2, cross: number): Geom[] {
  const h = mul({ x: 1, y: 0 }, cross);
  const v = mul({ x: 0, y: 1 }, cross);
  return [segment(sub(center, h), add(center, h)), segment(sub(center, v), add(center, v))];
}

export function drawFloorPlan(opts: FloorPlanOpts): Geom[] {
  const { min, max } = opts.bounds;
  const w = opts.wall;
  const bathX = max.x - opts.bathW;
  const kY = opts.kitchenY;
  const bedX = opts.bedroomX;

  const outer: Geom[] = [
    ...wallWithGaps(
      min,
      { x: max.x, y: min.y },
      [{ t0: 0.14, t1: 0.14 + opts.entry.width / (max.x - min.x) }],
    ),
    segment({ x: max.x, y: min.y }, { x: max.x, y: max.y }),
    ...wallWithGaps(
      { x: max.x, y: max.y },
      min,
      [
        {
          t0: 0.22,
          t1: 0.22 + opts.window.width / (max.x - min.x),
        },
      ],
    ),
    segment(min, { x: min.x, y: max.y }),
  ];

  const interior: Geom[] = [
    ...wallWithGaps(
      { x: bedX, y: kY },
      { x: bedX, y: max.y },
      [{ t0: 0.38, t1: 0.38 + opts.bedDoor.width / (max.y - kY) }],
    ),
    segment({ x: min.x, y: kY }, { x: bathX, y: kY }),
    ...wallWithGaps(
      { x: bathX, y: min.y },
      { x: bathX, y: kY },
      [{ t0: 0.42, t1: 0.42 + opts.bathDoor.width / (kY - min.y) }],
    ),
  ];

  const livingC = {
    x: (min.x + bedX) / 2,
    y: (kY + max.y) / 2,
  };
  const bedC = {
    x: (bedX + max.x) / 2,
    y: (kY + max.y) / 2,
  };
  const kitchenC = {
    x: (min.x + bathX) / 2,
    y: (min.y + kY) / 2,
  };

  const fixtures: Geom[] = [
    ...drawSofa(
      { x: min.x + w * 2.2, y: kY + w * 2 },
      Math.min(2.6, bedX - min.x - w * 3),
      0.95,
    ),
    ...drawDiningTable(livingC, 1.15),
    ...drawBed(
      { x: bedX + w * 1.4, y: kY + w * 1.6 },
      Math.min(1.6, max.x - bedX - w * 2.5),
      Math.min(2.05, max.y - kY - w * 2.5),
    ),
    ...drawDrawers(
      { x: max.x - w * 2.8, y: kY + w * 1.5 },
      0.95,
      1.35,
      opts.drawerCount,
    ),
    ...drawStove({ x: min.x + w * 1.2, y: min.y + w * 1.1 }, 0.72),
    ...drawFridge({ x: min.x + w * 1.2, y: min.y + w * 1.1 + 0.95 }, 0.62, 0.95),
    ...drawIsland(opts.island, 1.35, 0.78),
    ...drawToilet({ x: bathX + w * 1.1, y: min.y + w * 1.1 }),
    ...drawSink({ x: bathX + w * 1.1 + 0.55, y: min.y + w * 1.1 }, 0.62, 0.48),
    ...drawShower({ x: max.x - w * 1.1 - 0.95, y: min.y + w * 1.1 }, 0.95),
  ];

  const doors: Geom[] = [
    ...doorLeaf(opts.entry.hinge, opts.entry.width, opts.entry.swing),
    ...doorLeaf(opts.bedDoor.hinge, opts.bedDoor.width, opts.bedDoor.swing),
    ...doorLeaf(opts.bathDoor.hinge, opts.bathDoor.width, opts.bathDoor.swing),
  ];

  const marks: Geom[] = [
    ...windowMark(opts.window.center, opts.window.width, { x: 1, y: 0 }),
    ...roomLabel(livingC, 0.22),
    ...roomLabel(bedC, 0.18),
    ...roomLabel(kitchenC, 0.16),
    ...roomLabel({ x: (bathX + max.x) / 2, y: (min.y + kY) / 2 }, 0.14),
  ];

  return [...outer, ...interior, ...fixtures, ...doors, ...marks];
}
