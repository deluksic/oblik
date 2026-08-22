# euclid2 physics

One constructor per object. `{ edit: true }` is a **source declaration**, not a runtime test. Evaluation is always the pure call. Gizmos are a host view of evaluated objects whose construction site is in the edit table.

```
circle(c, 2.4, { edit: true })     // Circle; .radius is DOF; write the 2.4
circle(c, dist(c, q))              // Circle; .radius derived; no handle
circle(c, 2.4)                     // Circle; constant; no handle
point(1.2, 0.4, { edit: true })    // Point; .x .y are DOF
offsetLine(L, 1.2, { edit: true }) // OffsetLine <: Line; .d is DOF
```

`{ edit: true }` means: **numeric literals at this call are write sites**. Names and calls are never writable. Tool inserts the flag; compiler does not infer it from unmarked literals.

```
circle(c, dist(c, q), { edit: true })   // illegal — nothing to write
```

`{ draw: false }` hides the stroke; type unchanged.

```
OffsetLine = Line & { d: number; base: LineLike }
```

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

## Compiler

Scene modules only. Walk constructor calls.

1. **Declare** — collect `{ edit: true }`. Record `{ site, callee, literalArgIndexes, fields }`.
2. **Reject** — `edit: true` with no numeric literals in those slots.
3. **Inject** — `{ file, at: [line, col] }` onto the call so the value carries identity (pick, gizmo join). Strip `edit` before eval if the runtime API has no such option.
4. **Publish** — `EditTable`: site → which field(s) of the principal type are DOF.

No gizmos in constructors. No `edit*` combinators.

## Eval

Pure functions. Result is the object (`Circle`, `Point`, …) with projections and `site`. Same type with or without the flag.

## Host (gizmos)

After eval: join drawables/values to `EditTable` by `site`. Spawn handles from **principal type + declared fields**, using evaluated numbers (`circle.radius`, `point.x/y`, `offset.d`).

A visible ring **is** that `Circle`. Intersections see it.

## Write-back

Gizmo drag → `EditTable` site + arg index → rewrite the **literal** in source. Undo is the editor.

## Tools write

| tool | slots | source |
| --- | --- | --- |
| Point | `<Point>` | `point(x, y, { edit: true })` / reuse / `lineIntersection` / `circleLineIntersection(..., +1)` |
| Circle | `<Point>`, `<number \| Point>` | `circle(c, 2.4, { edit: true })` or `circle(c, dist(c, q))` |
| Line | `<Point>`, `<Point>` | `line(a, b)` |
| Segment | `<Point>`, `<Point>` | `segment(a, b)` |
| Offset | `<LineLike>`, `<number>` | `offsetLine(L, 1.2, { edit: true })` |
