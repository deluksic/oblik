import {
  add,
  ang,
  circle,
  dist,
  extrude,
  group,
  segment,
  polar,
  polyline,
  rotate,
  sweepCCW,
  type Geom,
  type Vec2,
  vec,
} from "@design-scenes/geom";

export type SpurGearOpts = {
  center: Vec2;
  /** Number of teeth. */
  teeth: number;
  /** Pitch radius. Module is 2 * pitchRadius / teeth. */
  pitchRadius: number;
  /** Pressure angle in radians. */
  pressureAngle: number;
  rotation?: number;
  bore?: number;
};

function involuteAt(rb: number, t: number): Vec2 {
  return vec(rb * (Math.cos(t) + t * Math.sin(t)), rb * (Math.sin(t) - t * Math.cos(t)));
}

function tAtRadius(rb: number, r: number): number {
  const x = r / rb;
  if (x <= 1) return 0;
  return Math.sqrt(x * x - 1);
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
  const z = Math.max(8, Math.round(teeth));
  const m = (2 * pitchR) / z;
  const baseR = pitchR * Math.cos(alpha);
  const addR = pitchR + m;
  const rootR = Math.max(0.18 * pitchR, pitchR - 1.25 * m);
  const half = Math.PI / (2 * z);
  const tPitch = tAtRadius(baseR, pitchR);
  const spin = half - ang(involuteAt(baseR, -tPitch));
  const t0 = tAtRadius(baseR, Math.max(baseR * 1.001, rootR));
  const t1 = tAtRadius(baseR, addR);
  const right = flank(baseR, t0, t1, flankSamples, spin);
  const left = right.map((p) => vec(p.x, -p.y)).toReversed();
  const tip = right[right.length - 1] ?? polar(addR, half);
  const rootPt = right[0] ?? polar(Math.max(rootR, baseR), half);
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

/**
 * External mate: opposite rotation, a space on the line of centres
 * so a pinion tooth (centerline at rot1) fits the wheel gap.
 */
export function meshMateRotation(z1: number, z2: number, rot1: number): number {
  return -rot1 * (z1 / z2) + Math.PI - Math.PI / z2;
}

/** Involute spur: one closed outline polyline, pitch + bore, pitch marker. */
export function drawSpurGear(opts: SpurGearOpts): Geom[] {
  const pitchR = Math.max(0.4, Math.abs(opts.pitchRadius));
  const rot = opts.rotation ?? 0;
  const c = opts.center;
  const bore = opts.bore ?? pitchR * 0.32;
  const ring = gearOutline(opts, 16);
  if (ring.length >= 2) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (dist(first, last) >= 1e-8) ring.push({ x: first.x, y: first.y });
  }
  return [
    circle(c, pitchR),
    circle(c, bore),
    polyline(ring),
    segment(c, at(polar(pitchR, 0), c, rot)),
  ];
}

export function gearModule(pitchRadius: number, teeth: number): number {
  return (2 * Math.abs(pitchRadius)) / Math.max(8, Math.round(teeth));
}

export function pitchRadiusFor(module: number, teeth: number): number {
  return (Math.abs(module) * Math.max(8, Math.round(teeth))) / 2;
}

export function centerDistance(pitchA: number, pitchB: number): number {
  return Math.abs(pitchA) + Math.abs(pitchB);
}

/** Pitch point of an external pair on the +X line of centres. */
export function pitchPoint(pinion: Vec2, pitchRadius: number): Vec2 {
  return vec(pinion.x + pitchRadius, pinion.y);
}

/** Line of action through the pitch point (pressure angle from the common tangent). */
export function lineOfAction(
  pinion: Vec2,
  pitchRadius: number,
  pressureAngle: number,
  length: number,
): Geom {
  const p = pitchPoint(pinion, pitchRadius);
  const dir = polar(length, Math.PI / 2 - pressureAngle);
  return segment(vec(p.x - dir.x, p.y - dir.y), vec(p.x + dir.x, p.y + dir.y));
}

export type GearLayout = {
  pinion: Vec2;
  wheel: Vec2;
  z1: number;
  z2: number;
  pitch1: number;
  pitch2: number;
  alpha: number;
  rot1: number;
  rot2: number;
  helixDeg: number;
};

/** Closed outer tooth loop, CCW, for `extrude`. */
export function gearOutline(opts: SpurGearOpts, flankSamples = 8): Vec2[] {
  const z = Math.max(8, Math.round(opts.teeth));
  const pitchR = Math.max(0.4, Math.abs(opts.pitchRadius));
  const alpha = Math.min(0.5, Math.max(0.2, opts.pressureAngle));
  const rot = opts.rotation ?? 0;
  const c = opts.center;
  const tooth = toothParts(pitchR, z, alpha, flankSamples);
  const step = (Math.PI * 2) / z;
  const ring: Vec2[] = [];

  const sampleArc = (radius: number, a0: number, a1: number): Vec2[] => {
    const sweep = sweepCCW(a0, a1);
    const n = Math.max(3, Math.round(8 * (sweep / (Math.PI / 8))));
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

/** Total twist (radians) so the pitch helix angle is `helixAngle`. */
export function helixTwist(faceWidth: number, helixAngle: number, pitchRadius: number): number {
  if (Math.abs(pitchRadius) < 1e-6) return 0;
  return (Math.abs(faceWidth) * Math.tan(helixAngle)) / pitchRadius;
}

export function drawHelicalGear(opts: SpurGearOpts & { height: number; helixAngle: number }): Geom {
  const outline = gearOutline(opts);
  const twist = helixTwist(opts.height, opts.helixAngle, opts.pitchRadius);
  return extrude(outline, opts.height, {
    twist,
    center: opts.center,
    closed: true,
  });
}

export function drawHelicalPair(layout: GearLayout, height: number): Geom {
  const h = Math.max(0.35, height);
  const beta = (layout.helixDeg * Math.PI) / 180;
  return group(() => [
    drawHelicalGear({
      center: layout.pinion,
      teeth: layout.z1,
      pitchRadius: layout.pitch1,
      pressureAngle: layout.alpha,
      rotation: layout.rot1,
      height: h,
      helixAngle: beta,
    }),
    drawHelicalGear({
      center: layout.wheel,
      teeth: layout.z2,
      pitchRadius: layout.pitch2,
      pressureAngle: layout.alpha,
      rotation: layout.rot2,
      height: h,
      helixAngle: -beta,
    }),
  ]);
}
