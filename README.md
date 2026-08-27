# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach constructors (`point`, `circle`, `parallelLine`) and a view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

Docs: [docs/README.md](./docs/README.md). Current charter: [Prototype 8](./docs/prototypes/8.md) (mentionable scopes). P7 geometry is still the running tape.

## Run

```sh
pnpm install
pnpm demo
```

Opens [http://127.0.0.1:43127](http://127.0.0.1:43127) — **oblik-demo**, the P6 runtime (one `oblik` package, Solid + SVG, `defineScene` / `evaluate` / draft). Scene picker: `?scene=shelf` (default), `pie`, `fillet`, `triangle`, `shared-loop`, `truss`, `mounting-plate`. Drag a handle; release writes the scene file.

Migrated from P5 euclid2 (construction graphs only — no fill, SDF, or 3D):

| Scene | What it exercises |
| --- | --- |
| Shelf | `parallelLine`, `-shelf.distance` cellar, lamp glider, `dist` beam, `circleLineIntersection` |
| Shared loop | `for` + one radius id (`occ`), `signedDist` offset, `dist` circle |
| Truss | `pointOnSegment` gliders, shared `.radius` for posts/roof (two segments, not a polyline) |
| Mounting plate | Parent binds `const plate = mountingPlateLayout()`. Snap `plate.drill` from `build`; dive to insert in the layout file |
| Pie | Three sectors on one circle; `roundOffset(wedge, -gap)` opens the cuts |
| Fillet | Gallery of `fillet(A, r)` cases: opposite corners, all-round + inset, adjacent overlap, L-notch, sector rim/tip, flat origin, clockwise |
| Triangle | three free points |

Still missing vs P5 2D (not migrated): **`vector`**, **`polyline` / `arc`**, **`offsetLine({ mirror })`** (use `-x.distance`), plate **fillets/slots**, **slider labels**, style/fill/`drawPlate`, sdf2 / 3D.

The P5 paper app is still here:

```sh
pnpm dev
```

Opens [http://127.0.0.1:43117](http://127.0.0.1:43117). **New scene** writes `apps/paper/src/scenes/<id>.scene.ts`.

## P6 slice

- Scene module: `export default defineScene({ kind, title, camera?, build })`.
- Trailing call arg is the uuid: `circle(A, 2.5, "o_ab12")`.
- `draft` is an override until the new module’s `build()` has run.
- Space inserts Point / Circle / Line / Segment / Parallel / Perpendicular / Slider / Profile / Round offset / Fillet via `Expr` (snap from the tape). Each verb owns click, ghost, preview, Tab fields, and Enter. Pane only routes keys — there is no `session.ts`. Type a number to lock a length or axis; Tab names the bind. Length slots reuse sliders and fields (`reach.radius`, `-shelf.distance`); a named point or crossing in that slot writes `dist` / `signedDist` instead. Gliders are Point-only (other tools consume them, they do not create them). Profile is point → carrier → point until close; circles write `along(c, k)`; the insert is `profile([...], id)`. Round offset is a profile, then a length (`reach.radius`, `shelf.distance`, a slider, or a click). Fillet is a profile corner, then a length; it patches `fillet(A, r)` into that vertex of the existing `profile([...])` (no new `const`).
- Euclid2 camera is a group transform over aspect-correct NDC `viewBox` (y-up via `scale(1,-1)`). Handles move by relative Δ. Click selects; drag commits and leaves the current pick alone.
- What we learned by using it (Tab, gliders vs `.distance`, Solid 2 pane identity, scene-loader HMR): [Prototype 6](./docs/prototypes/6.md#learned-from-using-it).

P5 paper notes (catalog, Space, layouts): [docs/scenes.md](./docs/scenes.md).
