import { mesh3, type Mesh3 } from "./geom3.ts";
import { dist, rotateAround, type Vec2 } from "./vec.ts";
import { vec3, type Vec3 } from "./vec3.ts";

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
export function extrude(points: readonly Vec2[], height: number, opts: ExtrudeOpts = {}): Mesh3 {
  const ring = stripClose(points);
  const n = ring.length;
  const h = Math.max(1e-6, Math.abs(height));
  const twist = opts.twist ?? 0;
  const center = opts.center ?? { x: 0, y: 0 };
  const closed =
    opts.closed ?? (points.length >= 3 && dist(points[0]!, points[points.length - 1]!) < 1e-6);
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

export type WrapBandOpts = {
  /** Radius the 2D x (arc length) is measured on — usually the bore. */
  radius: number;
  /** Radial thickness, outward from `radius`. */
  thickness: number;
};

function cyl(s: number, z: number, r: number, rMap: number): Vec3 {
  const theta = s / rMap;
  return vec3(r * Math.cos(theta), r * Math.sin(theta), z);
}

function pushV(positions: number[], p: Vec3): void {
  positions.push(p.x, p.y, p.z);
}

/**
 * Wrap a developed band (bottom/top curves in arc-length × axis) onto a
 * cylinder and give it radial thickness. Each of the four skins (inner,
 * outer, top, bottom) has its own vertices so sharp edges shade cleanly.
 * `bottom` and `top` must share sample count; x is arc length at `radius`.
 * The last sample is welded to the first (a closed ring).
 */
export function wrapBand(bottom: readonly Vec2[], top: readonly Vec2[], opts: WrapBandOpts): Mesh3 {
  const n = Math.min(bottom.length, top.length);
  if (n < 3) return mesh3([], []);
  const rMap = Math.max(1e-3, Math.abs(opts.radius));
  const thick = Math.abs(opts.thickness) < 1e-4 ? 0.05 : opts.thickness;
  const r0 = rMap;
  const r1 = r0 + thick;

  const positions: number[] = [];
  const indices: number[] = [];

  const ribbon = (a: (i: number) => Vec3, b: (i: number) => Vec3) => {
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      pushV(positions, a(i));
      pushV(positions, b(i));
    }
    for (let i = 0; i < n; i++) {
      const i0 = base + i * 2;
      const i1 = i0 + 1;
      const j = (i + 1) % n;
      const j0 = base + j * 2;
      const j1 = j0 + 1;
      indices.push(i0, i1, j1, i0, j1, j0);
    }
  };

  const ib = (i: number) => cyl(bottom[i]!.x, bottom[i]!.y, r0, rMap);
  const it = (i: number) => cyl(top[i]!.x, top[i]!.y, r0, rMap);
  const ob = (i: number) => cyl(bottom[i]!.x, bottom[i]!.y, r1, rMap);
  const ot = (i: number) => cyl(top[i]!.x, top[i]!.y, r1, rMap);

  ribbon(ib, it);
  ribbon(ot, ob);
  ribbon(it, ot);
  ribbon(ob, ib);

  return mesh3(positions, indices);
}
