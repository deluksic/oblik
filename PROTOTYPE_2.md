# Prototype 2 — scene catalog and shell layouts

Charter for the next experiment. Build this, then write conclusions before planning prototype 3.

P1 proved: pure libraries, scene-only `edit*`, drag writes literals, 2D pick identity. Since then we added 3D, SDF, and multi-pane workspaces (plate+mill, gears+helix, ring wrap, cylinder plan+profile+field). Those work, but **adding a scene is not adding a TypeScript file**. It is also a URL branch, a runner map, an HTML pane, CSS, an HMR `accept` list, and a widget-channel string. This prototype removes that glue.

## Goal

A scene is a file in `apps/paper/src/scenes/`. Creating that file is enough for it to appear in the nav and run at `?scene=<id>`. **Window layout is a shell concern**: a file may declare which other scene files share the viewport; the shell creates panes and mounts the right view in each. No new `main.ts` branch, no new `#pane-*` in `index.html`.

The interactions that must work:

1. Add `scenes/hello.ts` with `scene()` and a `view`. Restart or HMR. Nav shows it. `?scene=hello` opens one pane. No other file is edited.
2. Add `scenes/plate-mill.ts` that only exports a `layout` of existing ids. Two panes, live drag from 2D still updates 3D.
3. Open today’s rose workspace the same way: three panes from a layout export, not a special case in `main.ts`.
4. Delete a scene file: it leaves the nav. Layouts that named it fail visibly (error pane), not with a missing canvas.

If (1) still requires touching `paper2d.ts` / `index.html` / `main.ts`, that is a failure — record it and stop.

## Non-goals

- Named widgets, patch-by-source-location, click-to-insert `edit*`
- Nested / docking / floating windows (no drag-to-split, no saved window chrome)
- SDF pick identity
- Moving `demo/` into published packages
- Inferring handles from unmarked literals
- A visual node editor

Widget *channels* stay file-stem strings for this prototype (`withoutWidgets(fn, "plate")` matches `plate.ts`). The shell always publishes under the pane’s id. Do not invent a second registry for that.

## Pass

- `apps/paper/src/main.ts` has no per-scene `if (sceneKey === …)`.
- `index.html` has an empty nav and an empty viewport; the shell fills both.
- No hardcoded `#paper` / `#profile` / `#space` ids required by view hosts. Each pane gets a canvas the shell created.
- `paper2d.ts` / `paper3d.ts` / `papersdf.ts` / `papersdf2.ts` do not own a `SCENES` map or a per-file `hot.accept` list.
- Layout-only files have no `scene()` and do not import pane modules (string ids only).
- Existing URLs either keep working (`export const id`) or have a one-line redirect note in README after rename.

## Fail (stop and write conclusions)

- Discovery only works if you also register the module in a hand-written map.
- Layout means “show these two hardcoded canvases” rather than N generic panes.
- The shell imports euclid2 / euclid3 / sdf (views must plug in; window management must not know CSG).
- A layout file that `import`s `./mill.ts` so mill’s widgets enqueue while the layout module evaluates.

---

## What is wrong today

| To add a scene you also edit | Why |
| --- | --- |
| `paper2d.ts` `SCENES` + cameras + status + `hot.accept` | 2D runner is a closed catalog |
| `paper3d.ts` `SCENES3` + cameras + `hot.accept` | same for 3D |
| `papersdf.ts` / `papersdf2.ts` | SDF hosts hardcode `rose` / `profile` |
| `index.html` nav | labels and `data-scene` are copy |
| `index.html` extra `<section>` + `style.css` | rose’s third pane is a unique DOM node |
| `main.ts` | every multi-view is a new branch that knows canvas ids and `onLiveChange` wiring |

`?scene=split` is not a file. It is a router alias. That is the opposite of “another TypeScript file.”

---

## Shape

```
packages/shell
  vite-plugin.ts     peek, patch, **scene catalog virtual module**
  catalog.ts         types for the emitted catalog
  workspace.ts       nav, inspect chrome, pane grid, mount/dispose
  types.ts           ViewHost, PaneHandle, Layout

apps/paper
  src/main.ts        register four view hosts, startWorkspace()
  src/hosts/         euclid2, euclid3, sdf, sdf2 — one module each
  src/scenes/        the only registry
  src/demo/          unchanged (pure)
```

