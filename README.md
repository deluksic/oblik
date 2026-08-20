# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach 2D widgets (`editPoint`, `editDistanceToPoint`, `editPointOnLine`) and a graph-paper view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

- Intent: [PLAN.md](./PLAN.md)
- Prototype 1 charter: [PROTOTYPE_1.md](./PROTOTYPE_1.md)
- What P1 proved: [PROTOTYPE_1_CONCLUSIONS.md](./PROTOTYPE_1_CONCLUSIONS.md)
- Repo layout: [LAYOUT.md](./LAYOUT.md)

## Run

```sh
pnpm install
pnpm dev
```

Opens [http://127.0.0.1:43117](http://127.0.0.1:43117).

- [?scene=beam](http://127.0.0.1:43117/?scene=beam) — one truss; `group()` namespaces **paths** (`group[0] › line[2]`). The roof uses the middle ring’s `r1`.
- [?scene=flat](http://127.0.0.1:43117/?scene=flat) — two trusses, no group. Pick identity is still unique (`id` is a UUID). Paths are global counters; provenance may share a library line.
- [?scene=shared](http://127.0.0.1:43117/?scene=shared) — **one** `editDistanceToPoint` feeds all three rings and `hubRadius`. Drag the dashed circle: everything follows in real time; one literal is written on release.
- [?scene=plate](http://127.0.0.1:43117/?scene=plate) — milled plate: stock, four corner bolts (shared drill Ø), **polar array** (center, PCD, tap Ø), titled **Hole count** slider (screen-space; N holes from a library loop), pocket + fillet, slot. Mill follows in split view.
- [?scene=nest](http://127.0.0.1:43117/?scene=nest) — **print grid.** `withoutWidgets(plateLayout)` instanced in a nest; columns / rows / gap are titled sliders. Polar-array **count steps by column** (programmatic, not a widget per cell).
- [?scene=relative](http://127.0.0.1:43117/?scene=relative) — **write-back stress.** Left `editPoint` is literals (writes). Right is `a.x + …, a.y + …` (preview only; pointer-up cannot patch expressions).
- [?scene=gear](http://127.0.0.1:43117/?scene=gear) — **involute spur pair.** Drag the pinion centre, pitch radius, and **mesh angle** (coral arm on the pitch circle). Tooth counts, pressure, and helix are titled sliders. The wheel is derived. Helix ° is for the 3D extrude.
- [?scene=ring](http://127.0.0.1:43117/?scene=ring) — **signet band, unrolled.** Plan-view bore + developed strip (`2πR`). Shank and signet heights are distances on the paper; Gauge is wall thickness.
- [?scene=ringsplit](http://127.0.0.1:43117/?scene=ringsplit) — same library wrapped with `wrapBand` around a cylinder. The 3D scene has **no widgets** — it is a second view of `ring.ts`.
- [?scene=rose](http://127.0.0.1:43117/?scene=rose) — **cylinder CSG, plan + SDF.** Seven cylinders hex-packed (fixed 6 around 1). Drag the centre cell’s dimple ring, centre Ø, and outer ball Ø; height is the 3D glider.
- [?scene=helix](http://127.0.0.1:43117/?scene=helix) — **helical gears (3D).** Closed tooth loops run through `extrude(..., { twist })`. Face width is the 3D glider; helix and the section come from `gear.ts`.
- [?scene=gearsplit](http://127.0.0.1:43117/?scene=gearsplit) — 2D gear and 3D helix side by side. 2D drags update the helix live.
- [?scene=mill](http://127.0.0.1:43117/?scene=mill) — **3D** extrusion of the plate scene. XY (stock, holes, pocket, slot) is read from `plate.ts` with gizmos off. The only 3D widget is thickness (vertical glider); write-back patches `mill.ts`.
- [?scene=split](http://127.0.0.1:43117/?scene=split) — plate 2D and mill 3D side by side. Drag 2D handles and the mill follows **while you drag**; thickness stays a 3D-only widget.

## Try

- Drag coral **points**, the **glider** on the span, or a **dashed radius**.
- Click a tick: inspector shows **path**, **id**, and the **creation site**.
- Wheel zooms; drag empty paper (or Alt-drag) to pan.

Each handle needs its own unrolled `edit*` in the scene file. Writes use evaluation-order index (must match AST order).
