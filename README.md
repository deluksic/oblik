# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach widgets (`editPoint`, `editDistanceToPoint`, `editPointOnSegment`, `editPointOnLine`) and a view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

Docs: [docs/README.md](./docs/README.md).

## Run

```sh
pnpm install
pnpm dev
```

Opens [http://127.0.0.1:43117](http://127.0.0.1:43117). **New scene** writes `apps/paper/src/scenes/<id>.scene.ts`. Nav is generated from catalog files in that folder. Layout files are CSS `grid-template-areas` whose cell names are scene ids.

Scene catalog and controls: [docs/scenes.md](./docs/scenes.md).

## Try

- **Space** — command palette. **Point** places `editPoint`. **Distance** places `editDistanceToPoint`.
- Drag **points**, the **glider** on the span, or a **dashed radius**.
- Click a tick: inspector shows **path**, **id**, and the **creation site**.
- Wheel zooms; drag empty paper (or Alt-drag) to pan.

Each `edit*` CallExpression is one write target. A loop of five `editDistanceToPoint` is five gizmos and one literal.
