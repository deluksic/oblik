# Layout

pnpm workspace. Libraries are packages. The paper preview is an app. Domain demos live in `apps/paper/src/demo/`.

```
packages/
  geom      @design-scenes/geom      vec, vec3, geom values (line, circle, arc, polyline, mesh3, extrude, wrapBand), sticky id, provenance
  euclid2   @design-scenes/euclid2   2D scene type: widgets, camera, pick, draw, run
  sdf       @design-scenes/sdf       field CSG (no identity), 2D profile + 3D compile, raymarch view
  euclid3   @design-scenes/euclid3   3D scene type: Three.js view, point3 / distance3 / pointOnSegment3
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

- `id` — sticky pick key. Annotated constructors: `file:line:column#bind` when the call is `const bind = …`, otherwise `file:line:column#k`. Unannotated: `kind#bind` or `kind#k`. A second construction with the same bind at the same origin is `…#bind#1` so instanced outlines and gapped walls are not de-duplicated away. Survives re-evaluate if the program shape is unchanged. Renaming the const changes the id.
- `site` — write target (`file` / `line` / `column`) from `__annotations__`. Shared on purpose: one literal, many instances. Hover may light every handle with that site; selection uses `id`.
- `bind` — const name that owned the construction, when known.
- `provenance` — user call stack (innermost helper first), captured from `Error.stack`. Infra frames (geom, euclid, shell, hosts) are skipped so nested demo helpers remain.

Inspect title is `bind ?? kind`. The stack is the identity display. There is no `path` / breadcrumb. There is no `group()` folder API. A loop that calls the same helper from one source line still shares a stack — iterations are not extra frames. Unlabeled loop bodies share `site#k`.

## Catalogs

Three lists, three layers. Shell must not import geom / euclid2 / hosts, so this cannot be one module.

| What | Where | Hook |
| --- | --- | --- |
| Scene callees (annotator, write-back, binding names) | `packages/shell/src/editor/call-sites.ts` | `dof` / `patch` on a row |
| Space tools (palette, number bar) | `packages/hosts/src/tools/catalog.ts` | `palettes` / `draft` on a row |
| Handle ink | `packages/euclid2/src/ink.ts` + `gizmoForEditableGeom` in `widgets.ts` | skip cream; spawn gizmos |

Click / compile / preview stay in `packages/hosts/src/tools/session.ts` because they share Point / Length / LineLike resolvers. Ghost drawing consumes `sessionGhostView` (`packages/hosts/src/tools/ghost.ts`).

New writable constructor: one `CALL_SITES` row. New Space verb: one `TOOLS` row plus a `ToolSession` variant and compile in session.ts. Do not add a fourth name list in paper2, the annotator, or the patcher.

## Widget writes

Each editable CallExpression is one write target. The **call-site annotator** (`injectSceneSites`, Vite pre-transform) walks the AST and splices `__annotations__: { file, at, editable }` onto the module that runs; disk unchanged. If `__annotations__` is already on the call, overwrite and warn. A loop that calls `circle(p, 0.4)` five times is five gizmos and one `0.4` — drag any, commit once, all five follow (`?scene=shared-loop`). Hover may light every handle that shares that site; click-selection is per instance so inspect keeps that call’s stack. Gizmo count need not equal constructor count.

Shared parameters can live in a helper next to catalog scenes (e.g. `plate-layout.ts`). Dragging a plate handle writes that helper; mill’s thickness glider writes `mill.scene.ts`.

Written-back arguments must be **numeric literals**. `point(a.x + 2.4, a.y + 1.05)` cannot be patched (no numeric tokens). Declare the offset with `vector(origin, dx, dy)` instead (`?scene=relative`).

`slider(n, { label, min, max, step })` is a screen-space titled slider for counts and other non-spatial parameters. `angle(origin, degrees)` is a world-space polar handle (literal is degrees, return value is radians). World gizmos stay for points, radii, angles, offsets, and extrusion thickness. The patcher writes the first numeric argument of `slider` and the degree argument of `angle`.

A 3D scene can reuse a 2D scene’s values with `withoutWidgets(() => …, source)` from euclid2: constructors do not enqueue gizmos (draw is also silenced). Silent reads use a **published snapshot** of the source’s overrides (`publishWidgetOverrides(source)` after the 2D frame), keyed by file:line:column. **`source` is the catalog id** (filename stem, or `export const id`). Two 2D editors must not share a channel. `getGizmos()` returns a **copy**. Split mill follows a plate drag because the euclid2 host publishes `"plate"` after each plate evaluate. `?scene=nest` is the same silent read, then a library nest that **steps a parameter by cell**. `?scene=rose` silent-reads `"cylinder"` and `"profile"` side by side.

## HMR

Widget pointer-up patches numeric literals. The Vite plugin swallows HMR when the file still matches the last widget write, so cameras stay put.

A real save (or Space insert) hot-swaps the scene module. The Vite plugin appends a `hot.accept` onto `scene-loaders.ts` for every `./scenes/*.scene.ts` path and side-effect-imports every `scenes/*.ts` helper (not `*.scene.ts`). Helper saves also HMR the importing `*.scene.ts` files (so panes get a fresh `scene()`), then `notifyHelperHot()` re-runs open frames. **Authors never write `import.meta.hot` for layout helpers** — only `import { plateLayout } from "./plate-layout.ts"`.
