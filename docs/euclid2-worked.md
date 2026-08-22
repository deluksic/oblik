# Worked example — shelf, reach, beam

Figure: two points on a ground line, a parallel shelf, a reach circle at A that hits the shelf at P, a lamp whose beam is the circle through P, that beam hits the ground at Q, a line through P and Q, and a cellar parallel at the same distance on the other side.

Misses are NaN. `[LENGTH]` is the uniform length projection (`Circle` radius, `OffsetLine` signed d, `Segment` chord). Length-slot disk is always `name[LENGTH]`, never `.radius` / `.d`.

## Gestures → disk

| # | tool | clicks | disk |
| --- | --- | --- | --- |
| 1 | Point | empty | `const A = point(0, 0)` |
| 2 | Point | empty | `const B = point(6, 0.4)` |
| 3 | Line | A, B | `const ground = line(A, B)` |
| 4 | Offset | ground, type `1.8` | `const shelf = offsetLine(ground, 1.8)` |
| 5 | Circle | A, type `2.5` | `const reach = circle(A, 2.5)` |
| 6 | Point | `reach ∩ shelf` (nearer click, `+1`) | `const P = circleLineIntersection(reach, shelf, +1)` |
| 7 | Segment | A, P | `segment(A, P)` |
| 8 | Point | empty | `const lamp = point(2.2, 3.1)` |
| 9 | Circle | lamp, then P | `const beam = circle(lamp, dist(lamp, P))` |
| 10 | Point | `beam ∩ ground` | `const Q = circleLineIntersection(beam, ground, +1)` |
| 11 | Line | P, Q | `line(P, Q)` |
| 12 | Offset | ground, then shelf in the **Length** slot (other side) | `const cellar = offsetLine(ground, -shelf[LENGTH])` |

```ts
import { LENGTH, point, line, circle, offsetLine, segment, dist, circleLineIntersection } from "@design-scenes/geom";

export function scene() {
  const A = point(0, 0);
  const B = point(6, 0.4);
  const ground = line(A, B);

  const shelf = offsetLine(ground, 1.8);

  const reach = circle(A, 2.5);
  const P = circleLineIntersection(reach, shelf, +1);
  segment(A, P);

  const lamp = point(2.2, 3.1);
  const beam = circle(lamp, dist(lamp, P));

  const Q = circleLineIntersection(beam, ground, +1);
  line(P, Q);

  const cellar = offsetLine(ground, -shelf[LENGTH]);
}
```

Length slot on step 12: hit is `HasLength` and finite → writer emits `shelf[LENGTH]`. Same writer on `reach` would emit `reach[LENGTH]` (radius as a length). It does not know `OffsetLine` vs `Circle`.

`ground` is a `Line`: no `HasLength`. Length slot on the stroke is a miss, not `ground[LENGTH]`.

## After the call-site annotator

| call | `__annotations__.editable` | write |
| --- | --- | --- |
| `point(0, 0)` | true | `0`, `0` |
| `point(6, 0.4)` | true | `6`, `0.4` |
| `line(A, B)` | false | — |
| `offsetLine(ground, 1.8)` | true | `1.8` |
| `circle(A, 2.5)` | true | `2.5` |
| `circleLineIntersection(reach, shelf, +1)` | false | — |
| `segment(A, P)` | false | — |
| `point(2.2, 3.1)` | true | lamp |
| `circle(lamp, dist(lamp, P))` | false | — |
| `circleLineIntersection(beam, ground, +1)` | false | — |
| `line(P, Q)` | false | — |
| `offsetLine(ground, -shelf[LENGTH])` | false | — |

Handles: A, B, lamp, shelf `[LENGTH]`, reach `[LENGTH]`. Shown only while those placement values are finite.

## NaN

Drag reach `2.5` until it no longer meets the shelf: `P` is `{ x: NaN, y: NaN }`. Then `dist(lamp, P)` is NaN, `beam[LENGTH]` is NaN, `Q` is NaN, `segment(A, P)` and `line(P, Q)` are NaN.

Omit: P, Q, segment, beam, PQ. Keep: A, B, lamp, ground, shelf, cellar, reach, and the handles on A, B, lamp, `1.8`, `2.5`. Drag `2.5` out again and the downstream ink returns on the same `+1` branch (or stays NaN if that root is still gone).

`lineIntersection(ground, shelf)` is a NaN point, never `null`. Point tool must not treat a NaN hit as empty paper.

## Drags (DAG)

| drag | follows |
| --- | --- |
| A | ground, shelf, cellar, reach, P, segment, beam, Q, PQ |
| B | ground, shelf, cellar, not reach `[LENGTH]` |
| shelf `1.8` | shelf, P, beam, Q, PQ, cellar (`-shelf[LENGTH]`) |
| reach `2.5` | P, segment, beam, Q, PQ |
| lamp | beam, Q, PQ; P does not move |

## Where it falls apart

**1. Shared `const r = 1.8`** — still no constructor to annotate. `[LENGTH]` does not help; the `const` is a `number`.

**2. Length slot still has three introductions.** Writer is uniform for `HasLength`; it still branches for Point (`dist` / `signedDist`) vs type/measure (`literal`). Click P in Circle’s Length slot is `dist(lamp, P)`, not `P[LENGTH]` (Point is not `HasLength`).

**3. Same ink, two slots.** Length slot → `shelf[LENGTH]`. LineLike slot → `shelf` as line. Slot-active, not `.d` vs `.radius`. Teaching “click the shelf to copy height” still needs the Length slot to be the one open.

**4. Branch `+1` does not hop.** P becomes NaN, handles on P were never there; reach’s handle stays.

**5. Glider frame** on `line(A,B)` vs `offsetLine` — unchanged.

**6. Offset of a segment** — still an infinite `OffsetLine`. `segment[LENGTH]` is the chord; Offset’s first slot is `LineLike`, so clicking the segment offsets the line, it does not copy the chord. Copying the chord is Length slot: `offsetLine(ground, AP[LENGTH])`.

**7. `-shelf[LENGTH]` is a computation** — cellar has no handle. Independent other-side distance is a new literal.

**8. Beam vs reach** — same `Circle` type; only annotator `editable` differs. `beam[LENGTH]` exists (for reuse) but is not a write site.

**9. Two-way coincidences, missing foot/tangent/midpoint** — unchanged.

**10. One `[LENGTH]` per type.** An arc’s radius vs arc-length cannot both be *the* length. Pick one in the catalog.

**11. `Line[LENGTH]` is absent, not `Infinity`.** A Length click on `ground` does not write a number. Infinite as a length is not a value in the graph.

## What still holds

- Tool writer: `HasLength && finite → name[LENGTH]`. No per-kind field names.
- `shelf` is still a line you intersect and a length you read.
- Free vs through is literal vs `dist` / `[LENGTH]`.
- NaN is total: no `null`, no hopping, no handle at a non-finite placement.
