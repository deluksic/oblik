# Design programs, viewed in scenes

TypeScript libraries stay pure. **Scenes** attach constructors (`point`, `circle`, `offsetLine`) and a view. Dragging a handle updates the preview every frame and **writes the scene file only when you release**.

Docs: [docs/README.md](./docs/README.md). Current charter: [Prototype 6](./docs/prototypes/6.md).

## Run

```sh
pnpm install
pnpm demo
```

Opens [http://127.0.0.1:43127](http://127.0.0.1:43127) — **oblik-demo**, the P6 runtime (one `oblik` package, Solid + SVG, `defineScene` / `evaluate` / draft). Drag A, B, or the reach radius; release writes `apps/demo/src/scenes/shelf.ts`.

The P5 paper app is still here:

```sh
pnpm dev
```

Opens [http://127.0.0.1:43117](http://127.0.0.1:43117). **New scene** writes `apps/paper/src/scenes/<id>.scene.ts`.

## P6 slice

- Scene module: `export default defineScene({ kind, title, camera?, build })`.
- Trailing call arg is the uuid: `circle(A, 2.5, "o_ab12")`.
- `draft` is an override until the new module’s `build()` has run.
- Space inserts Point / Circle / Line / Segment (`Expr` on the tape; snap to named points).
- Euclid2 camera is a group transform over aspect-correct NDC `viewBox` (y-up via `scale(1,-1)`). Handles move by relative Δ.

P5 paper notes (catalog, Space, layouts): [docs/scenes.md](./docs/scenes.md).
