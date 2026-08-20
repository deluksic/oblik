# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach widgets (`editPoint`, `editDistanceToPoint`, `editPointOnLine`) and a view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

Docs: [docs/README.md](./docs/README.md).

## Run

```sh
pnpm install
pnpm dev
```

Opens [http://127.0.0.1:43117](http://127.0.0.1:43117). **New scene** writes `apps/paper/src/scenes/<id>.ts`. Nav is generated from that folder. Layout files are CSS `grid-template-areas` whose cell names are scene ids.

Scene catalog and controls: [docs/scenes.md](./docs/scenes.md).

## Try

- **Space** — command palette. **Point** places `editPoint`. **Distance** places `editDistanceToPoint`.
- Drag **points**, the **glider** on the span, or a **dashed radius**.
- Click a tick: inspector shows **path**, **id**, and the **creation site**.
- Wheel zooms; drag empty paper (or Alt-drag) to pan.

Each handle needs its own unrolled `edit*` in the scene file. Writes use evaluation-order index (must match AST order).
