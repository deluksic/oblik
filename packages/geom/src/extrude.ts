import { dist, rotateAround, type Vec2 } from "./vec.ts";
import { mesh3, type Mesh3 } from "./geom3.ts";

export type ExtrudeOpts = {
  /** Total rotation about +Z from bottom to top, radians. */
  twist?: number;
  /** Twist pivot in XY. Default origin. */
  center?: Vec2;
  /** Divisions along height. Default grows with |twist|. */
  slices?: number;
  /**
   * Closed ring (caps + wrap last-to-first). Default: first≈last,
   * or true when the caller already omitted a duplicate close.
   */
  closed?: boolean;
};

function stripClose(points: readonly Vec2[]): Vec2[] {
  if (points.length < 2) return points.slice();
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (dist(a, b) < 1e-9) return points.slice(0, -1);
  return points.slice();
}

/** Append a copy of `n` xyz triples starting at vertex `from`. Returns the new base index. */
function copyRing(positions: number[], from: number, n: number): number {
  const base = positions.length / 3;
  const start = from * 3;
  for (let i = 0; i < n * 3; i++) {
    positions.push(positions[start + i]!);
  }
  return base;
}

/**
 * Sweep a 2D polyline along +Z. Optional twist rotates each slice about
 * `center` (helical extrude). Closed rings get top and bottom caps.
 */
export function extrude(
  points: readonly Vec2[],
  height: number,
  opts: ExtrudeOpts = {},
): Mesh3 {
  const ring = stripClose(points);
  const n = ring.length;
  const h = Math.max(1e-6, Math.abs(height));
  const twist = opts.twist ?? 0;
  const center = opts.center ?? { x: 0, y: 0 };
  const closed =
    opts.closed ??
    (points.length >= 3 && dist(points[0]!, points[points.length - 1]!) < 1e-6);
  const slices = Math.max(
    1,
    opts.slices ?? Math.max(8, Math.ceil(Math.abs(twist) / (Math.PI / 12))),
  );

  const positions: number[] = [];
  for (let s = 0; s <= slices; s++) {
    const t = s / slices;
    const rot = t * twist;
    const z = t * h;
    for (const p of ring) {
      const q = rotateAround(p, center, rot);
      positions.push(q.x, q.y, z);
    }
  }

  const indices: number[] = [];
  const segs = closed ? n : n - 1;
  for (let s = 0; s < slices; s++) {
    const a = s * n;
    const b = (s + 1) * n;
    for (let i = 0; i < segs; i++) {
      const i0 = a + i;
      const i1 = closed ? a + ((i + 1) % n) : a + i + 1;
      const j0 = b + i;
      const j1 = closed ? b + ((i + 1) % n) : b + i + 1;
      indices.push(i0, i1, j1, i0, j1, j0);
    }
  }

  // Caps use a duplicated ring so computeVertexNormals does not average
  // wall normals into the planar faces (that reads as a shaded rim).
  if (closed && n >= 3) {
    let bx = 0;
    let by = 0;
    for (const p of ring) {
      bx += p.x;
      by += p.y;
    }
    bx /= n;
    by /= n;
    const bot = rotateAround({ x: bx, y: by }, center, 0);
    const top = rotateAround({ x: bx, y: by }, center, twist);
    const last = slices * n;
    const botRing = copyRing(positions, 0, n);
    const botI = positions.length / 3;
    positions.push(bot.x, bot.y, 0);
    const topRing = copyRing(positions, last, n);
    const topI = positions.length / 3;
    positions.push(top.x, top.y, h);
    for (let i = 0; i < n; i++) {
      const i0 = botRing + i;
      const i1 = botRing + ((i + 1) % n);
      indices.push(botI, i1, i0);
      const j0 = topRing + i;
      const j1 = topRing + ((i + 1) % n);
      indices.push(topI, j0, j1);
    }
  }

  return mesh3(positions, indices);
}