`packages/shell` already must not import geom or scene types (`LAYOUT.md`). Keep that. **Workspace code uses the DOM and a `ViewHost` interface.** Paper registers hosts:

```ts
registerView("euclid2", euclid2Host);
registerView("euclid3", euclid3Host);
registerView("sdf", sdfHost);
registerView("sdf2", sdf2Host);
startWorkspace({ inspectRoot, viewportRoot, navRoot });
```

A host is:

```ts
type ViewHost = {
  mount(
    canvas: HTMLCanvasElement,
    mod: LoadedScene,
    ctx: {
      sceneId: string;
      inspect: InspectEls;
      onLiveChange: () => void;
    },
  ): PaneHandle;
};

type PaneHandle = {
  refresh: (opts?: { quiet?: boolean }) => void;
  dispose: () => void;
};
```

`onLiveChange`: the workspace refreshes **every other pane** (quiet). That is what split mill and rose do today. No dependency graph in P2.

---

## Scene file contract

Every `apps/paper/src/scenes/*.ts` is a catalog entry. **Id defaults to the filename stem** (`beam.ts` → `beam`).

```ts
export const title = "Beam truss";          // nav + pane label; default = id
export const view = "euclid2";              // default "euclid2" if omitted
export const id = "flat";                   // optional; overrides stem
export const hint = "Drag the posts…";      // optional status line
export const camera = { x: 0, y: 0, scale: 16 };       // euclid2
export const camera3 = { position: [18, -24, 13], target: [0.3, 0, 1.15] };

export const sceneFile = "beam.ts";         // keep: write-back + peek path
export function scene() { /* … */ }
```

`view` is `"euclid2" | "euclid3" | "sdf" | "sdf2"`. Unknown view → error pane, not a fallback to beam.

### Layout-only file (workspace)

A file with `layout` and **no** `scene()` is a workspace. It must not import other scenes. Layout is CSS Grid: `areas` is `grid-template-areas`, and each pane is `grid-area: <scene-id>`.

```ts
export const title = "Cylinder";
export const layout = {
  areas: `"cylinder profile rose-sdf"`,
  columns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.15fr)",
};
```

A string or string[] is accepted and turned into a single quoted row of equal columns.

`rose-sdf.ts` stays the SDF program (`view: "sdf"`, has `scene()`). Opening `?scene=rose-sdf` is one field pane. Opening `?scene=rose` is three named grid cells.

The welcome screen (no `?scene=`) has **New scene**, which POSTs `/__create-scene` and writes a starter `scenes/<id>.ts`.

Optional flex (still a flat row):

```ts
export const layout = [
  { id: "cylinder", flex: 1 },
  { id: "profile", flex: 1 },
  { id: "rose-sdf", flex: 1.15 },
];
```

P2 implements **one row of panes**, equal flex if omitted. Below ~1100px the shell stacks them. No binary split tree yet.

A file may not export both `scene()` and `layout` in P2 (avoids “am I a pane or a workspace?”). If we need “open me plus friends,” that is a later `with: string[]` on a scene file — not this charter.

### What the author does not export

- Canvas ids
- `split: true`
- CSS class names (`view-triple`)
- `onLiveChange` wiring
- Nav order hacks (nav is catalog order: filename sort, or `export const nav = 10` later if needed — skip for P2, sort by `title`)

---

## Catalog (Vite plugin)

Extend `sceneDevPlugin` (it already knows `sceneDir`).

On start and when `scenes/*.ts` change:

1. List `*.ts` (not `*.d.ts`).
2. Parse exports with the TypeScript scanner/AST (same stack as the widget patcher). Read string/array literals only: `id`, `title`, `view`, `layout`, presence of `scene`. Do not execute scene modules at catalog time.
3. Emit a virtual module `@design-scenes/shell/catalog`:

