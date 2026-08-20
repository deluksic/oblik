import {
  add,
  circle,
  group,
  line,
  polyline,
  wrapBand,
  type Geom,
  type Vec2,
  vec,
} from "@design-scenes/geom";

export type RingOpts = {
  /** Bottom-left of the unrolled strip (seam). */
  origin: Vec2;
  /** Finger bore. Unrolled length is 2πR. */
  innerR: number;
  /** Axial height at the seam. */
  shank: number;
  /** Axial height opposite the seam (signet face). */
  signet: number;
  /** Radial wall thickness. */
  gauge: number;
};

export function circumference(innerR: number): number {
  return Math.max(0.4, Math.abs(innerR)) * Math.PI * 2;
}

function topZ(s: number, circ: number, shank: number, signet: number): number {
  const t = circ < 1e-6 ? 0 : s / circ;
  const w = 0.5 * (1 - Math.cos(2 * Math.PI * t));
  return shank + (Math.max(shank, signet) - shank) * w;
}

const SAMPLES = 72;

/** Developed curves in (s, z). Last sample is before 2π so wrap welds. */
export function bandCurves(opts: RingOpts): { bottom: Vec2[]; top: Vec2[] } {
  const circ = circumference(opts.innerR);
  const shank = Math.max(0.4, opts.shank);
  const signet = Math.max(shank, opts.signet);
  const bottom: Vec2[] = [];
  const top: Vec2[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const s = (i / SAMPLES) * circ;
    bottom.push(vec(s, 0));
    top.push(vec(s, topZ(s, circ, shank, signet)));
  }
  return { bottom, top };
}

/** Closed unrolled outline in world XY (origin is the seam). */
export function unrolledOutline(opts: RingOpts): Vec2[] {
  const { bottom, top } = bandCurves(opts);
  const circ = circumference(opts.innerR);
  const o = opts.origin;
  const zTop0 = top[0]?.y ?? opts.shank;
  const pts: Vec2[] = [];
  for (const p of bottom) pts.push(add(o, p));
  pts.push(add(o, vec(circ, 0)));
  pts.push(add(o, vec(circ, topZ(circ, circ, opts.shank, opts.signet))));
  for (let i = top.length - 1; i >= 0; i--) pts.push(add(o, top[i]!));
  pts.push(add(o, vec(0, zTop0)));
  return pts;
}

export function drawUnrolled(opts: RingOpts): Geom {
  const o = opts.origin;
  const circ = circumference(opts.innerR);
  const outline = unrolledOutline(opts);
  return group(() => [
    polyline(outline),
    line(o, add(o, vec(0, topZ(0, circ, opts.shank, opts.signet)))),
    line(add(o, vec(circ, 0)), add(o, vec(circ, topZ(circ, circ, opts.shank, opts.signet)))),
  ]);
}

export function drawRingPlan(center: Vec2, innerR: number, gauge: number): Geom {
  const r = Math.max(0.4, innerR);
  return group(() => [circle(center, r), circle(center, r + Math.max(0.15, gauge))]);
}

export function drawRing3(opts: RingOpts): Geom {
  const { bottom, top } = bandCurves(opts);
  return wrapBand(bottom, top, {
    radius: Math.max(0.4, opts.innerR),
    thickness: Math.max(0.15, opts.gauge),
  });
}
