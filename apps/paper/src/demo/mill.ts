import {
  box3,
  circle3,
  cylinder3,
  group,
  line3,
  type Geom,
  type Vec3,
} from "@design-scenes/geom";
import type { PlateOpts } from "./plate.ts";

export type MillHole = { x: number; y: number; radius: number };

export type MillOpts = {
  stock: { min: Vec3; max: Vec3 };
  holes: MillHole[];
  pocket: { min: Vec3; max: Vec3; filletR?: number };
  slot: { center: Vec3; length: number; width: number; depth: number };
};

/** Extrude a 2D plate layout along Z. */
export function millFromPlate(plate: PlateOpts, thickness: number): MillOpts {
  const z1 = Math.max(0.12, thickness);
  const zPocket = Math.max(0.05, z1 - Math.min(0.55, z1 * 0.45));
  const zSlot = Math.max(0.05, z1 - Math.min(0.35, z1 * 0.35));
  return {
    stock: {
      min: { x: plate.stock.min.x, y: plate.stock.min.y, z: 0 },
      max: { x: plate.stock.max.x, y: plate.stock.max.y, z: z1 },
    },
    holes: plate.holes.map((h) => ({
      x: h.center.x,
      y: h.center.y,
      radius: h.radius,
    })),
    pocket: {
      min: { x: plate.pocket.min.x, y: plate.pocket.min.y, z: zPocket },
      max: { x: plate.pocket.max.x, y: plate.pocket.max.y, z: z1 },
      filletR: plate.pocket.filletR,
    },
    slot: {
      center: {
        x: plate.slot.center.x,
        y: plate.slot.center.y,
        z: z1,
      },
      length: plate.slot.length,
      width: plate.slot.width,
      depth: z1 - zSlot,
    },
  };
}

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
    group(() => {
      const p = opts.pocket;
      const parts: Geom[] = [box3(p.min, p.max)];
      const r = p.filletR;
      if (r && r > 0.05) {
        const z = Math.max(p.min.z, p.max.z);
        const n = { x: 0, y: 0, z: 1 };
        parts.push(circle3({ x: p.min.x + r, y: p.min.y + r, z }, r, n));
        parts.push(circle3({ x: p.max.x - r, y: p.min.y + r, z }, r, n));
        parts.push(circle3({ x: p.max.x - r, y: p.max.y - r, z }, r, n));
        parts.push(circle3({ x: p.min.x + r, y: p.max.y - r, z }, r, n));
      }
      return parts;
    }),
    group(() => slotCut(opts.slot, zTop)),
  ]);
}
