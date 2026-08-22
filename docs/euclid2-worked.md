# Worked example — shelf, reach, beam

Figure: two points on a ground line, a parallel shelf, a reach circle at A that hits the shelf at P, a lamp whose beam is the circle through P, that beam hits the ground at Q, a line through P and Q, and a cellar parallel at the same distance on the other side.

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
| 12 | Offset | ground, then shelf’s **`.d` handle** (other side) | `const cellar = offsetLine(ground, -shelf.d)` |

```ts
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

  const cellar = offsetLine(ground, -shelf.d);
}
```

`shelf` is `OffsetLine <: Line`: intersect it, and read `.d`. `cellar` is determined by that `.d`.

## After the call-site annotator

| call | `__annotations__.editable` | write |
| --- | --- | --- |
| `point(0, 0)` | true | `0`, `0` |
| `point(6, 0.4)` | true | `6`, `0.4` |
| `line(A, B)` | false | — (drag A, B) |
| `offsetLine(ground, 1.8)` | true | `1.8` |
| `circle(A, 2.5)` | true | `2.5` |
| `circleLineIntersection(reach, shelf, +1)` | false | branch is a literal but not a drag DOF |
| `segment(A, P)` | false | — |
| `point(2.2, 3.1)` | true | lamp |
| `circle(lamp, dist(lamp, P))` | false | — (P and lamp drive r) |
| `circleLineIntersection(beam, ground, +1)` | false | — |
| `line(P, Q)` | false | — |
| `offsetLine(ground, -shelf.d)` | false | — (shelf owns d) |

Handles: A, B, lamp, shelf distance, reach radius. Not: P, Q, beam radius, cellar, ground as a whole.

## Drags (DAG)

| drag | follows |
| --- | --- |
| A | ground, shelf, cellar, reach, P, segment, beam, Q, PQ |
| B | ground (direction), shelf, cellar, Q’s line, not reach’s radius |
| shelf `1.8` | shelf, P, beam, Q, PQ, cellar (`-shelf.d`) |
| reach `2.5` | P, segment, beam, Q, PQ |
| lamp | beam, Q, PQ; P does not move |
| P | cannot; not a handle |

`beam` through P: lamp drives the circle; P does not stay on it if you could drag a beam radius (there isn’t one).

## Where it falls apart

**1. Shared `const r = 1.8`**

Hand-written `circle(A, r); offsetLine(ground, r)`: both args are names, annotator sets `editable: false`, **no handles**. Potential editability sits on the `const`, which has no constructor to hang a ring or parallel on. Tools never emit this; typing it is a dead end unless the annotator chases one-hop scene literals (then: which gizmo shape?).

**2. Offset slot vs Circle slot (asymmetric unless we copy it)**

Circle second slot: `number | Point` → `2.5` or `dist(lamp, P)`. Offset second slot must be the same shape or Offset is weaker:

| click | must write |
| --- | --- |
| type / empty | `offsetLine(ground, 1.8)` |
| point R | `offsetLine(ground, signedDist(R, ground))` |
| another offset’s `.d` | `offsetLine(ground, shelf.d)` or `-shelf.d` |

Without `signedDist`, “parallel through this point” cannot be said. With it, drag R moves the parallel; **drag the parallel and keep R on it** is two-way — not in the graph.

**3. Same ink, two types**

Shelf is a `Line` and has `.d`. Offset tool, first slot `LineLike`: click the stroke → `offsetLine(shelf, …)` (offset the offset). Second slot `number`: click the **distance handle** → `shelf.d`. Clicking the stroke in a Length slot is a miss or a wrong bind. Step 12 only works if `.d` is a distinct hit target. If the handle *is* the stroke (drag perpendicular on the line), Length vs LineLike is **which tool slot is active**, not which pixels. That is workable; it is easy to teach wrong (“click the shelf to copy height” copies the line instead).

**4. `+1` / `-1` is a frozen branch**

`P` does not hop to the other root when the circle shrinks or A moves past the tangent. It goes undefined. Correct for DAG; feels like a bug if the user “meant the other hit.” No type-level fix; a later tool could rewrite the literal `+1` → `-1`.

**5. `lineIntersection(ground, shelf)`**

Parallels → `null`. A Point-tool click near “where they meet” (vanishing) must not become `editPoint` at the cursor. Easy to get wrong in the resolver.

**6. `pointOnLine(shelf, s)` (Point tool on the shelf, not at P)**

`s` is along `shelf.direction` from `shelf.origin`. `offsetLine` that keeps direction and does `origin + n*d` is fine: the glider rides the parallel. `line(A, B)` uses **A as origin**: drag A *along* the line and a glider with fixed `s` slides with A instead of staying in the world. Carrier frame is part of the graph, not implied by `Line`.

**7. Offset of a segment**

Click a `segment(A, B)` for Offset: `LineLike` accepts it, result is still an **infinite** `OffsetLine`. User may expect a finite parallel. Type-compatible, intent-wrong. Separate `offsetSegment` or refuse Segment in that slot.

**8. Cellar sign is a computation**

`-shelf.d` is not a literal → no cellar handle. Linked distances are correct for step 12. Independent other-side distance is a **new literal** from click-empty, not a projection. Two different graphs, one tool; the Length resolver has to pick.

**9. Beam has no radius handle — by design, and it feels like a missing tool**

`circle(lamp, dist(lamp, P))` vs `circle(lamp, 2.5)` are the same `Circle` type. Only `__annotations__.editable` differs. User who “just wanted to resize the beam” must delete `dist` and insert a literal (and lose through-P). The language cannot be both.

**10. Two-way coincidences the figure suggests**

- Drag reach so P stays under A (vertical).
- Drag shelf and keep P; also keep beam radius.
- Drag Q along the ground and have the lamp follow (inverse of `circleLineIntersection`).

All of those are extra constraints, not projections. The graph will not do them. A solver as a later pure function could, on a subgraph.

**11. Missing constructors, not type holes**

Midpoint, perpendicular, foot of perpendicular (`project(lamp, ground)`), tangents from lamp to `reach`. Users will try to fake them with offsets of magic numbers. That is a catalog gap. It will be mistaken for the DAG “not being enough.”

**12. Annotator does not see `+1` as editable, and should not**

Branch is a literal. A handle on it would be a discrete toggle, not a drag. If we later want that, it is a different annotation (`editable: "branch"`), not `number` write-back.

## What still holds

- `shelf` as intersectable line **and** `shelf.d` as the cellar’s distance is the OffsetLine product type, not two functions.
- Free vs through (`reach` vs `beam`) is literal vs `dist`, which the annotator can see.
- Write-back targets are only the five literal sites above.
- Stripping freeze: `circle(A, 2.5, { editable: false })` keeps the constant; annotator sets `__annotations__.editable: false`.