```ts
export type LayoutPane = string | { id: string; flex?: number };

export type SceneEntry = {
  id: string;
  file: string;          // "mill.ts"
  title: string;
  view: "euclid2" | "euclid3" | "sdf" | "sdf2";
  layout?: LayoutPane[];
  hasScene: boolean;
};

export const scenes: SceneEntry[];
export function loadScene(id: string): Promise<unknown>;
```

`loadScene` uses Vite-friendly glob:

```ts
const loaders = import.meta.glob("../../apps/paper/src/scenes/*.ts");
```

The plugin can generate that glob relative to the app, or paper can pass `import.meta.glob("./scenes/*.ts")` into `startWorkspace`. Prefer **paper passes the glob**; the plugin only emits metadata JSON so the plugin does not hardcode app paths beyond `sceneDir`.

Duplicate `id` → plugin error overlay.

`layout` references a missing id → workspace shows an error pane for that slot, other panes still mount.

### Nav

Shell renders `#scene-nav` from `scenes` (every file). Layout-only entries appear next to programs. No `index.html` copy.

Optional later: `export const nav = false` to hide `rose-sdf` when `rose` is the named workspace. Not required to pass.

---

## Window management (shell)

`index.html` workspace skeleton:

```html
<nav id="scene-nav" aria-label="Scene"></nav>
<div id="viewport"></div>
<aside id="inspect">…</aside>
```

Zero view panes in the document.

`startWorkspace`:

1. Read `?scene=` (default: first catalog id, or `"beam"` if present).
2. Resolve the entry. If it has `layout`, pane list = that layout. Else pane list = `[this id]`.
3. Set `#viewport` to `display: grid; grid-template-columns: repeat(n, minmax(0, 1fr))` with optional `flex` as `fr` units.
4. For each pane, create:

```html
<section class="view-pane" data-scene="plate">
  <p class="view-label">euclid2 · plate.ts</p>
  <canvas tabindex="0"></canvas>
</section>
```

5. `loadScene(id)` → `hosts.get(entry.view).mount(canvas, mod, ctx)`.
6. Focus: pointerdown on a pane makes it the inspect owner (status, crumb, source). First pane owns inspect until then.
7. ResizeObserver on each pane calls that handle’s `refresh({ quiet: true })`.

Dispose all handles on scene change (client nav). P2 may keep full page loads via `?scene=` links (current behavior). In-app nav without reload is nice-to-have, not pass/fail.

### CSS the shell owns

Move pane grid, pane labels, stacked-breakpoint rules into shell-owned CSS (imported by paper). Delete `body.view-split` / `view-triple` / `view-2d` / `view-3d` as the layout mechanism. Inspect column stays in the paper app chrome (or shell, if it is already drawing `#workspace`).

---

## Hosts (paper)

Each current runner becomes a host that **receives a module**, not a key into a table.

- **euclid2** — today’s `startPaper2d` minus `SCENES`, URL parsing, and nav. `runScene(mod, sceneId)`, `publishWidgetOverrides(sceneId)`, `setWidgetOverride(..., sceneId)`. Camera from `mod.camera` or `defaultCamera()`. HMR: workspace reloads the module and calls `mount` again; host should `import.meta.hot` only if needed for its own code, not for scene files.
- **euclid3** — `runScene3(mod)`, camera from `mod.camera3`.
- **sdf / sdf2** — same, but `scene()` returns `Sdf` / `Sdf2`. No hardcoded `import * as rose`.

Per-scene status strings in the runners go away. Use `mod.hint` or a generic line (“Drag coral handles · wheel zooms”).

Widget write-back still uses `mod.sceneFile` (must remain a filename under `sceneDir`). Default `sceneFile` to the catalog `file` if omitted so authors can skip the duplicate export.

---

## Widget channels (do not regress)

Pane `sceneId` **is** the publish channel. euclid2 `beginWidgetFrame(sceneId)` on every evaluate.

Silent readers keep:

```ts
const plate = withoutWidgets(() => readPlate(), "plate");
```

`"plate"` is `plate.ts`’s id. Document in LAYOUT.md: **channel = catalog id**. Layout rewrite must not reintroduce a global override map. `getGizmos()` stays a copy.

Do not make mill import plate as a namespace to infer the channel in P2.

