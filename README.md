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

- [?scene=beam](http://127.0.0.1:43117/?scene=beam) — one truss; library geometry is wrapped in `group()` so ids are namespaced (`group[0] › line[2]`).
- [?scene=flat](http://127.0.0.1:43117/?scene=flat) — two trusses with **no** `group()`; both emit bare `line[0]`, `circle[0]`, etc., so the inspector cannot tell which truss you picked.

Edit `src/scenes/beam.ts`, `src/scenes/beam-flat.ts`, or `src/lib/mark.ts` and save — Vite HMR reloads the scene.

## Try

- Drag the coral **points**, the **glider** on the span, or the **dashed radius**.
- Click a tick mark or the roof: the inspector shows a stable id (`group[0] › line[2]` in the grouped scene) and the **creation site** in the library.
- Switch to **Flat (duplicate ids)** and click geometry from the upper vs lower truss — the breadcrumb may read the same `line[0]` even though they are different objects.
- Wheel zooms; drag empty paper (or Alt-drag) to pan.

Handles are not inside `src/lib`. They only exist in the scene file, which is the source of truth after pointer-up.
