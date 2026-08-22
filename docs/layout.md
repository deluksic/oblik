# Layout

pnpm workspace. Libraries are packages. The paper preview is an app. Domain demos live in `apps/paper/src/demo/`.

```
packages/
  geom      @design-scenes/geom      vec, vec3, geom values (line, circle, arc, polyline, mesh3, extrude, wrapBand), UUID id, path, provenance
  euclid2   @design-scenes/euclid2   2D scene type: widgets, camera, pick, draw, run
  sdf       @design-scenes/sdf       field CSG (no identity), 2D profile + 3D compile, raymarch view
  euclid3   @design-scenes/euclid3   3D scene type: Three.js view, editPoint3 / editDistance3 / editPointOnSegment3
  shell     @design-scenes/shell     Vite plugin (peek, patch, insert-editor, catalog, create-scene) + pane workspace
  hosts     @design-scenes/hosts     pane hosts (2D + 3D); may import euclid2, euclid3, sdf, shell
apps/
  paper     @design-scenes/paper     scenes + demos + startWorkspace({ hosts: defaultHosts })
    src/scenes/   catalog `*.scene.ts` plus plain `.ts` helpers (e.g. plate-layout.ts)
    src/demo/     demo-only geometry — not a published lib
```

`apps/paper` loads the shell Vite plugin via a relative `.ts` import. Workspace packages are aliased in `vite.config.ts` to their `src/index.ts`.

## Rules

| Layer                     | May import                                                      | Must not                                                |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| `geom`                    | nothing else in the workspace                                   | widgets, canvas, Vite                                   |
| `euclid2`                 | `geom`                                                          | apps, filesystem writes                                 |
| `sdf`                     | `geom`, Three.js                                                | widgets, provenance, apps                               |
| `euclid3`                 | `geom`, Three.js                                                | apps, filesystem writes                                 |
| `shell`                   | Node, TypeScript, Vite, DOM                                     | geom, euclid2/3, sdf, hosts                             |
| `hosts`                   | `geom`, `euclid2`, `euclid3`, `sdf`, `shell`                    | apps                                                    |
| `paper` scenes            | `geom`, `euclid2` / `euclid3` / `sdf`, `../demo/*`              | putting reusable domain in `packages/` until it is real |
| `paper` app               | `hosts`, `shell`, `geom`, `euclid2` / `euclid3` / `sdf`, `demo` | implementing pane hosts                                 |
| layout files in `scenes/` | string ids / CSS areas only                                     | other scene modules                                     |
| `paper` demo              | `geom` or `sdf`                                                 | `euclid2`, `shell`                                      |

## Identity

- `id` — UUID, pick/hover/highlight only. Regenerated every frame.
- `path` — `group[0]/line[2]`. Optional. `group()` namespaces the path for humans.
- `provenance` — first stack frame outside geom/euclid2/shell.

`group()` is a folder in the breadcrumb. Picking works without it.

## Widget writes

Each editable CallExpression is one write target. The **call-site annotator** (`injectSceneSites`, Vite pre-transform) walks the AST and splices `{ file, at }` — and should splice `{ editable: true }` when DOF args are numeric literals — onto the module that runs; disk unchanged. A loop that calls `editDistanceToPoint(p, 0.4)` five times is five gizmos and one `0.4` — drag any, commit once, all five follow (`?scene=shared-loop`). Gizmo count need not equal `edit*` count.

Shared parameters can live in a helper next to catalog scenes (e.g. `plate-layout.ts`). Dragging a plate handle writes that helper; mill’s thickness glider writes `mill.scene.ts`.

Written-back arguments must be **numeric literals**. `editPoint(a.x + 2.4, a.y + 1.05)` cannot be patched (no numeric tokens). Declare the offset with `editVector(origin, dx, dy)` instead (`?scene=relative`).

`editNumber(n, { label, min, max, step })` is a screen-space titled slider for counts and other non-spatial parameters. `editAngle(origin, degrees)` is a world-space polar handle (literal is degrees, return value is radians). World gizmos stay for points, radii, angles, offsets, and extrusion thickness. The patcher writes the first numeric argument of `editNumber` and the degree argument of `editAngle`.

A 3D scene can reuse a 2D scene’s values with `withoutWidgets(() => …, source)` from euclid2: `edit*` do not enqueue gizmos. Silent reads use a **published snapshot** of the source’s overrides (`publishWidgetOverrides(source)` after the 2D frame), keyed by file:line:column. **`source` is the catalog id** (filename stem, or `export const id`). Two 2D editors must not share a channel. `getGizmos()` returns a **copy**. Split mill follows a plate drag because the euclid2 host publishes `"plate"` after each plate evaluate. `?scene=nest` is the same silent read, then a library nest that **steps a parameter by cell**. `?scene=rose` silent-reads `"cylinder"` and `"profile"` side by side.

## HMR

Widget pointer-up patches numeric literals. The Vite plugin swallows HMR when the file still matches the last widget write, so cameras stay put.

A real save (or Space insert) hot-swaps the scene module. The Vite plugin appends a `hot.accept` onto `scene-loaders.ts` for every `./scenes/*.scene.ts` path and side-effect-imports every `scenes/*.ts` helper (not `*.scene.ts`). Helper saves also HMR the importing `*.scene.ts` files (so panes get a fresh `scene()`), then `notifyHelperHot()` re-runs open frames. **Authors never write `import.meta.hot` for layout helpers** — only `import { plateLayout } from "./plate-layout.ts"`.
