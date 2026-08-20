# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach 2D widgets (`editPoint`, `editDistanceToPoint`, `editPointOnLine`) and a graph-paper view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

- Intent: [PLAN.md](./PLAN.md)
- This experiment: [PROTOTYPE_1.md](./PROTOTYPE_1.md)

## Run

```sh
npm install
npm run dev
```

Opens on [http://127.0.0.1:43117](http://127.0.0.1:43117). Use the header links or query params:

- [?scene=beam](http://127.0.0.1:43117/?scene=beam) — one truss; library geometry is wrapped in `group()` so paths are namespaced (`group[0] › line[2]`).
- [?scene=flat](http://127.0.0.1:43117/?scene=flat) — two trusses with **no** `group()`; paths are global counters (`line[4]` vs `line[12]`) but every geom still has a unique uuid `id` for picking.

Edit `src/scenes/beam.ts`, `src/scenes/beam-flat.ts`, or `src/lib/mark.ts` and save — Vite HMR reloads the scene.

**Widget write-back:** each handle must be a separate `edit*` call in the scene file (not inside a shared helper). Writes patch by source line/column, not evaluation order.

## Try

- Drag the coral **points**, the **glider** on the span, or the **dashed radius**.
- Click a tick mark or the roof: the inspector shows a **path** breadcrumb, a uuid **id**, and the **creation site** in the library.
- Switch to **Flat** and click ticks on each truss — paths differ; uuid ids always differ; provenance may still point at the same library line.
- Wheel zooms; drag empty paper (or Alt-drag) to pan.

Handles are not inside `src/lib`. They only exist in the scene file, which is the source of truth after pointer-up.
