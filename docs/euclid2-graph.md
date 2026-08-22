# euclid2 calls

A constructor returns **one object** with a **principal type**. Other uses are **projections** (fields, or subtype of the principal geom). Slots bind a type `T` by taking a `T` or by writing a projection (`k.radius`, not a hidden coerce). Gizmos are UI for that object / its DOF field — never a third kind of value.

`edit*` = principal geom + writable literal field(s). Same principal type as the non-edit constructor; DOF is provenance, not a second type. `withoutDraw` hides the stroke; it does not change the type.

Widget literals must be numeric. `site?` omitted. Types: `Point <: Vec2`, `LineLike = Line | Segment`, `Branch = +1 | -1`.

```
OffsetLine = Line & { d: number; base: LineLike }
```

## Objects

```
editPoint(x: number, y: number): Point
  .x .y

editCircle(center: Point, radius: number): Circle          // replaces circle+editDistanceToPoint
  .center: Point
  .radius: number                                          // DOF

editOffsetLine(base: LineLike, d: number): OffsetLine      // replaces editOffsetFromLine+offsetLine
  <: Line
  .d: number                                               // DOF
  .base: LineLike

editPointOnSegment(seg: Segment, t: number): Point
  . /* Point */  t is DOF, not a projection others need

editPointOnLine(line: LineLike, s: number): Point

circle(center: Point, radius: number): Circle              // no DOF; radius may be dist(...)
line(a: Point, b: Point): Line
segment(a: Point, b: Point): Segment
offsetLine(base: LineLike, d: number): Line                // derived parallel, no .d unless we return OffsetLine
```

## Derived (still objects / numbers)

```
dist(a: Point, b: Point): number
distToLine(p: Point, line: LineLike): number
lineIntersection(a: LineLike, b: LineLike): Point | null
circleLineIntersection(c: Circle, l: LineLike, k: Branch): Point | null
circleCircleIntersection(a: Circle, b: Circle, k: Branch): Point | null
```

## Projections a slot may write

| slot `T` | pick | emit |
| --- | --- | --- |
| Point | empty | `editPoint(x, y)` |
| Point | named Point | reuse |
| Point | L∩L | `lineIntersection(l1, l2)` |
| Point | C∩L | `circleLineIntersection(c, l, +1)` |
| Point | Circle center | `k.center` |
| LineLike | Line / Segment / OffsetLine | reuse (OffsetLine <: Line) |
| number | type / click empty | literal on the `edit*` being built |
| number | Circle radius handle | `k.radius` |
| number | OffsetLine | `off.d` |
| number | Point `q` (when a Point origin `c` is already bound) | `dist(c, q)` |

No `editDistanceToPoint`: a free length at `c` **is** `editCircle(c, r)`. The ring is that Circle — `circleLineIntersection` can use it.

No parallel `editOffsetFromLine` / `offsetLine` pair: a free parallel **is** `editOffsetLine(L, d)`. Intersect `off`; reuse `off.d`.

## ≡

```
editCircle(c, r).radius          ≡  (old) editDistanceToPoint(c, r)
editCircle(c, r)                 ≡  (old) circle(c, editDistanceToPoint(c, r))
circle(c, dist(c, q))            ≡  circlePointToPoint(c, q)
editOffsetLine(L, d)             ≡  (old) offsetLine(L, editOffsetFromLine(L, d))
editOffsetLine(L, d).d           ≡  (old) editOffsetFromLine(L, d)
line(a, b)                       ≡  linePointToPoint(a, b)
```

## ≠

```
editCircle(c, r)                 ≠  circle(c, dist(c, q))     // DOF radius vs through q
circle(c, r).radius              ≠  editCircle(c, r).radius  // unmarked literal is not a handle
distToLine(p, L)                 ≠  editOffsetLine(L, d).d    // measured vs free
lineIntersection(l1, l2)         ≠  editPoint at the hit
editCircle(c, dist(c, q))        // illegal write site
```

## Tools

| tool | slots | write |
| --- | --- | --- |
| Point | `<Point>` | introductions in the table |
| Circle | `<Point>`, `<number \| Point>` | `editCircle(c, 2.4)` or `circle(c, dist(c, q))` |
| Line | `<Point>`, `<Point>` | `line(a, b)` |
| Segment | `<Point>`, `<Point>` | `segment(a, b)` |
| Offset | `<LineLike>`, `<number>` | `editOffsetLine(L, 1.2)` |

`withoutDraw(() => editCircle(c, r))` if a length is needed with no stroke — same type, hidden draw. Do not add a second combinator for that.
