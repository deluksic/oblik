# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach constructors (`point`, `circle`, `parallelLine`) and a view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

Docs: [docs/README.md](./docs/README.md). Current charter: [Prototype 6](./docs/prototypes/6.md).

## Run

```sh
pnpm install
pnpm demo
```

Opens [http://127.0.0.1:43127](http://127.0.0.1:43127) — **oblik-demo**, the P6 runtime (one `oblik` package, Solid + SVG, `defineScene` / `evaluate` / draft). Scene picker: `?scene=shelf` (default), `triangle`, `shared-loop`, `truss`, `mounting-plate`. Drag a handle; release writes the scene file.

Migrated from P5 euclid2 (construction graphs only — no fill, SDF, or 3D):

| Scene | What it exercises |
| --- | --- |
| Shelf | `parallelLine`, `-shelf.distance` cellar, lamp glider, `dist` beam, `circleLineIntersection` |
| Shared loop | `for` + one radius id (`occ`), `signedDist` offset, `dist` circle |
| Truss | `pointOnSegment` gliders, shared `.radius` for posts/roof (two segments, not a polyline) |
| Mounting plate | AABB from two corners, inset via `.distance`, holes via `.radius` |
| Triangle | three free points |

Still missing vs P5 2D (not migrated): **`vector`** (relative offset widget), **`polyline` / `arc`**, **`offsetLine({ mirror })`** (use `-x.distance`), constructors in **helpers outside the scene file** (no stamp → invisible), plate **fillets/slots** (`pointOnLine(origin, dir)`), **slider labels**, style/fill/`drawPlate`, sdf2 / 3D.

The P5 paper app is still here:

```sh
pnpm dev
```

Opens [http://127.0.0.1:43117](http://127.0.0.1:43117). **New scene** writes `apps/paper/src/scenes/<id>.scene.ts`.

## P6 slice

- Scene module: `export default defineScene({ kind, title, camera?, build })`.
- Trailing call arg is the uuid: `circle(A, 2.5, "o_ab12")`.
- `draft` is an override until the new module’s `build()` has run.
- Space inserts Point / Circle / Line / Segment / Parallel / Perpendicular / Slider via `Expr` (snap from the tape). Each verb owns click, ghost, preview, Tab fields, and Enter. Pane only routes keys — there is no `session.ts`. Type a number to lock a length or axis; Tab names the bind. Length slots reuse sliders and fields (`reach.radius`, `-shelf.distance`). Gliders are Point-only.
- Euclid2 camera is a group transform over aspect-correct NDC `viewBox` (y-up via `scale(1,-1)`). Handles move by relative Δ.

P5 paper notes (catalog, Space, layouts): [docs/scenes.md](./docs/scenes.md).
