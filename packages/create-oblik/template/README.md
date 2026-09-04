# oblik figures

A code-first design project: scenes are TypeScript programs viewed in an interactive canvas. Dragging a handle updates the preview every frame and rewrites the scene file when you release.

## Run

```sh
pnpm install
pnpm dev
```

Opens http://localhost:43127 with a scene picker. Add a scene by dropping a `.ts` file into `src/scenes/` exporting `defineScene({ kind, title, build })`.

Scene files are the source of truth — commit them like any other code.
