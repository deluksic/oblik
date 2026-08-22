# euclid2 graph

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
OffsetLine = Line & { d: number; base: LineLike }
```

`{ draw: false }` hides the stroke; type unchanged.

## Potential vs actual

| radius arg | graph | `editable` from annotator |
| --- | --- | --- |
| `dist(c, q)` / call / imported | determined | omit |
| numeric literal | potential | `true`, unless disk says `editable: false` |
| name bound to a scene literal | potential at that binding | not at this call (nothing to write here) |

TS types do not distinguish `2.4` from `dist(c, q)`. The annotator does.

Handles only where `editable: true` landed **and** this scene owns the site (not a silent consumer).

## Objects

```
point(x: number, y: number): Point
circle(center: Point, radius: number): Circle
line(a: Point, b: Point): Line
segment(a: Point, b: Point): Segment
offsetLine(base: LineLike, d: number): OffsetLine

dist(a: Point, b: Point): number
distToLine(p: Point, line: LineLike): number
lineIntersection(a: LineLike, b: LineLike): Point | null
circleLineIntersection(c: Circle, l: LineLike, k: Branch): Point | null
circleCircleIntersection(a: Circle, b: Circle, k: Branch): Point | null
```

Projections: `.center` `.radius` `.d` `.x` `.y`. Slot of `T` takes a `T` or writes a projection.

## Tools write (disk)

| tool | slots | disk |
| --- | --- | --- |
| Point | `<Point>` | `point(x, y)` / reuse / `lineIntersection` / `circleLineIntersection(..., +1)` |
| Circle | `<Point>`, `<number \| Point>` | `circle(c, 2.4)` or `circle(c, dist(c, q))` |
| Line | `<Point>`, `<Point>` | `line(a, b)` |
| Segment | `<Point>`, `<Point>` | `segment(a, b)` |
| Offset | `<LineLike>`, `<number>` | `offsetLine(L, 1.2)` |
