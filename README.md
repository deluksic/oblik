# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach constructors (`point`, `circle`, `offsetLine`, `slider`) and remaining widgets (`pointOnSegment`, `pointOnLine`, `vector`, `angle`) plus a view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

Docs: [docs/README.md](./docs/README.md).

## Run

```sh
pnpm install
pnpm dev
```

Opens [http://127.0.0.1:43117](http://127.0.0.1:43117). **New scene** writes `apps/paper/src/scenes/<id>.scene.ts`. Nav is generated from catalog files in that folder. Layout files are CSS `grid-template-areas` whose cell names are scene ids.

Scene catalog and controls: [docs/scenes.md](./docs/scenes.md).

## Try

- **Space** — command palette. On 2D paper: **Point**, **Circle**, **Line**, **Segment**, **Offset**, **Slider**. They write constructors (`point`, `circle`, `line`, `segment`, `offsetLine`, `slider`).
- Open [?scene=shelf](http://127.0.0.1:43117/?scene=shelf) for the construction-graph figure (ground, shelf, reach, lamp).
- Drag **points**, a **radius ring**, or an **offset** parallel. Length-slot clicks reuse `.radius`, `.distance`, or a slider name.
- Click a tick: inspector shows **path**, **id**, and the **user call stack** (nested helpers that built that stroke).
- Wheel zooms; drag empty paper (or Alt-drag) to pan.

Each writable CallExpression is one write target. A loop of five `circle(p, 0.4)` is five gizmos and one literal. Annotated constructors (`point(0, 0)`, `circle(A, 2.5)`) get handles when their DOF args are numeric literals.
