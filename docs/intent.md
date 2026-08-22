# Intent

A shell where **TypeScript programs glue representations**, and **domain tools are views** of those programs — closer to VS Code than to Fusion, libfive, or Lychee.

CAD, jewelry, and slicer apps each do one job well and talk to each other poorly. The work here is glue: libraries you `import`, converters you `npm install`, slow kernels in WASM when they already exist, and scene types anyone can add. Start small: a text editor with a preview slot.

## Goals

**Programs define designs.** Functions, modules, loops, data, tests. A design is code. Git is the history. Feature timelines and node graphs are out.

**Libraries are pure.** Geometry in, geometry out. No gizmos, no hover UI, no knowledge of the editor. Reuse is `import { ringProfile } from "./jewelry"`.

**Scenes look at libraries.** A scene chooses a scene type (2D paper, SDF viewport, slicer, map, …) and supplies **inputs** from that type’s **widget library**. Widgets live in the scene:

```ts
// scene — constructors and remaining widgets
const A = point(3, 4);
const t = pointOnSegment(seg, 0.3);
const r = circle(A, 2).radius;

// library — math only
export const shape = ringProfile({ inner: r, seam: t, origin: A });
```

**Identity, hover, and select are core.** The canvas must say what you pointed at (`profile/seg[2]`, created at `lib.ts:40`) so a scene can bind widgets to it. Jump to source. Do not synthesize new math. Do not chase arbitrary expressions to infer handles.

**Declared editors only.** `point`, `circle`, `offsetLine`, `slider`, `pointOnSegment`, `pointOnLine`, and later cousins. Degrees of freedom sit in the combinator. A plain `3` in a library is not a handle.

**Domain tools are views.** Supports, hollowing, layout, maps, resin slicing are optional scene packages if someone implements them. The shell owes them a boring artifact (geometry, image, field, units) and pick IDs.

**Interop is converters with explicit types.** PNG in or PNG out is a valid program. Mesh, curves, occupancy, slices, GeoJSON are later packages. Lossy is allowed if the type is honest. Units still need a house style or glue will silently scale by 1000.

**Source is the truth.** Widget drags rewrite literals in the scene file. Undo is the editor. No sidecar of slider state that can drift from git.

**Mouse is a caret.** Click-to-fill holes, extract-parameter, and “place on surface” can come later. Sketch-n-Sketch-style trace inversion is out of scope.

## Non-goals (product)

- Replacing Fusion, MatrixGold, Blender, or Lychee
- A B-rep kernel, STEP, drawings, or shop-floor CAM
- Built-in auto-supports, vat layout, or printer drivers
- Inferring gizmos from whatever number appears in the AST
- A visual node editor as the main UI
- A hosted multiplayer canvas (the open file runs locally)

## Shape

```
packages/geom, euclid2, euclid3, sdf   libraries and scene types
apps/paper/src/scenes                  programs and layout files
packages/shell                         catalog, panes, peek, patch, insert
```

The long-term analog of LSP is a small **artifact / pick protocol**: what the module exported, which edit sites it declared, what `pick(x,y)` hit. Scene types subscribe. euclid2 and euclid3 are two views of the protocol; a later TypeGPU field view would be a third.

GPU (TypeGPU), WASM kernels, and npm converters attach when a scene type needs them. They are not the identity of the project.

## How we work

Each prototype is an experiment: a short charter, a build, a postmortem. The next charter is written from the postmortem. Intent lives here. Current 2D charter: [prototypes/5.md](./prototypes/5.md).

Packages and rules: [layout.md](./layout.md). Catalog and palette: [scenes.md](./scenes.md).

## Horizon

A domain library with no UI; two scene types looking at it; hover/select identity a scene can bind; a drag that rewrites the scene file; an unrelated package able to consume an exported artifact (even a PNG) without a fork. If the loop works, a support scene is an extension point. If it fails, more scene types will not help.
