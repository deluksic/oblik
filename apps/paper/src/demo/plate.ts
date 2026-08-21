import {
  add,
  circle,
  group,
  line,
  mul,
  polyline,
  sub,
  type Geom,
  type Vec2,
} from "@design-scenes/geom";

export type Hole = { center: Vec2; radius: number };

export type PlateOpts = {
  /** Bottom-left and top-right of the stock blank (axis-aligned). */
  stock: { min: Vec2; max: Vec2 };
  holes: Hole[];
  /** Axis-aligned pocket; fillet radius on inside corners. */
  pocket: { min: Vec2; max: Vec2; filletR: number };
  /** Slot cut on the top edge of stock. */
  slot: { center: Vec2; length: number; width: number };
  /** Pitch circle drawn as construction; ring holes are also in `holes`. */
  boltCircle?: { center: Vec2; radius: number; count: number; holeR: number };
};

/** Polar hole pattern. Loop is the provenance stress: every hole shares one call site. */
export function boltCircle(center: Vec2, radius: number, count: number, holeR: number): Hole[] {
  const n = Math.max(3, Math.round(count));
  const out: Hole[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push({
      center: {
        x: center.x + Math.cos(a) * radius,
        y: center.y + Math.sin(a) * radius,
      },
      radius: holeR,
    });
  }
  return out;
}

function shift(p: Vec2, dx: number, dy: number): Vec2 {
  return { x: p.x + dx, y: p.y + dy };
}

/** Move a plate in XY. Holes and the pitch circle follow. */
export function translatePlate(opts: PlateOpts, dx: number, dy: number): PlateOpts {
  const t = (p: Vec2) => shift(p, dx, dy);
  return {
    stock: { min: t(opts.stock.min), max: t(opts.stock.max) },
    holes: opts.holes.map((h) => ({ center: t(h.center), radius: h.radius })),
    pocket: {
      min: t(opts.pocket.min),
      max: t(opts.pocket.max),
      filletR: opts.pocket.filletR,
    },
    slot: {
      center: t(opts.slot.center),
      length: opts.slot.length,
      width: opts.slot.width,
    },
    boltCircle: opts.boltCircle
      ? { ...opts.boltCircle, center: t(opts.boltCircle.center) }
      : undefined,
  };
}

/** Rebuild the polar array to a new count; corner holes stay. */
export function withRingCount(opts: PlateOpts, count: number): PlateOpts {
  const bc = opts.boltCircle;
  if (!bc) return opts;
  const nRing = Math.max(3, Math.round(bc.count));
  const corners = opts.holes.slice(0, Math.max(0, opts.holes.length - nRing));
  const n = Math.max(3, Math.round(count));
  return {
    ...opts,
    boltCircle: { ...bc, count: n },
    holes: [...corners, ...boltCircle(bc.center, bc.radius, n, bc.holeR)],
  };
}

/** Nest copies for a print sheet. `countStep` is added to ring N per column. */
export function drawPlateNest(
  master: PlateOpts,
  grid: { cols: number; rows: number; gap: number; countStep?: number },
): Geom {
  const cols = Math.max(1, Math.round(grid.cols));
  const rows = Math.max(1, Math.round(grid.rows));
  const gap = Math.max(0.05, grid.gap);
  const step = grid.countStep ?? 0;
  const w = master.stock.max.x - master.stock.min.x;
  const h = master.stock.max.y - master.stock.min.y;
  const pitchX = w + gap;
  const pitchY = h + gap;
  const totalW = cols * w + (cols - 1) * gap;
  const totalH = rows * h + (rows - 1) * gap;
  const x0 = -totalW / 2 - master.stock.min.x;
  const y0 = -totalH / 2 - master.stock.min.y;
  const baseN = master.boltCircle?.count ?? 3;

  return group(() => {
    const cells: Geom[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = withRingCount(
          translatePlate(master, x0 + c * pitchX, y0 + r * pitchY),
          baseN + c * step,
        );
        cells.push(drawPlate(cell));
      }
    }
    return cells;
  });
}

function rectOutline(min: Vec2, max: Vec2): Geom {
  return polyline([
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y },
    { x: min.x, y: min.y },
  ]);
}

function crossAt(center: Vec2, size: number): Geom[] {
  const h = mul({ x: 1, y: 0 }, size);
  const v = mul({ x: 0, y: 1 }, size);
  return [line(sub(center, h), add(center, h)), line(sub(center, v), add(center, v))];
}

function pocketWithFillets(min: Vec2, max: Vec2, filletR: number): Geom[] {
  const r = filletR;
  const parts: Geom[] = [
    polyline([
      { x: min.x + r, y: min.y },
      { x: max.x - r, y: min.y },
      { x: max.x, y: min.y + r },
      { x: max.x, y: max.y - r },
      { x: max.x - r, y: max.y },
      { x: min.x + r, y: max.y },
      { x: min.x, y: max.y - r },
      { x: min.x, y: min.y + r },
      { x: min.x + r, y: min.y },
    ]),
  ];
  const corners = [
    { x: min.x + r, y: min.y + r },
    { x: max.x - r, y: min.y + r },
    { x: max.x - r, y: max.y - r },
    { x: min.x + r, y: max.y - r },
  ];
  for (const c of corners) {
    parts.push(circle(c, r));
  }
  return parts;
}

function slotCut(center: Vec2, length: number, width: number): Geom[] {
  const halfL = length / 2;
  const halfW = width / 2;
  const a = { x: center.x - halfL, y: center.y };
  const b = { x: center.x + halfL, y: center.y };
  return [
    polyline([
      { x: a.x, y: center.y - halfW },
      { x: b.x, y: center.y - halfW },
      { x: b.x, y: center.y + halfW },
      { x: a.x, y: center.y + halfW },
      { x: a.x, y: center.y - halfW },
    ]),
    circle(a, halfW),
    circle(b, halfW),
  ];
}

function buildPlateParts(opts: PlateOpts): Geom[] {
  const parts: Geom[] = [rectOutline(opts.stock.min, opts.stock.max)];

  for (const hole of opts.holes) {
    parts.push(circle(hole.center, Math.abs(hole.radius)));
    parts.push(...crossAt(hole.center, hole.radius * 0.55));
  }

  parts.push(...pocketWithFillets(opts.pocket.min, opts.pocket.max, opts.pocket.filletR));
  parts.push(...slotCut(opts.slot.center, opts.slot.length, opts.slot.width));

  return parts;
}

/** Stock, holes, pocket, slot — grouped for breadcrumb namespaces. */
export function drawPlate(opts: PlateOpts): Geom {
  const { min, max } = opts.stock;
  return group(() => {
    const stock = rectOutline(min, max);
    const holes = group(() => {
      const out: Geom[] = [];
      for (const hole of opts.holes) {
        out.push(circle(hole.center, Math.abs(hole.radius)));
        out.push(...crossAt(hole.center, hole.radius * 0.55));
      }
      const bc = opts.boltCircle;
      if (bc) {
        out.push(circle(bc.center, Math.abs(bc.radius)));
      }
      return out;
    });
    const pocket = group(() =>
      pocketWithFillets(opts.pocket.min, opts.pocket.max, opts.pocket.filletR),
    );
    const slot = group(() => slotCut(opts.slot.center, opts.slot.length, opts.slot.width));
    return [stock, holes, pocket, slot];
  });
}

/** Ungrouped — for comparing flat paths / duplicate local indices. */
export function drawPlateFlat(opts: PlateOpts): Geom[] {
  return buildPlateParts(opts);
}
