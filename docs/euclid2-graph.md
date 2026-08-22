# euclid2 graph

One constructor per object. TypeScript types are the object (`Circle`, `Point`, `number`). Literal vs computed is not a TS distinction (`2.4` and `dist(c, q)` are both `number`), so **potential vs actual** editability is AST + scene context.

```
circle(c, 2.4, { edit: true })     // actual: radius handle, write the 2.4
circle(c, 2.4)                     // potential only: free param, no handle
circle(c, dist(c, q))              // determined: never a radius handle
point(1.2, 0.4, { edit: true })
offsetLine(L, 1.2, { edit: true }) // OffsetLine <: Line; .d is DOF
```

`{ edit: true }` = this scene actually edits the call’s numeric literals. Strip it → object stays, handle gone. Tool writes the flag because it knows which graph it just built.

```
circle(c, dist(c, q), { edit: true })   // reject: not potentially editable
```

`{ draw: false }` hides the stroke; type unchanged.

```
OffsetLine = Line & { d: number; base: LineLike }
```

## Potential vs actual

| radius arg | graph | handle in owning scene |
| --- | --- | --- |
| `dist(c, q)` / any call or imported value | determined | never |
| numeric literal | **potential** (free param) | only if `{ edit: true }` |
| name bound to a scene literal | potential at that binding | only if that site is actual |
| library `circle(c, 3)` / other scene | potential in *their* source | never here |

**Potential:** this slot is not determined by other nodes (a literal, or a scene-owned name whose initializer is). Write-back has a number to rewrite.

**Actual:** this scene shows a handle. Same graph can be actual in the owner scene and not in a consumer (`withoutWidgets` / import).

TS cannot reject `{ edit: true }` + `dist(...)`. Scene check: actual ⇒ potential (DOF args are numeric literals, including `-1.2`). On failure: diagnostic, no handle, do not snapshot into a literal. Optional fix: strip the flag.

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

## Tools write

| tool | slots | source |
| --- | --- | --- |
| Point | `<Point>` | `point(x, y, { edit: true })` / reuse / `lineIntersection` / `circleLineIntersection(..., +1)` |
| Circle | `<Point>`, `<number \| Point>` | `circle(c, 2.4, { edit: true })` or `circle(c, dist(c, q))` |
| Line | `<Point>`, `<Point>` | `line(a, b)` |
| Segment | `<Point>`, `<Point>` | `segment(a, b)` |
| Offset | `<LineLike>`, `<number>` | `offsetLine(L, 1.2, { edit: true })` |
