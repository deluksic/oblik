import type { Circle, CsgOperand, Loop, LoopEdge, Region, Vec2 } from "#geom";
import { csg2Value, leftOfValue, offsetValue, pickValue, polarRepeatValue } from "#geom/csg2";

/**
 * A frozen corpus of fill shapes for the compiled-field tests.
 *
 * Those tests used to evaluate the demo scenes and take every fill they found as
 * their corpus, which made a test's input the same file the user edits: the dev
 * server rewrites `apps/demo/src/scenes/*.ts` while it runs, a GUI drag commits
 * into it, and a scene that stops containing the shape that once found a bug
 * silently narrows the test. The corpus lives here instead — varied on purpose,
 * and never moved by anything but this file.
 *
 * What it must keep covering, because the assertions are about structure rather
 * than about a particular shape: arc carriers *and* straight ones in one subtree,
 * both offset directions (and offsets of offsets), all three booleans, a
 * half-plane clip, a polar repeat of a cell that has holes, a nested boolean, and
 * operands that keep no plan at all so the span path stays exercised.
 */

const at = (x: number, y: number): Vec2 => ({ x, y });

/** One straight edge, the way a walk carries it. */
const edge = (a: Vec2, b: Vec2): LoopEdge => ({ a, b, carrier: { kind: "segment", a, b } });

/** A counter-clockwise rectangle: the base every non-circular case is built on. */
function boxLoop(cx: number, cy: number, w: number, h: number): LoopEdge[] {
  const corners = [
    at(cx - w / 2, cy - h / 2),
    at(cx + w / 2, cy - h / 2),
    at(cx + w / 2, cy + h / 2),
    at(cx - w / 2, cy + h / 2),
  ];
  return corners.map((a, i) => edge(a, corners[(i + 1) % corners.length]!));
}

/** An area: one outer loop (a loop or a whole circle) with holes cut out of it. */
const area = (outer: Loop, holes: Loop[] = []): Region => ({ kind: "region", outer, holes });

const disc = (cx: number, cy: number, r: number): Circle => ({
  kind: "circle",
  center: at(cx, cy),
  radius: r,
});

/** A tooth-like box on the `+x` side of the origin: cell 0 of a `polarRepeat`. */
const tooth = (): Region => area(boxLoop(2, 0, 0.4, 0.6));

const plateLoop = (): LoopEdge[] => boxLoop(0, 0, 3, 2);

/** A line to clip against, long enough to cross every case it is used on. */
const cutter = { kind: "segment" as const, a: at(-4, 0.3), b: at(4, 0.3) };

export type CorpusCase = { name: string; value: CsgOperand };

