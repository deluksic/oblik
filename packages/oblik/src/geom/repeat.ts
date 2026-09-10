import type { Circle, Line, LineLike, Loop, LoopEdge, PolarRepeat, Region } from "./types";
import type { Vec2 } from "./vec";

/**
 * The polar repeat's math, in one place: the **fold** the GPU shader and the CPU
 * reference both run (`foldPolar`), and the **rotation** the geometry side runs
 * when a repeat has to become real islands (`rotateRegion`, used by
 * `evaluate-regions.ts` for SVG paint and island queries).
 *
 * The two are the same operation seen from opposite ends, which is the whole
 * point of the construct:
 *
 * - the field side folds the query point into the nearest copy and evaluates one
 *   copy there — no geometry, O(one copy) per pixel;
 * - the geometry side stamps the copy `count` times — real loops, for a
 *   rasterizer that would rather scan 40 polygons than evaluate a distance field
 *   (which is exactly what the SVG view does).
 */

const TAU = Math.PI * 2;

/** Angular spacing of a repeat's copies. */
export function repeatStep(count: number): number {
  return TAU / Math.max(1, count);
}

/**
 * Rotate `p` about `about` by `−ang` — i.e. into the frame of the copy that sits
 * at `ang`. A rotation is rigid, so the distance to the copy at `ang` equals the
 * distance from its image to the copy at 0.
 */
export function rotateAbout(p: Vec2, about: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const vx = p.x - about.x;
  const vy = p.y - about.y;
  return { x: about.x + vx * c + vy * s, y: about.y - vx * s + vy * c };
}

/**
 * Fold `p` into the frame of the nearest copy of `rep`: the angular sector
 * around `p` wins, so the copy evaluated is the closest one whenever `of` stays
 * inside its sector (the documented precondition). The reference for the shader's
 * inlined twin in `gpu/field/assemble.ts`; `field/eval.ts` calls this one, so the
 * parity runs compare the fold itself, not two transcriptions of it.
 */
export function foldPolar(p: Vec2, about: Vec2, rotation: number, step: number): Vec2 {
  const ang =
    rotation + Math.round((Math.atan2(p.y - about.y, p.x - about.x) - rotation) / step) * step;
  return rotateAbout(p, about, ang);
}

/** `foldPolar` against a repeat value — the CPU membership reference. */
export function foldIntoCopy(p: Vec2, rep: PolarRepeat): Vec2 {
  return foldPolar(p, rep.about, rep.rotation, repeatStep(rep.count));
}

/** The world point of copy `k`'s origin... i.e. rotate `p` back by copy `k`. */
export function copyAngle(rep: PolarRepeat, k: number): number {
  return rep.rotation + k * repeatStep(rep.count);
}

// -- geometry side -----------------------------------------------------------

function rotatePoint(p: Vec2, about: Vec2, ang: number): Vec2 {
  return rotateAbout(p, about, -ang);
}

function rotateLine(line: Line, about: Vec2, ang: number): Line {
  return {
    kind: "line",
    origin: rotatePoint(line.origin, about, ang),
    direction: rotate(line.direction, ang),
  };
}

function rotate(dir: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c };
}

function rotateCarrier(carrier: LineLike | Circle, about: Vec2, ang: number): LineLike | Circle {
  if (carrier.kind === "circle") {
    return {
      kind: "circle",
      center: rotatePoint(carrier.center, about, ang),
      radius: carrier.radius,
    };
  }
  if (carrier.kind === "segment") {
    return {
      kind: "segment",
      a: rotatePoint(carrier.a, about, ang),
      b: rotatePoint(carrier.b, about, ang),
    };
  }
  if (carrier.kind === "line") return rotateLine(carrier, about, ang);
  // A parallel line keeps its distance; only its reference line turns.
  return {
    kind: "parallelLine",
    line: rotateLine(carrier.line, about, ang),
    distance: carrier.distance,
  };
}

function rotateLoop(loop: Loop, about: Vec2, ang: number): Loop {
  if (!Array.isArray(loop)) {
    return { kind: "circle", center: rotatePoint(loop.center, about, ang), radius: loop.radius };
  }
  return loop.map((e: LoopEdge): LoopEdge => {
    const out: LoopEdge = {
      a: rotatePoint(e.a, about, ang),
      b: rotatePoint(e.b, about, ang),
      carrier: rotateCarrier(e.carrier, about, ang),
    };
    return e.k === undefined ? out : { ...out, k: e.k };
  });
}

/** One copy of a repeat: the island turned about the axis by `ang`. */
export function rotateRegion(region: Region, about: Vec2, ang: number): Region {
  return {
    kind: "region",
    outer: rotateLoop(region.outer, about, ang),
    holes: region.holes.map((h) => rotateLoop(h, about, ang)),
  };
}
