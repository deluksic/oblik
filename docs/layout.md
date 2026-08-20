# Layout

pnpm workspace. Libraries are packages. The paper preview is an app. Domain demos live in `apps/paper/src/demo/`.

```
packages/
  geom      @design-scenes/geom      vec, vec3, geom values (line, circle, arc, polyline, mesh3, extrude, wrapBand), UUID id, path, provenance
  euclid2   @design-scenes/euclid2   2D scene type: widgets, camera, pick, draw, run
  sdf       @design-scenes/sdf       field CSG (no identity), 2D profile + 3D compile, raymarch view
  euclid3   @design-scenes/euclid3   3D scene type: Three.js view, editPoint3 / editDistance3 / editPointOnLine3
  shell     @design-scenes/shell     Vite plugin (peek, patch, insert-editor, catalog, create-scene) + pane workspace
apps/
  paper     @design-scenes/paper     hosts + scenes + demos
    src/scenes/   the only scene registry (programs and layout files)
    src/hosts/    euclid2 / euclid3 / sdf / sdf2 view hosts
    src/demo/     demo-only geometry — not a published lib
```

`apps/paper` loads the shell Vite plugin via a relative `.ts` import. Workspace packages are aliased in `vite.config.ts` to their `src/index.ts`.

## Rules

| Layer | May import | Must not |
| --- | --- | --- |
| `geom` | nothing else in the workspace | widgets, canvas, Vite |
| `euclid2` | `geom` | apps, filesystem writes |
| `sdf` | `geom`, Three.js | widgets, provenance, apps |
| `euclid3` | `geom`, Three.js | apps, filesystem writes |
| `shell` | Node, TypeScript, Vite, DOM | geom, euclid2/3, sdf |
| `paper` scenes | `geom`, `euclid2` / `euclid3` / `sdf`, `../demo/*` | putting reusable domain in `packages/` until it is real |
| layout files in `scenes/` | string ids / CSS areas only | other scene modules |
| `paper` demo | `geom` or `sdf` | `euclid2`, `shell` |

## Identity

- `id` — UUID, pick/hover/highlight only. Regenerated every frame.
- `path` — `group[0]/line[2]`. Optional. `group()` namespaces the path for humans.
- `provenance` — first stack frame outside geom/euclid2/shell.

`group()` is a folder in the breadcrumb. Picking works without it.

## Widget writes

Runtime widget index `0..n-1` must match AST visit order of `edit*` in the scene file. Shared helpers that call `edit*` more than once need unrolled call sites (one literal per handle). Written-back arguments must be **numeric literals**. Expressions such as `a.x + 2.4` preview via in-memory overrides and cannot be patched (`?scene=relative`).

`editNumber(n, { label, min, max, step })` is a screen-space titled slider for counts and other non-spatial parameters. `editAngle(origin, degrees)` is a world-space polar handle (literal is degrees, return value is radians). World gizmos stay for points, radii, angles, and extrusion thickness. The patcher writes the first numeric argument of `editNumber` and the degree argument of `editAngle`.

A 3D scene can reuse a 2D scene’s values with `withoutWidgets(() => …, source)` from euclid2: `edit*` do not enqueue gizmos or consume write-back indices. Silent reads use a **published snapshot** of the source’s overrides (`publishWidgetOverrides(source)` after the 2D frame). **`source` is the catalog id** (filename stem, or `export const id`). Two 2D editors must not share a channel. `getGizmos()` returns a **copy**. Split mill follows a plate drag because the euclid2 host publishes `"plate"` after each plate evaluate. `?scene=nest` is the same silent read, then a library nest that **steps a parameter by cell**. `?scene=rose` silent-reads `"cylinder"` and `"profile"` side by side.

## HMR

Widget pointer-up patches numeric literals. The Vite plugin swallows HMR when the file still matches the last widget write, so cameras stay put.

A real save (or Space insert) hot-swaps the scene module. `scene-loaders` `hot.accept`s every `./scenes/*.ts` path and applies Vite’s fetched module. Re-`import()` of the glob URL without a timestamp returns the previous `scene()`.

Cross-scene `import.meta.hot.accept("./plate.ts")` in mill/helix/rose updates `let readPlate = plateLayout` on a real save of the imported file. Widget write-back does not use the cross-scene accept.