export const FILL_CORPUS: readonly CorpusCase[] = [
  // Single operands: the four leaf kinds the plan can start from.
  { name: "plate", value: area(plateLoop()) },
  { name: "disc", value: disc(0, 0, 1.5) },
  { name: "plate-inset", value: offsetValue(area(plateLoop()), -0.25) },
  { name: "toothed-ring", value: polarRepeatValue(tooth(), 12, at(0, 0), 0.35) },

  // Arc carriers: a circle as the outer loop, as a hole, and a hole joined by
  // straight edges — the three ways an arc reaches the span walk.
  { name: "hole-plate", value: area(plateLoop(), [disc(0, 0, 0.5)]) },
  { name: "disc-ring", value: area(disc(0, 0, 2), [disc(0, 0, 0.9)]) },
  { name: "disc-square-hole", value: area(disc(0, 0, 2), [boxLoop(0, 0, 1.6, 1.6)]) },
  { name: "two-hole-plate", value: area(plateLoop(), [disc(-0.7, 0, 0.35), disc(0.7, 0, 0.35)]) },

  // Booleans, including the duplicated structure the shape key is meant to fold.
  {
    name: "two-boxes",
    value: csg2Value("union", [area(boxLoop(-0.9, 0, 1.6, 1.6)), area(boxLoop(0.9, 0, 1.6, 1.6))]),
  },
  {
    name: "three-boxes",
    value: csg2Value("union", [
      area(boxLoop(-1.4, 0, 1, 2)),
      area(boxLoop(0, 0, 1, 2)),
      area(boxLoop(1.4, 0, 1, 2)),
    ]),
  },
  {
    name: "wide-two-boxes",
    value: csg2Value("union", [area(boxLoop(-1.2, 0, 2, 1.4)), area(boxLoop(1.2, 0, 2, 1.4))]),
  },
  {
    name: "four-boxes",
    value: csg2Value("union", [
      area(boxLoop(-1.6, 0, 0.8, 2)),
      area(boxLoop(-0.5, 0, 0.8, 2)),
      area(boxLoop(0.5, 0, 0.8, 2)),
      area(boxLoop(1.6, 0, 0.8, 2)),
    ]),
  },
  { name: "box-minus-disc", value: csg2Value("diff", [area(plateLoop()), disc(0, 0, 0.6)]) },
  {
    name: "box-minus-disc-and-box",
    value: csg2Value("diff", [area(plateLoop()), disc(0, 0, 0.6), area(boxLoop(-1, 0, 0.6, 3))]),
  },
  {
    name: "small-box-minus-disc",
    value: csg2Value("diff", [area(boxLoop(0, 0, 1.5, 1.5)), disc(0, 0, 0.4)]),
  },
  {
    name: "disc-minus-box",
    value: csg2Value("diff", [disc(0, 0, 1.5), area(boxLoop(0, 0, 1.2, 1.2))]),
  },
  { name: "box-and-disc", value: csg2Value("intersect", [area(plateLoop()), disc(0, 0, 1.1)]) },

  // Half-plane clips: one leaf that has no bounded box of its own, in both a
  // boolean that keeps it and one that removes it.
  { name: "box-left-of", value: csg2Value("intersect", [area(plateLoop()), leftOfValue(cutter)]) },
  { name: "disc-left-of", value: csg2Value("intersect", [disc(0, 0, 1.5), leftOfValue(cutter)]) },
  { name: "box-minus-left-of", value: csg2Value("diff", [area(plateLoop()), leftOfValue(cutter)]) },

  // Offsets: inward and outward, of a leaf, of a boolean, and of each other.
  {
    name: "two-hole-inset",
    value: offsetValue(area(plateLoop(), [disc(-0.7, 0, 0.35), disc(0.7, 0, 0.35)]), -0.2),
  },
  { name: "disc-outset", value: offsetValue(disc(0, 0, 1.2), 0.3) },
  {
    name: "inset-boolean",
    value: offsetValue(csg2Value("diff", [area(plateLoop()), disc(0, 0, 0.6)]), -0.15),
  },
  {
    name: "outset-boolean",
    value: offsetValue(csg2Value("intersect", [area(plateLoop()), disc(0, 0, 1.1)]), 0.18),
  },
  { name: "double-inset", value: offsetValue(offsetValue(area(plateLoop()), -0.3), 0.12) },
  {
    name: "two-offsets-intersect",
    value: csg2Value("intersect", [
      offsetValue(disc(0, 0, 1.3), 0.2),
      offsetValue(area(plateLoop()), 0.1),
    ]),
  },

  // Repeats: a cell of straight edges, a cell that carries its own hole, and the
  // gear-like combination of a repeat with a hub and a bore.
  {
    name: "ring-plus-hub",
    value: csg2Value("union", [disc(0, 0, 0.6), polarRepeatValue(tooth(), 9, at(0, 0), 0.2)]),
  },
  {
    name: "gear-face",
    value: csg2Value("diff", [
      csg2Value("union", [disc(0, 0, 0.6), polarRepeatValue(tooth(), 16, at(0, 0), 0.2)]),
      disc(0, 0, 0.4),
    ]),
  },
  {
    name: "repeat-with-hole",
    value: polarRepeatValue(area(boxLoop(2, 0, 0.8, 0.8), [disc(2, 0, 0.2)]), 6, at(0, 0), 0.1),
  },

  // Depth: a boolean of a boolean, and an offset that wraps both.
  {
    name: "nested-boolean",
    value: csg2Value("intersect", [
      csg2Value("union", [area(plateLoop()), disc(1.4, 0, 0.8)]),
      csg2Value("diff", [area(boxLoop(0, 0, 4, 1.4)), disc(0, 0, 0.5)]),
    ]),
  },
  {
    name: "offset-nested-boolean",
    value: offsetValue(
      csg2Value("union", [
        csg2Value("diff", [area(plateLoop()), disc(0, 0, 0.5)]),
        csg2Value("intersect", [disc(1.6, 0, 1), area(boxLoop(1.6, 0, 1.2, 1.2))]),
      ]),
      -0.1,
    ),
  },

  // Operands the plan refuses: a pick keeps its island restriction on the span
  // path, so it must stay in the corpus as the case `fieldPlan` declines.
  { name: "pick-of-plate", value: pickValue(area(plateLoop()), at(-0.4, 0.3)) },
  {
    name: "pick-of-two-hole-plate",
    value: pickValue(area(plateLoop(), [disc(0, 0, 0.4)]), at(1, 0.5)),
  },
];
