import {
  add,
  ang,
  arc,
  circle,
  group,
  line,
  polar,
  polyline,
  rotate,
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
  return vec(
    rb * (Math.cos(t) + t * Math.sin(t)),
    rb * (Math.sin(t) - t * Math.cos(t)),
  );
}

function tAtRadius(rb: number, r: number): number {
  const x = r / rb;
  if (x <= 1) return 0;
  return Math.sqrt(x * x - 1);
}

function flank(
  rb: number,
  t0: number,
  t1: number,
  samples: number,
  spin: number,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = t0 + ((t1 - t0) * i) / samples;
    pts.push(rotate(involuteAt(rb, t), spin));
  }
  return pts;
}

/**
 * One tooth in local coords, centerline on +X.
 * Involute is spun so the pitch point sits at ±π/(2z).
 */
function toothParts(
  pitchR: number,
  teeth: number,
  alpha: number,
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
  const spin = half - ang(involuteAt(baseR, tPitch));
  const t0 = tAtRadius(baseR, Math.max(baseR * 1.001, rootR));
  const t1 = tAtRadius(baseR, addR);
  const right = flank(baseR, t0, t1, 16, spin);
  const left = right.map((p) => vec(p.x, -p.y)).reverse();
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

/** Involute spur: flanks, tip arcs, root arcs in the gaps, pitch + bore. */
export function drawSpurGear(opts: SpurGearOpts): Geom {
  const z = Math.max(8, Math.round(opts.teeth));
  const pitchR = Math.max(0.4, Math.abs(opts.pitchRadius));
  const alpha = Math.min(0.5, Math.max(0.2, opts.pressureAngle));
  const rot = opts.rotation ?? 0;
  const c = opts.center;
  const tooth = toothParts(pitchR, z, alpha);
  const bore = opts.bore ?? pitchR * 0.32;
  const step = (Math.PI * 2) / z;

  return group(() => [
    group(() => [circle(c, pitchR), circle(c, bore)]),
    group(() => {
      const parts: Geom[] = [];
      for (let i = 0; i < z; i++) {
        const a = rot + i * step;
        parts.push(polyline(tooth.right.map((p) => at(p, c, a))));
        parts.push(polyline(tooth.left.map((p) => at(p, c, a))));
        parts.push(arc(c, tooth.addR, a + tooth.add0, a + tooth.add1));
        parts.push(
          arc(c, tooth.rootR, a + tooth.root1, a + step + tooth.root0),
        );
        if (tooth.needsRadial) {
          const inner = tooth.rootR;
          const outer = tooth.baseR;
          parts.push(
            line(at(polar(inner, tooth.root1), c, a), at(polar(outer, tooth.root1), c, a)),
          );
          parts.push(
            line(at(polar(inner, tooth.root0), c, a), at(polar(outer, tooth.root0), c, a)),
          );
        }
      }
      return parts;
    }),
    group(() => [line(c, at(polar(pitchR, 0), c, rot))]),
  ]);
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
  return line(vec(p.x - dir.x, p.y - dir.y), vec(p.x + dir.x, p.y + dir.y));
}
