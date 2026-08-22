# euclid2 graph

Worked example: [euclid2-worked.md](./euclid2-worked.md).

Disk is the graph the tool writes. The **call-site annotator** (today: `injectSceneSites` in the Vite pre-transform) rewrites constructor calls in the **module that runs**. Disk is unchanged.

Annotator-owned fields live under `__annotations__`, not mixed into user options (`label`, `{ editable: false }`, …). If that key is already present, **overwrite it** and warn.

```
// disk                                      // after annotator
circle(c, 2.4)
  → circle(c, 2.4, { __annotations__: { file, at, editable: true } })

circle(c, dist(c, q))
  → circle(c, dist(c, q), { __annotations__: { file, at, editable: false } })

circle(c, 2.4, { editable: false })
  → circle(c, 2.4, { editable: false, __annotations__: { file, at, editable: false } })
```

`editable: true` in `__annotations__` only when DOF args are numeric literals (and disk did not freeze). User-typed `__annotations__` is never trusted. Public `{ editable: false }` is the freeze.

Not the HMR path (`hot.accept`, swallow widget writes). Same pass on first load and on save.

```
LENGTH: unique symbol
HasLength = { readonly [LENGTH]: number }

OffsetLine = Line & HasLength          // [LENGTH] is signed d
Circle extends HasLength               // [LENGTH] is radius
Segment extends HasLength              // [LENGTH] is dist(a, b)
Line, Point                            // no HasLength (infinite / none)
```

A Length slot never switches on `.radius` vs `.d`. If the hit is `HasLength` and `Number.isFinite(obj[LENGTH])`, disk is `name[LENGTH]`. `number` is already a length. Point with a bound origin is `dist(c, q)`, not `q[LENGTH]`.

Misses are **NaN**, not `null`: `Point` with `x,y` NaN, `[LENGTH]` NaN, `dist` involving them NaN. Do not draw; gizmos whose placement value is not finite are omitted. Upstream literals keep their handles (drag `2.5` until the hit exists again).

`{ draw: false }` hides the stroke; type unchanged.

## Potential vs actual

| radius arg | graph | `__annotations__.editable` |
| --- | --- | --- |
| `dist(c, q)` / `name[LENGTH]` / call | determined | `false` |
| numeric literal | potential | `true`, unless disk says `{ editable: false }` |
| name bound to a scene literal | potential at that binding | `false` at this call |

TS types do not distinguish `2.4` from `dist(c, q)`. The annotator does.

Handles only where `editable: true` **and** this scene owns the site **and** the placement value is finite.

## Objects

```
point(x: number, y: number): Point
circle(center: Point, radius: number): Circle
line(a: Point, b: Point): Line
segment(a: Point, b: Point): Segment
offsetLine(base: LineLike, d: number): OffsetLine

dist(a: Point, b: Point): number          // NaN if either point is NaN
signedDist(p: Point, line: LineLike): number
lineIntersection(a: LineLike, b: LineLike): Point                    // NaN,NaN if parallel
circleLineIntersection(c: Circle, l: LineLike, k: Branch): Point     // NaN,NaN if no hit
circleCircleIntersection(a: Circle, b: Circle, k: Branch): Point
```

Projections: `[LENGTH]`, `.center`, `.x`, `.y`. Slot of `T` takes a `T` or writes a projection.

## Tools write (disk)

| tool | slots | disk |
| --- | --- | --- |
| Point | `<Point>` | `point(x, y)` / reuse / `lineIntersection` / `circleLineIntersection(..., +1)` |
| Circle | `<Point>`, `<number \| HasLength \| Point>` | `circle(c, 2.4)` or `circle(c, other[LENGTH])` or `circle(c, dist(c, q))` |
| Line | `<Point>`, `<Point>` | `line(a, b)` |
| Segment | `<Point>`, `<Point>` | `segment(a, b)` |
| Offset | `<LineLike>`, `<number \| HasLength \| Point>` | `offsetLine(L, 1.2)` or `offsetLine(L, ±other[LENGTH])` or `offsetLine(L, signedDist(q, L))` |
