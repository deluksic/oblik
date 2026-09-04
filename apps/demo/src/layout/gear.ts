import {
  add,
  ang,
  dist,
  polar,
  rotate,
  sweepCCW,
  vec,
  type Vec2,
} from "oblik";


const { PI, abs, cos, max, min, round, sin, sqrt } = Math;

export type SpurGearOpts = {
  center: Vec2;
  /** Number of teeth. */
  teeth: number;
  /** Pitch radius. Module is 2 * pitchRadius / teeth. */
  pitchRadius: number;
  /** Pressure angle in radians. */
  pressureAngle: number;
  rotation?: number;
};

export function gearModule(pitchRadius: number, teeth: number): number {
  return (2 * abs(pitchRadius)) / max(8, round(teeth));
}

export function pitchRadiusFor(module: number, teeth: number): number {
  return (abs(module) * max(8, round(teeth))) / 2;
}

export function centerDistance(pitchA: number, pitchB: number): number {
  return abs(pitchA) + abs(pitchB);
}

/** Pitch point of an external pair on the +X line of centres. */
export function pitchPoint(pinion: Vec2, pitchRadius: number): Vec2 {
  return vec(pinion.x + abs(pitchRadius), pinion.y);
}

/**
 * External mate: opposite rotation, a space on the line of centres
 * so a pinion tooth (centerline at rot1) fits the wheel gap.
 */
export function meshMateRotation(z1: number, z2: number, rot1: number): number {
  return -rot1 * (z1 / z2) + PI - PI / z2;
}

function involuteAt(rb: number, t: number): Vec2 {
  return vec(rb * (cos(t) + t * sin(t)), rb * (sin(t) - t * cos(t)));
}

function tAtRadius(rb: number, r: number): number {
  const x = r / rb;
  if (x <= 1) return 0;
  return sqrt(x * x - 1);
}

function flank(rb: number, t0: number, t1: number, samples: number, spin: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = t0 + ((t1 - t0) * i) / samples;
    // Negative roll: polar angle shrinks toward the tip, so the tooth
    // tapers and the circular spans sit on the tips and in the roots.
    pts.push(rotate(involuteAt(rb, -t), spin));
  }
  return pts;
}

/**
 * One tooth in local coords, centerline on +X.
 * Involute is spun so the pitch point sits at ±π/(2z); roll is
 * negative so thickness falls toward the addendum.
 */
function toothParts(
  pitchR: number,
  teeth: number,
  alpha: number,
  flankSamples = 16,
): {
  right: Vec2[];
  left: Vec2[];
  add0: number;
  add1: number;
  root0: number;
  root1: number;
  addR: number;
  rootR: number;
  baseR: number;
  needsRadial: boolean;
} {
  const z = max(8, round(teeth));
  const m = (2 * pitchR) / z;
  const baseR = pitchR * cos(alpha);
  const addR = pitchR + m;
  const rootR = max(0.18 * pitchR, pitchR - 1.25 * m);
  const half = PI / (2 * z);
  const tPitch = tAtRadius(baseR, pitchR);
  const spin = half - ang(involuteAt(baseR, -tPitch));
  const t0 = tAtRadius(baseR, max(baseR * 1.001, rootR));
  const t1 = tAtRadius(baseR, addR);
  const right = flank(baseR, t0, t1, flankSamples, spin);
  const left = right.map((p) => vec(p.x, -p.y)).toReversed();
  const tip = right[right.length - 1] ?? polar(addR, half);
  const rootPt = right[0] ?? polar(max(rootR, baseR), half);
  const add1 = ang(tip);
  const root1 = ang(rootPt);
  return {
    right,
    left,
    add0: -add1,
    add1,
    root0: -root1,
    root1,
    addR,
    rootR,
    baseR,
    needsRadial: rootR < baseR * 0.999,
  };
}

function at(local: Vec2, center: Vec2, rot: number): Vec2 {
  return add(center, rotate(local, rot));
}

/** Closed outer tooth loop, CCW, as boundary points for `polygon`. */
export function gearOutline(opts: SpurGearOpts, flankSamples = 12): Vec2[] {
  const z = max(8, round(opts.teeth));
  const pitchR = max(0.4, abs(opts.pitchRadius));
  const alpha = min(0.5, max(0.2, opts.pressureAngle));
  const rot = opts.rotation ?? 0;
  const c = opts.center;
  const tooth = toothParts(pitchR, z, alpha, flankSamples);
  const step = (PI * 2) / z;
  const ring: Vec2[] = [];

  const sampleArc = (radius: number, a0: number, a1: number): Vec2[] => {
    const sweep = sweepCCW(a0, a1);
    const n = max(3, round(8 * (sweep / (PI / 8))));
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      pts.push(add(c, polar(radius, a0 + (sweep * i) / n)));
    }
    return pts;
  };

  const append = (pts: Vec2[]) => {
    for (const p of pts) {
      const prev = ring[ring.length - 1];
      if (prev && dist(prev, p) < 1e-8) continue;
      ring.push(p);
    }
  };

  for (let i = 0; i < z; i++) {
    const a = rot + i * step;
    const leftOut = tooth.left.map((p) => at(p, c, a)).toReversed();
    const rightIn = tooth.right.map((p) => at(p, c, a)).toReversed();
    if (tooth.needsRadial) {
      append([at(polar(tooth.rootR, tooth.root0), c, a)]);
    }
    append(leftOut);
    append(sampleArc(tooth.addR, a + tooth.add0, a + tooth.add1));
    append(rightIn);
    if (tooth.needsRadial) {
      append([at(polar(tooth.rootR, tooth.root1), c, a)]);
    }
    append(sampleArc(tooth.rootR, a + tooth.root1, a + step + tooth.root0));
  }
  return ring;
}
