# Scenes

A file in `apps/paper/src/scenes/*.ts` is the registry. The shell Vite plugin parses it (does not execute it) into `virtual:scene-catalog`. Nav and `?scene=` come from the catalog. **New scene** on the welcome screen POSTs `/__create-scene` and writes a starter file.

Id defaults to the filename stem (`beam.ts` → `beam`). Override with `export const id`.

```ts
export const title = "Beam truss";
export const view = "euclid2";
export const hint = "Drag the posts…";
export const camera = { x: 0, y: 0, scale: 16 };
export const camera3 = { position: [18, -24, 13], target: [0.3, 0, 1.15] };
export const sceneFile = "beam.ts";
export function scene() { /* … */ }
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

## Visual language

| On screen | Meaning | Writes |
| --- | --- | --- |
| Cream solid | Inert geometry (`circle`, `drawPlate`, SDF fill) | nothing |
| Coral filled dot | `editPoint` / glider | literals |
| Coral dashed ring | `editDistanceToPoint` | `d` |
| HUD slider | `editNumber` | `n` |
| Gold / blue | pick highlight | nothing |

## Space palette

**Space** opens a command palette on the focused pane. Commands come from the view host.

euclid2 and sdf2:

1. **Point** — click empty paper → insert `const p = editPoint(x, y)` into `scene()`.
2. **Distance** — click an `editPoint` already bound as a named `const` in `scene()`, then a radius → insert `const d = editDistanceToPoint(p, r)`. Empty paper for a new origin, then a radius → insert both.

`scene()` may leave new editors unused.

Esc cancels. The completed command is one text edit. Undo is the editor.

Inserting after `return drawPlate(plateLayout())` rewrites to `const __scene = drawPlate(plateLayout()); …; return __scene` so AST order still matches evaluation. A handle declared in `plateLayout()` (outside `scene()`) is refused — inserting *before* `plateLayout()` would shift widget indices.

euclid3 and sdf field: Space reports no insert commands yet.

## Catalog scenes

| URL | What you get |
| --- | --- |
| [?scene=beam](http://127.0.0.1:43117/?scene=beam) | One truss. `group()` namespaces **paths** (`group[0] › line[2]`). The roof uses the middle ring’s `r1`. |
| [?scene=flat](http://127.0.0.1:43117/?scene=flat) | Two trusses, no group. Pick identity is still unique (`id` is a UUID). Paths are global counters; provenance may share a library line. |
| [?scene=shared](http://127.0.0.1:43117/?scene=shared) | One `editDistanceToPoint` feeds all three rings and `hubRadius`. Drag the dashed circle: everything follows in real time; one literal is written on release. |
| [?scene=plate](http://127.0.0.1:43117/?scene=plate) | Milled plate: stock, four corner bolts (shared drill Ø), polar array (center, PCD, tap Ø), titled **Hole count** slider, pocket + fillet, slot. |
| [?scene=nest](http://127.0.0.1:43117/?scene=nest) | Print grid. `withoutWidgets(plateLayout)` instanced in a nest; columns / rows / gap are titled sliders. Polar-array **count steps by column**. |
| [?scene=relative](http://127.0.0.1:43117/?scene=relative) | Write-back stress. Left `editPoint` is literals (writes). Right is `a.x + …, a.y + …` (preview only; pointer-up cannot patch expressions). |
| [?scene=gear](http://127.0.0.1:43117/?scene=gear) | Involute spur pair. Drag the pinion centre, pitch radius, and **mesh angle**. Tooth counts, pressure, and helix are titled sliders. The wheel is derived. |
| [?scene=ring](http://127.0.0.1:43117/?scene=ring) | Signet band, unrolled. Plan-view bore + developed strip (`2πR`). Shank and signet heights are distances on the paper; Gauge is wall thickness. |
| [?scene=ringsplit](http://127.0.0.1:43117/?scene=ringsplit) | Same library wrapped with `wrapBand` around a cylinder. The 3D scene has no widgets — a second view of `ring.ts`. |
| [?scene=rose](http://127.0.0.1:43117/?scene=rose) | Joined rings, filled disks, then quatrefoil cuts. Three panes: packed plan (`cylinder.ts`), sweep profile (`profile.ts`, X radial / Y is Z), SDF field. |
| [?scene=profile](http://127.0.0.1:43117/?scene=profile) | 2D SDF profile used by the cylinder sweep. Three circles, each with a point and a radius. |
| [?scene=helix](http://127.0.0.1:43117/?scene=helix) | Helical gears (3D). Closed tooth loops run through `extrude(..., { twist })`. Face width is the 3D glider. |
| [?scene=gearsplit](http://127.0.0.1:43117/?scene=gearsplit) | 2D gear and 3D helix side by side. 2D drags update the helix live. |
| [?scene=mill](http://127.0.0.1:43117/?scene=mill) | 3D extrusion of the plate. XY is read from `plate.ts` with gizmos off. Thickness is the 3D glider; write-back patches `mill.ts`. |
| [?scene=split](http://127.0.0.1:43117/?scene=split) | Plate 2D and mill 3D. Drag 2D handles and the mill follows **while you drag**; thickness stays a 3D-only widget. |
