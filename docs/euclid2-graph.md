# euclid2 as a computation graph (Desmos-shaped)

P4’s resolvers (free point vs named vs crossing) are the right *mechanism*. The product cut is wrong: Space **Distance** introduces a number and stops; **Circle** / **Line** were pulled off the palette. The user wanted a circle and got a dashed ring. `edit*` vs `circle()` is an implementation split leaking into the tool list.

This note is the language for 2D paper. Constraints stay a later *pure function* if a subproblem needs them. They are not the default.

## Verdict

A **one-way computation graph** covers the listed gestures. There is no need for a constraint solver to do:

- free points
- points at line/line crossings
- points at line/circle crossings with a remembered branch
- circles whose radius is a typed number, a click-measure, or `dist(center, otherPoint)`
- infinite lines and segments through points

The graph is the TypeScript program. Click order is **dataflow**: later clicks become *inputs* to earlier names. Dragging a downstream handle does not rewrite an upstream point.

The failure mode is **two-way coincidence** (“B stays on the circle when I drag the radius”). That is a constraint. Do not fake it by also writing `editPoint` on B. Write `circle(A, dist(A, B))` and accept that B drives the circle.

## Two splits, not `edit*` vs `geom`

| Split | Free (has a handle, writes a literal) | Derived (recomputes, no literal) |
| --- | --- | --- |
| **Value** | `editPoint(x,y)`, `editDistanceToPoint(A, 2.4)`, `editOffsetFromLine(L, 1.2)`, `editPointOnLine(...)` | `lineIntersection(L1, L2)`, `dist(A, B)`, `circleLineIntersection(C, L, +1)` |
| **Stroke** | — | `circle(A, r)`, `line(A, B)`, `segment(A, B)`, `offsetLine(L, d)` |

`edit*` means “this node has degrees of freedom in the source.” `circle` / `line` / `segment` mean “draw.” A tool may emit **both in one write**. The docked preview should show the *object the user asked for* (`circle(c, r)`), not only the measurement combinator.

Dashed ring / dashed parallel are **gizmos for free lengths**, not a second kind of circle or line. Solid stroke is the constructor. Showing both for `circle(A, r)` where `r` is free is fine (slider + graph). Forcing two Space verbs is not.

## Point introductions

Same resolver everywhere a slot wants a Point.

| Click | Code | Drag |
| --- | --- | --- |
| Empty paper | `const p = editPoint(1.2, 0.4)` | freely |
| Existing named point | reuse `p` | whatever `p` already is |
| Two lines near their crossing | `const x = lineIntersection(l1, l2)` | not a point handle; follows the lines |
| On one line, not a crossing | later: `editPointOnLine` (1 DOF glider) | along the line |

Line/circle and circle/circle need an explicit branch, written as a literal (`+1` / `-1`), chosen by which solution was closer to the click at creation:

```ts
const x = circleLineIntersection(c, l, +1);
```

If that branch disappears (circle too small), the point is gone — same as Desmos undefined. Do not hop to the other root.

## Circle (the verb people expect)

One tool. Two slots: Point, then Length. Always end with a `circle(...)` stroke.

**Slot 1 — Point** (create or select):

| Click | Introduced |
| --- | --- |
| Empty | `const c = editPoint(…)` |
| Named point | reuse |
| Crossing | `const c = lineIntersection(…)` |

**Slot 2 — Length:**

| Click / key | Introduced | Circle line |
| --- | --- | --- |
| Type `2.4` / Enter | `const r = editDistanceToPoint(c, 2.4)` | `circle(c, r)` |
| Empty paper (measure) | same, literal from distance to cursor | `circle(c, r)` |
| Existing free length widget | reuse name `r` | `circle(c, r)` |
| Another point `q` | none (derived) | `circle(c, dist(c, q))` |

Last row: moving `q` moves the circle. There is **no** independent radius handle. Moving `c` also changes the circle; `q` does not move.

## Line and segment

| Tool | Clicks | Code |
| --- | --- | --- |
| Line | two Points (same resolver) | maybe introduce points, then `line(a, b)` |
| Segment | two Points | `segment(a, b)` |

Infinite vs finite is the verb. Distance-to-a-line is **not** Line. It is a length whose `from` is a line.

## Parallel / offset (when we want a second line)

If the user wants a **drawn** parallel, the write is both nodes:

```ts
const d = editOffsetFromLine(l, 1.2);
offsetLine(l, d); // stroke; today this helper is silent — that is a bug for this verb
```

`editOffsetFromLine` alone is a measurement gizmo (dashed parallel) with no constructor stroke. That matches today’s Distance-to-line and is why it feels like a broken Line tool.

## Distance as a *slot*, not a destination

Keep a **Length** resolver (type, measure, reuse widget, or `dist` to a point). Do not ship Distance as the main way to “draw a circle.” Circle/Offset/whatever *use* Length.

A standalone Distance command is optional sugar for “I need a number in the graph with a gizmo, no stroke yet.” Rare for Desmos-like sketching.

## What the current tree does

- Space Point / Distance / Line + resolvers in `packages/hosts/src/tools/session.ts` — right shape for slots.
- Distance commits `editDistanceToPoint` / `editOffsetFromLine` and **does not** emit `circle` / `offsetLine` strokes.
- `circle` is typed in files, not a Space verb (P4). So the dashed ring is the only circle-like thing the mouse can add.
- `lineIntersection` is line/line only; no signed circle-line root.
- `offsetLine` is `withoutDraw` — derived, invisible.
- Solid 2 is shell chrome (`packages/shell/src/ui`). Hosts stay canvas TS. Unrelated to this confusion.

## Constraints later

A solver is a **pure function** from `{graph, constraint list}` to `{values}` for a stubborn subproblem (equal lengths both ways, point on circle *and* free radius). Call it from a scene like any library. Do not make the default mouse a solver. Default mouse only *adds nodes* to the DAG.

## Do not

- Infer a handle from an unmarked `3` in a library.
- Snapshot `dist(c, q)` into a literal when the user clicked `q` (that would freeze the radius).
- Put gizmos in `geom`.
- Treat click-on-intersection as `editPoint` at that coordinate (it would not follow the lines).