---

## Migration

Rename stems to match URLs where it is cheap; otherwise `export const id`.

| Today | After |
| --- | --- |
| `beam.ts` | `title`, `view` default |
| `beam-flat.ts` | `export const id = "flat"` **or** rename to `flat.ts` |
| `beam-shared.ts` | `id = "shared"` or rename |
| `plate.ts` `nest.ts` `relative.ts` `gear.ts` `ring.ts` `cylinder.ts` | `title` + `camera` where hardcoded today |
| `mill.ts` `helix.ts` `ring3.ts` | already `view = "euclid3"` |
| `profile.ts` | already `view = "sdf2"` |
| `rose-sdf.ts` | stays a one-pane SDF scene |
| **new** `rose.ts` | `layout = ["cylinder", "profile", "rose-sdf"]` |
| **new** `split.ts` | `layout = ["plate", "mill"]` |
| **new** `gearsplit.ts` | `layout = ["gear", "helix"]` |
| **new** `ringsplit.ts` | `layout = ["ring", "ring3"]` |
| `main.ts` branches | delete |
| `index.html` nav + extra panes | empty nav, empty viewport |

`sceneFile` on each program stays until hosts default it from the catalog.

---

## Implementation order

Do not skip ahead to nested layouts or in-app routing.

1. **Catalog plugin** — emit `SceneEntry[]` from `sceneDir`. Paper nav rendered from catalog; clicking still uses today’s runners. Proves discovery without mixing layout yet.
2. **ViewHost + one-pane workspace** — `?scene=beam` mounts a shell-created canvas. Delete `SCENES` / `SCENES3`. SDF hosts take a loaded module. Hardcoded HTML canvases unused.
3. **`layout` arrays** — generic N-pane grid, refresh-all on live change. Add `split.ts`, `gearsplit.ts`, `ringsplit.ts`, `rose.ts`. Delete `main.ts` scene switch. Delete `#pane-profile`.
4. **Cameras and titles** move onto scene modules. Delete per-id switches in hosts. Generic status / `hint`.
5. **HMR** — glob accept / remount pane on scene file change; delete per-file `hot.accept` lists in hosts.
6. **Docs** — LAYOUT.md (shell workspace, catalog, channel = id), README (nav is generated; how to add a scene), PLAN.md already points here.

After (1) the repo is already better. (3) is the pass/fail for this charter.

---

## Acceptance (manual)

- **Add-only:** `scenes/hello.ts` draws `circle(editPoint(0,0), editDistanceToPoint(…, 1))`, `export const title = "Hello"`. No other edits. Nav lists Hello. `?scene=hello` is one 2D pane; drag writes `hello.ts`.
- **Layout-only:** `scenes/plate-mill.ts` with `layout = ["plate", "mill"]`. Two panes; plate drag updates mill while dragging.
- **Rose:** `?scene=rose` is three panes; profile drag does not steal cylinder handles; quatrefoil still cuts after join.
- **Missing id:** `layout = ["plate", "nope"]` shows an error in the second pane, plate still runs.
- **Delete hello.ts:** nav drops it after HMR or reload.

---

## Risks

- **Executing scenes for catalog** would enqueue widgets and publish the wrong channel. Parse text only.
- **Layout files importing panes** would evaluate `edit*` at import. Lint/docs: layout modules export literals only. A cheap plugin check: `layout` present + any `import` from `./` → warning.
- **Vite glob and new files** — adding `hello.ts` must invalidate the catalog. Plugin watches `sceneDir`.
- **Inspect contention** — three panes share one aside. Focus-on-pointerdown is enough; do not duplicate inspectors.
- **Default scene** — if `beam` is renamed, `?scene=` empty must not crash. Prefer catalog find `beam` else `scenes[0]`.

---

## Later (not P2)

- Nested split trees (`{ direction: "row", children: [...] }`)
- `export const with = ["cylinder"]` on a program file
- `nav: false` / explicit nav order
- `withoutWidgets(fn, plateModule)` typed to catalog id
- In-app layout without full navigation reload
- Click-to-insert `edit*` (P3 candidate, from P1 conclusions)
