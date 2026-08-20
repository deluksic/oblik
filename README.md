# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach 2D widgets (`editPoint`, `editDistanceToPoint`, `editPointOnLine`) and a graph-paper view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

- Intent: [PLAN.md](./PLAN.md)
- This experiment: [PROTOTYPE_1.md](./PROTOTYPE_1.md)

## Run

```sh
npm install
npm run dev
```

Opens on [http://127.0.0.1:43117](http://127.0.0.1:43117). Edit `src/scenes/beam.ts` or `src/lib/mark.ts` and save — Vite HMR reloads the scene.

## Try

- Drag the coral **points**, the **glider** on the span, or the **dashed radius**.
- Click a tick mark or the roof: the inspector shows a stable id (`group[0] › line[2]`) and the **creation site** in the library.
- Wheel zooms; drag empty paper (or Alt-drag) to pan.

Handles are not inside `src/lib`. They only exist in the scene file, which is the source of truth after pointer-up.
