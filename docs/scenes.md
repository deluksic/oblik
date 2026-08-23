# Scenes

Shell chrome (nav, welcome, viewport panes, inspector, command palette) is Solid 2 (`@design-scenes/shell` under `packages/shell/src/ui/`). Canvas hosts stay vanilla TypeScript in `@design-scenes/hosts`.

A file in `apps/paper/src/scenes/*.scene.ts` is the catalog. Plain `*.ts` in the same folder (e.g. `plate-layout.ts`) can hold shared constructors and is not in nav. The shell Vite plugin parses catalog files (does not execute them) into `virtual:scene-catalog`. Nav and `?scene=` come from the catalog. **New scene** on the welcome screen POSTs `/__create-scene` and writes a starter `<id>.scene.ts`.

Id defaults to the filename stem (`beam.scene.ts` → `beam`). Override with `export const id`.

```ts
export const title = "Beam truss";
export const view = "euclid2";
export const hint = "Drag the posts…";
export const camera = { x: 0, y: 0, scale: 16 };
export const camera3 = { position: [18, -24, 13], target: [0.3, 0, 1.15] };
export const sceneFile = "beam.scene.ts";
export function scene() {
  /* widgets + constructors; return is optional */
}
```

`view` is `"euclid2" | "euclid3" | "sdf" | "sdf2"`. Default `"euclid2"`. Unknown view → error pane.

Paper registers hosts in `apps/paper/src/main.ts`. The shell does not import geometry. Each pane gets a canvas the shell created. Pointer-down on a pane owns the inspector.

A file may export `scene()` or `layout`, not both.

## Layout files

Cell names are scene ids. The shell sets `grid-template-areas` / `grid-template-columns` on the viewport and `grid-area: <id>` on each pane.

```ts
export const title = "Cylinder";
export const layout = {
  areas: `"cylinder profile rose-sdf"`,
  columns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.15fr)",
};
```

Layout files must not import pane modules. Live drag still updates the other panes via widget channels (`"plate"`, `"cylinder"`, `"profile"`). A missing id in `areas` shows an error in the empty slot; other panes still mount.

## Marks

| On screen         | Meaning                                          | Writes     |
| ----------------- | ------------------------------------------------ | ---------- |
| Cream stroke      | Geometry (`line`, `circle`, `segment`, `drawPlate`, SDF fill) | nothing |
| Coral             | Editable handle (point, radius, offset, vector, …) | literals |
| HUD slider        | Number widget (`slider`)                         | `n`        |
| Hover / select    | Pick highlight                                   | nothing    |

## Space palette

**Space** opens a command palette on the focused pane. Pick a command and the palette **docks to the bottom** of that pane as a live preview of the TypeScript call, with the current slot highlighted. No dim overlay while the prompt is active.

Commands come from the view host.

euclid2:

1. **Point** — empty paper → `point(x, y)`; named point → no-op; line crossing → `lineIntersection`; circle ∩ line → `circleLineIntersection(..., ±1)` from the click.
2. **Circle** — Point, then Length: literal / measure → `circle(c, 2.4)`; Offset → `.distance`; Circle → `.radius`; slider → the name; Point → `dist(c, q)`.
3. **Line** / **Segment** — two Points → `line(a, b)` / `segment(a, b)`.
4. **Offset** — LineLike (Line, Segment, `offset.line`), then Length (same introductions as Circle; Point → `signedDist`). Emits `offsetLine(...)`. Further intersects use `.line`.
5. **Slider** — type or click-measure → `const r = slider(1.8)`. Length-slot click reuses the name.

sdf2: Point + Distance only. Point writes `point(x, y)`; Distance writes `circle` / `offsetLine`. Coral rings come from annotated constructors (sdf2 collects drawables even though it does not stroke cream geometry).

`scene()` may be void. Geometry constructors register themselves when called (same idea as widgets). A return value is still flattened for scenes that list geometry. Inspect provenance is the **user call stack** (demo helpers and `scene`) for both cream strokes and coral handles, not a grouping API.

Inserts add statements inside `scene()` (before an existing `return`, or at the end of a void body). A handle declared in `plateLayout()` (outside `scene()`) is refused.

Esc cancels the active command and closes the docked prompt. The completed command is one text edit. Undo is the editor.

euclid3 and sdf field: Space reports no insert commands yet.

## Catalog scenes

