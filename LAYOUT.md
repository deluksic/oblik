# Layout

pnpm workspace. Libraries are packages; the paper preview is an app. Domain demos live **inside the app** (`apps/paper/src/demo/`), not in `packages/`.

```
packages/
  geom      @design-scenes/geom      vec, vec3, geom values (line, circle, arc, polyline, mesh3, extrude, wrapBand), UUID id, path, provenance
  euclid2   @design-scenes/euclid2   2D scene type: widgets, camera, pick, draw, run
  sdf       @design-scenes/sdf       field CSG (no identity), 2D profile + 3D compile, raymarch view
  euclid3   @design-scenes/euclid3   3D scene type: Three.js view, editPoint3 / editDistance3 / editPointOnLine3
  shell     @design-scenes/shell     Vite plugin (peek, patch, catalog, create-scene) + pane workspace
apps/
  paper     @design-scenes/paper     hosts + scenes + demos
    src/scenes/   the only scene registry (programs and layout files)
    src/hosts/    euclid2 / euclid3 / sdf / sdf2 view hosts
    src/demo/     demo-only geometry — not a published lib
```

## Rules

| Layer | May import | Must not |
| --- | --- | --- |
| `geom` | nothing in this repo | widgets, canvas, Vite |
| `euclid2` | `geom` | apps, filesystem writes |
| `sdf` | `geom`, Three.js | widgets, provenance, apps |
| `euclid3` | `geom`, Three.js | apps, filesystem writes |
| `shell` | Node, TypeScript, Vite, DOM | geom, euclid2/3, sdf |
| `paper` scenes | `geom`, `euclid2` / `euclid3` / `sdf`, `../demo/*` | putting reusable “domain” in `packages/` until it is real; layout files must not import other scenes |
| `paper` demo | `geom` or `sdf` | `euclid2`, `shell` |

## Identity

- `id` — UUID, pick/hover/highlight only. Regenerated every frame.
- `path` — `group[0]/line[2]`. Optional. `group()` namespaces this for humans.
- `provenance` — first stack frame outside geom/euclid2/shell.

`group()` is a folder in the breadcrumb, not a requirement for correct picking.

## Widget writes

Runtime widget index `0..n-1` must match AST visit order of `edit*` in that scene file. Shared helpers that call `edit*` more than once need unrolled call sites (one literal per handle). Widget arguments that are written back must be **numeric literals** — expressions like `a.x + 2.4` preview via in-memory overrides but cannot be patched (`?scene=relative`).

`editNumber(n, { label, min, max, step })` is a **screen-space** titled slider for counts and other non-spatial parameters. `editAngle(origin, degrees)` is a **world-space** polar handle (literal is degrees, return value is radians). World gizmos stay for things that live in the drawing (points, radii, angles, extrusion thickness). The patcher writes the first numeric argument of `editNumber` and the degree argument of `editAngle`.

A 3D scene can reuse a 2D scene’s values with `withoutWidgets(() => …, source)` from euclid2: `edit*` do not enqueue gizmos or consume write-back indices. Silent reads use a **published snapshot** of that source’s overrides (`publishWidgetOverrides(source)` after the 2D frame), not the live map of the scene that is evaluating. **`source` is the catalog id** (filename stem, or `export const id`). Two 2D editors must not share a channel. `getGizmos()` returns a **copy**. Split mill still follows a plate drag because the euclid2 host publishes `"plate"` after each plate evaluate. `?scene=nest` is the same silent read, then a library nest that **steps a parameter by cell**. `?scene=rose` silent-reads `"cylinder"` and `"profile"` side by side.

## Scenes and layouts

A file in `apps/paper/src/scenes/*.ts` is the registry. The shell Vite plugin parses it (does not execute it) into `virtual:scene-catalog`. Nav and `?scene=` come from that catalog. Adding a program is adding a file with `scene()`; the welcome screen **New scene** button writes a starter file via `/__create-scene`.

A workspace file exports only a CSS grid layout. Cell names are scene ids:

```ts
export const title = "Cylinder";
export const layout = {
  areas: `"cylinder profile rose-sdf"`,
  columns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.15fr)",
};
```

The shell sets `grid-template-areas` / `grid-template-columns` on the viewport and `grid-area: <id>` on each pane. Do not import the pane modules from a layout file.

`apps/paper` loads the shell Vite plugin via a **relative `.ts` import**. Workspace packages are also aliased in `vite.config.ts` to their `src/index.ts`. Charter: [PROTOTYPE_2.md](./PROTOTYPE_2.md).
