# oblik

A code-first design tool, written in TypeScript. You write a program; the program _is_ the design. Editing happens in both directions: you type in the editor, you drag on the canvas, and both write to the same source file. Git is the history.

This is an experiment, not a product. It exists because existing design tools are silos — CAD, jewelry, and slicer apps each do one job well and talk to each other poorly — and because we wanted a tool where the design is ordinary code: functions, loops, imports, tests, reviewed in diffs.

## What it's for

One program, many views. A design program is pure TypeScript — geometry in, geometry out, no UI. **Scenes** attach a view and interactive inputs to that program:

- **2D sketch** (`kind: "construction"`) — parametric construction with draggable points, sliders, and geometric solvers. For designing parts.
- **Figure** (`kind: "figure"`) — the same helpers, painted with ink and styled for publication. For blog-post diagrams and illustrations.
- Future scene types (3D, SDF, slicing, maps) would be more views of the same programs, not new tools.

The point of the experiment: if a scene is just a lens over a program, adding a new way to _look_ at designs should not mean forking the design.

## How it works

A library stays pure. A scene file declares the interactive bits — points, sliders, offsets — and everything else is computed:

```ts
// scene — interactive inputs
const A = point(3, 4); // draggable
const r = circle(A, 2).radius; // slider
const t = pointOnSegment(seg, 0.3); // glider

// library — plain math, importable, testable
export const shape = ringProfile({ inner: r, seam: t, origin: A });
```

Drag a handle and the preview updates every frame; when you release, the literal in the scene file is rewritten. Undo is the editor. The canvas knows what you're pointing at (down to the source line that created it) so scenes can bind widgets to real geometry instead of guessing.

Editing on the canvas is **declared, not inferred**: only constructors like `point`, `circle`, `parallelLine`, `slider` expose handles. A stray `3` in a library file is never magically draggable — degrees of freedom live where you put them.

## Status

Prototype-driven: each prototype gets a short charter, a build, and a postmortem that shapes the next one ([docs](./docs/README.md)).

- **P6** — the current runtime: one `oblik` package, Solid + SVG, tape-based evaluation, draft-mode editing. Shipped.
- **P7** — regions, fillets, planar CSG (`diff` / `union` / `intersect` / `pick` / `roundOffset`). Shipped.
- **P8** — name scoping: insert/snap know which identifiers are legal where you're focused. Shipped.
- **P9** — figure scenes: paint ink, Brush/Eraser, construction onion. In progress. Export is later.

Still missing from the old P5 feature set: vectors, polylines/arcs as stroke nodes, mirrored offsets, slider labels, sdf2, 3D. The [horizon](./docs/intent.md#horizon) is two unrelated scene types consuming one library through a shared artifact/pick protocol — if that loop works, domain tools (supports, layout, slicing) become extensions instead of products.

## Run

```sh
pnpm install
pnpm demo
```

Opens [http://127.0.0.1:43127](http://127.0.0.1:43127) with a scene picker. Drag a handle; release writes the scene file. In figure scenes, click ink to inspect, hold Shift for construction, Space toggles Brush/Eraser.

## Try it in a new project

Scaffold a standalone project without cloning this repo:

```sh
pnpm dlx github:deluksic/oblik#path:packages/create-oblik my-figures
cd my-figures
pnpm install
pnpm dev
```

(`create-oblik` isn't on npm, so `pnpm create` can't resolve it — the `dlx` form runs it straight from github.) The scaffold is a vite config, a three-line `main.tsx` that calls `bootstrap()` from `oblik/host`, and an empty `src/scenes/` — add a scene by dropping a `.ts` file there exporting `defineScene({ kind, title, build })`.

## Repo layout

```
packages/oblik    the library: constructors, tape, views, shell
apps/demo         scene programs — the actual usage ground
docs/             intent, prototypes, postmortems
```