| URL                                                             | What you get                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [?scene=beam](http://127.0.0.1:43117/?scene=beam)               | One truss. Paths are `kind[n]` this frame. The roof uses the middle ring’s `r1`.                                                                                                                         |
| [?scene=flat](http://127.0.0.1:43117/?scene=flat)               | Two trusses. Pick identity is unique (`id` is a UUID). Paths are global `kind[n]` counters; the stack still names which helper produced a stroke.                          |
| [?scene=shared](http://127.0.0.1:43117/?scene=shared)           | One `circle(p1, 1.33)` feeds all three rings and `hubRadius`. Drag a ring: everything follows in real time; one literal is written on release.                                                                    |
| [?scene=shared-loop](http://127.0.0.1:43117/?scene=shared-loop) | Five derived origins around one `point`. A `for` calls `circle(p, 1)`. Five rings, one `1`. Drag any ring: all five follow; pointer-up rewrites that single literal.             |
| [?scene=plate](http://127.0.0.1:43117/?scene=plate)             | Milled plate: stock, four corner bolts (one **vector** inset mirrored to all corners; shared **drill Ø** helpers), polar array, pocket fillets on **pointOnLine** bisectors, slot (**pointOnSegment** on top edge). |
| [?scene=nest](http://127.0.0.1:43117/?scene=nest)               | Print grid. `withoutWidgets(plateLayout)` instanced in a nest; columns / rows / gap are titled sliders. Polar-array **count steps by column**.                                                                                  |
| [?scene=relative](http://127.0.0.1:43117/?scene=relative)       | Offset handle. Left `point` writes position; `vector` writes `dx`/`dy`; the second centre is derived.                                                                                                                   |
| [?scene=gear](http://127.0.0.1:43117/?scene=gear)               | Involute spur pair. Drag the pinion centre, pitch radius, and **mesh angle**. Tooth counts, pressure, and helix are titled sliders. The wheel is derived.                                                                       |
| [?scene=ring](http://127.0.0.1:43117/?scene=ring)               | Signet band, unrolled. Plan-view bore + developed strip (`2πR`). Shank and signet heights are distances on the paper; Gauge is wall thickness.                                                                                  |
| [?scene=ringsplit](http://127.0.0.1:43117/?scene=ringsplit)     | Same library wrapped with `wrapBand` around a cylinder. The 3D scene has no widgets — a second view of `ring.ts`.                                                                                                               |
| [?scene=rose](http://127.0.0.1:43117/?scene=rose)               | Joined rings, filled disks, then quatrefoil cuts. Three panes: packed plan (`cylinder.ts`), sweep profile (`profile.ts`, X radial / Y is Z), SDF field.                                                                         |
| [?scene=profile](http://127.0.0.1:43117/?scene=profile)         | 2D SDF profile used by the cylinder sweep. Three circles, each with a point and a radius.                                                                                                                                       |
| [?scene=helix](http://127.0.0.1:43117/?scene=helix)             | Helical gears (3D). Closed tooth loops run through `extrude(..., { twist })`. Face width is the 3D glider.                                                                                                                      |
| [?scene=gearsplit](http://127.0.0.1:43117/?scene=gearsplit)     | 2D gear and 3D helix side by side. 2D drags update the helix live.                                                                                                                                                              |
| [?scene=mill](http://127.0.0.1:43117/?scene=mill)               | 3D extrusion of the plate. XY is read from `plate-layout.ts` with gizmos off. Thickness is the 3D glider; write-back patches `mill.scene.ts`.                                                                                   |
| [?scene=split](http://127.0.0.1:43117/?scene=split)             | Plate 2D and mill 3D. Drag 2D handles and the mill follows **while you drag**; thickness stays a 3D-only widget.                                                                                                                |
| [?scene=mounting-plate](http://127.0.0.1:43117/?scene=mounting-plate) | Four-hole plate from construction geometry; `drawMountingPlate` in `demo/mounting-plate.ts`. |
| [?scene=mounting-plate-pair](http://127.0.0.1:43117/?scene=mounting-plate-pair) | Two plates via `drawMountingPlatePair` — shared inset and drill, second origin only. |
| [?scene=shelf](http://127.0.0.1:43117/?scene=shelf) | Construction graph: ground, shelf offset, reach circle, lamp beam. Handles on A, B, lamp, `1.8`, `2.5` — not on P, Q, beam, or cellar. |
