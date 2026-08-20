# Layout

pnpm workspace. Libraries are packages; the paper preview is an app. Domain tools later become more apps or more scene-type packages — not new folders inside `apps/paper`.

```
packages/
  geom      @design-scenes/geom      vec, geom values, UUID id, path, provenance
  mark      @design-scenes/mark      example domain lib (beam assembly)
  euclid2   @design-scenes/euclid2   2D scene type: widgets, camera, pick, draw, run
  shell     @design-scenes/shell     Vite plugin: peek source, patch edit* literals
apps/
  paper     @design-scenes/paper     graph-paper demo (scenes + inspector)
```

## Rules

| Layer | May import | Must not |
| --- | --- | --- |
| `geom` | nothing in this repo | widgets, canvas, Vite |
| `mark` | `geom` | `euclid2`, `shell`, apps |
| `euclid2` | `geom` | `mark`, apps, filesystem writes |
| `shell` | Node, TypeScript, Vite | geom/scene types (it only patches text) |
| `paper` | all of the above | putting domain math in `main.ts` |

## Identity

- `id` — UUID, pick/hover/highlight only. Regenerated every frame.
- `path` — `group[0]/line[2]`. Optional. `group()` namespaces this for humans.
- `provenance` — first stack frame outside geom/euclid2/shell.

`group()` is a folder in the breadcrumb, not a requirement for correct picking.

## Widget writes

Runtime widget index `0..n-1` must match AST visit order of `edit*` in that scene file. Shared helpers that call `edit*` more than once need unrolled call sites (one literal per handle).

`apps/paper` loads the shell Vite plugin via a **relative `.ts` import**. Vite’s config loader cannot `import` a workspace package whose `exports` point at TypeScript.
