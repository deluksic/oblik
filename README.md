# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach constructors (`point`, `circle`, `parallelLine`) and a view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

Docs: [docs/README.md](./docs/README.md). Current charter: [Prototype 9](./docs/prototypes/9.md) (figure — paint and style). P8 mention is shipped. P7 Loop / Region / Csg2 is the running tape.

## Run

```sh
pnpm install
pnpm demo
```

Opens [http://127.0.0.1:43127](http://127.0.0.1:43127) — **oblik-demo**, the P6 runtime (one `oblik` package, Solid + SVG, `defineScene` / `evaluate` / draft). Scene picker: `?scene=shelf` (default), `pie`, `fillet`, `triangle`, `shared-loop`, `truss`, `mounting-plate`, `mounting-plate-grid`, `nested-circles`, `plate-figure`, `arcade`, `stock-cutters`, `stock-cutters-figure`. Drag a handle; release writes the scene file. Figure scenes: click ink to inspect, hold Shift for construction, Space for Brush / Eraser. Export is later.

Migrated from P5 euclid2 (construction graphs only — no fill, SDF, or 3D):

| Scene               | What it exercises                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shelf               | `parallelLine`, `-shelf.distance` cellar, lamp glider, `dist` beam, `circleLineIntersection`                                                              |
| Shared loop         | `for` + one radius id (`occ`), `signedDist` offset, `dist` circle                                                                                         |
| Truss               | `pointOnSegment` gliders, shared `.radius` for posts/roof (two segments, not a polyline)                                                                  |
| Mounting plate      | Parent binds `const plate = mountingPlateLayout()`. Cheese `region(..., [drill, h1, h2, h3])`. Snap `plate.drill` from `build`; dive to insert in the layout file; Add to return for a private local |
| Mounting plate grid | 3×2 `for` of the same helper. Dive one plate; siblings mute. Serial is once-id `occ`, not a second document                                               |
| Nested circles      | Two-level helpers (`nestedCircles` → `petal`). Parent draws nested geometry; the inner bead is not referable there                                        |
| Plate figure        | P9: same `mountingPlateLayout()`. Cream paper, page `frame`; Brush dock for stroke/fill/width/dash. Outline not returned stays onioned                    |
| Pie                 | Three sectors on one circle; `roundOffset(region([...], []), -gap)` opens the cuts                                                                        |
| Fillet              | Gallery of `fillet(A, r)` cases: opposite corners, all-round + inset, adjacent overlap, L-notch, sector rim/tip, flat origin, clockwise                   |
| Arcade              | Pac-Man `diff(disk, [mouth])`; ghost `diff(union([head, tunic, scallops]), [eyes])`                                                                        |
| Stock-cutters       | CSG plate: `diff` / `intersect` / `pick` of stock, drills, stadium slot, half-planes                                                                      |
| Triangle            | three free points                                                                                                                                         |

Still missing vs P5 2D (not migrated): **`vector`**, **`polyline` / `arc`**, **`offsetLine({ mirror })`** (use `-x.distance`), **slider labels**, sdf2 / 3D. P7 shipped regions / fillets / planar CSG; P9 figure is paint, not `{ style }` on constructors.

The P5 paper app is still here:

```sh
pnpm dev
```

Opens [http://127.0.0.1:43117](http://127.0.0.1:43117). **New scene** writes `apps/paper/src/scenes/<id>.scene.ts`.

## P6 slice

- Scene module: `export default defineScene({ kind, title, camera?, build })`.
- Trailing call arg is the uuid: `circle(A, 2.5, "o_ab12")`.
- `draft` is an override until the new module’s `build()` has run.
- Space inserts Point / Circle / Line / Segment / Parallel / Perpendicular / Slider / Region / Round offset / Fillet via `Expr` (snap from the tape). Each verb owns click, ghost, preview, Tab fields, and Enter. Pane only routes keys — there is no `session.ts`. Type a number to lock a length or axis; Tab names the bind. Length slots reuse sliders and fields (`reach.radius`, `-shelf.distance`); a named point or crossing in that slot writes `dist` / `signedDist` instead. Gliders are Point-only (other tools consume them, they do not create them). Region is point → carrier → point until close; circles write `along(c, k)`; the insert is `region([...], [], id)`. Round offset is a region, then a length (`reach.radius`, `shelf.distance`, a slider, or a click). Fillet is a region corner, then a length; it patches `fillet(A, r)` into that vertex of the existing `region([...], [], id)` (no new `const`). Snap and insert print names legal in the **focused function + invocation** (P8). Select is scope; other invocations mute. Add to return writes a shorthand field on a helper’s object-literal `return` — it does not remove one.
- Euclid2 camera is a group transform over aspect-correct NDC `viewBox` (y-up via `scale(1,-1)`). Handles move by relative Δ. Click selects; drag commits and leaves the current pick alone.
- What we learned by using it (Tab, gliders vs `.distance`, Solid 2 pane identity, scene-loader HMR): [Prototype 6](./docs/prototypes/6.md#learned-from-using-it).

P5 paper notes (catalog, Space, layouts): [docs/scenes.md](./docs/scenes.md).
