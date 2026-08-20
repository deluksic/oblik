import {
  box3,
  circle3,
  cylinder3,
  group,
  line3,
  type Geom,
  type Vec3,
} from "@design-scenes/geom";

export type MillHole = { x: number; y: number; radius: number };

export type MillOpts = {
  stock: { min: Vec3; max: Vec3 };
  holes: MillHole[];
  pocket: { min: Vec3; max: Vec3 };
  slot: { center: Vec3; length: number; width: number; depth: number };
};

function stockBox(min: Vec3, max: Vec3): Geom {
  return box3(min, max);
}

/** Through-holes + top circles. Loop is intentional for provenance stress. */
function holeSet(stock: MillOpts["stock"], holes: MillHole[]): Geom[] {
  const z0 = Math.min(stock.min.z, stock.max.z);
  const z1 = Math.max(stock.min.z, stock.max.z);
  const out: Geom[] = [];
  for (const h of holes) {
    out.push(
      cylinder3({ x: h.x, y: h.y, z: z0 }, { x: h.x, y: h.y, z: z1 }, h.radius),
    );
    out.push(
      circle3({ x: h.x, y: h.y, z: z1 }, h.radius, { x: 0, y: 0, z: 1 }),
    );
  }
  return out;
}

function slotCut(opts: MillOpts["slot"], zTop: number): Geom[] {
  const halfL = opts.length / 2;
  const halfW = opts.width / 2;
  const z0 = zTop - Math.abs(opts.depth);
  return [
    box3(
      { x: opts.center.x - halfL, y: opts.center.y - halfW, z: z0 },
      { x: opts.center.x + halfL, y: opts.center.y + halfW, z: zTop },
    ),
    line3(
      { x: opts.center.x - halfL, y: opts.center.y, z: zTop },
      { x: opts.center.x + halfL, y: opts.center.y, z: zTop },
    ),
  ];
}

/** Z-up mill block: stock, through holes, pocket, edge slot. */
export function drawMill(opts: MillOpts): Geom {
  const zTop = Math.max(opts.stock.min.z, opts.stock.max.z);
  return group(() => [
    group(() => [stockBox(opts.stock.min, opts.stock.max)]),
    group(() => holeSet(opts.stock, opts.holes)),
    group(() => [box3(opts.pocket.min, opts.pocket.max)]),
    group(() => slotCut(opts.slot, zTop)),
  ]);
}
