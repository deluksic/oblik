# euclid2 calls

Types: `Point <: Vec2`, `number`, `Line`, `Segment`, `Circle`, `LineLike = Line | Segment`, `Branch = +1 | -1`.
Widget 2nd args that write back must be **numeric literals**. `site?` omitted below.

## Free values (gizmo)

```
editPoint(x: number, y: number): Point
editDistanceToPoint(origin: Point, d: number): number      // ring; value is d, independent of any other point
editOffsetFromLine(line: LineLike, d: number): number      // dashed parallel; value is signed d
editPointOnSegment(seg: Segment, t: number): Point         // t ∈ [0,1]
editPointOnLine(line: LineLike, s: number): Point          // today: (origin, dir, s)
editNumber(n: number, opts): number
editAngle(origin: Point, degrees: number): number          // returns radians
editVector(origin: Point, dx: number, dy: number): Vec2
```

## Derived values (no gizmo)

```
dist(a: Point, b: Point): number
distToLine(p: Point, line: LineLike): number               // today: (p, origin, dir)
lineIntersection(a: LineLike, b: LineLike): Point | null
circleLineIntersection(c: Circle, l: LineLike, k: Branch): Point | null   // missing
circleCircleIntersection(a: Circle, b: Circle, k: Branch): Point | null   // missing
```

## Strokes

```
segment(a: Point, b: Point): Segment
line(a: Point, b: Point): Line
circle(center: Point, radius: number): Circle
offsetLine(line: LineLike, d: number): Line                // today withoutDraw — silent
point(x: number, y: number): Point                         // drawn dot; tools use editPoint (silent) instead
```

## ≡

```
circle(c, r)                         ≡  circleRadius(c, r)           // r: number from anywhere
circle(c, dist(c, q))                ≡  circlePointToPoint(c, q)
line(a, b)                          ≡  linePointToPoint(a, b)
segment(a, b)                       ≡  segmentPointToPoint(a, b)
circle(c, editDistanceToPoint(c, r)) ≡  free-radius circle           // analog:
offsetLine(L, editOffsetFromLine(L, d)) ≡ free parallel line
```

Sugar names `circleRadius` / `circlePointToPoint` are not extra math. Keep `circle` + `dist`.

## ≠

```
editDistanceToPoint(c, r): number    ≠  circle(c, r): Circle
editDistanceToPoint(c, r)            ≠  dist(c, q)
circle(c, editDistanceToPoint(c, r)) ≠  circle(c, dist(c, q))        // free r vs through q
editOffsetFromLine(L, d): number     ≠  offsetLine(L, d): Line
distToLine(p, L): number             ≠  editOffsetFromLine(L, d): number   // measured vs free
lineIntersection(l1, l2)             ≠  editPoint(x, y) at the hit
circle(c, editDistanceToPoint(c, dist(c, q)))  // illegal: dist(...) is not a writable literal
```

## Tools → writes

**Point** — one slot `<Point>`:

| pick | emit |
| --- | --- |
| empty | `const p = editPoint(x, y)` |
| named | reuse |
| L∩L | `const x = lineIntersection(l1, l2)` |
| C∩L | `const x = circleLineIntersection(c, l, +1)` |

**Circle** — `<Point>` then `<number | Point>`:

```
const c = <Point>
const r = editDistanceToPoint(c, 2.4)   // type / click empty
circle(c, r)

const c = <Point>
circle(c, dist(c, q))                   // pick point q
```

**Line** / **Segment** — `<Point>`, `<Point>`:

```
line(a, b)
segment(a, b)
```

**Distance** (optional, no stroke) — `<Point \| LineLike>` then `<number>`:

```
const r = editDistanceToPoint(c, 2.4)
const d = editOffsetFromLine(L, 1.2)
```

**Parallel** (drawn) — same Length slot, plus stroke:

```
const d = editOffsetFromLine(L, 1.2)
offsetLine(L, d)
```
