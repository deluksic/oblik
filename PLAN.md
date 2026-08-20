# Design programs, viewed in scenes

A shell where **TypeScript programs glue representations**, and **domain tools are views** of those programs — closer to VS Code than to Fusion, libfive, or Lychee.

Existing tools are each good at one job and bad at talking to each other. This project does not replace them. It is glue: libraries you `import`, converters you `npm install`, slow kernels in WASM if they already exist, and scene types that anyone can add. The beginnings should be humble, like a text editor with a preview slot.

---

## Goals

**Programs define designs.** Real language: functions, modules, loops, data, tests. A design is not a timeline of CAD features and not a node graph. It is code. Git is the history.

**Libraries are pure.** Geometry in, geometry out. No gizmos, no hover UI, no knowledge of the editor. Reuse is `import { ringProfile } from "./jewelry"`.

**Scenes are programs that look at libraries.** A scene chooses a *scene type* (2D paper, SDF viewport, slicer, map, supports, …) and supplies **inputs** using that type’s **widget library**. Widgets live in the scene, not in the domain library:

```ts
// scene — may use euclid2 widgets
const A = editPoint(3, 4);
const t = editPointOnLine(seg, 0.3);
const r = editDistanceToPoint(A, 2);

// library — just math
export const shape = ringProfile({ inner: r, seam: t, origin: A });
```

**Identity, hover, and select are core.** The canvas must be able to say what you pointed at (`profile/seg[2]`, created at `lib.ts:40`) so a scene can bind widgets to it. Jump to source. Do not synthesize new math. Do not chase arbitrary expressions to infer handles.

**Declared editors only.** `editPoint`, `editDistanceToPoint`, `editPointOnLine`, and later cousins. Degrees of freedom are in the combinator. Plain `3` in a library is not a handle. Users mark what they want to edit.

**Views, not kernels, for domain tools.** Supports, hollowing, layout, maps, resin slicing are **optional scene packages** if someone implements them. The shell owes them a boring artifact (geometry, image, field, units) and pick IDs — not a built-in Lychee.

**Interop is converters with explicit types**, not a universal CAD kernel. PNG in or PNG out is a valid program. Mesh, curves, occupancy, slices, GeoJSON are later packages. Lossy is allowed if the type is honest. Units and conventions still need a house style or glue will silently scale by 1000.

**Source is the truth.** Widget drags rewrite literals in the *scene* file. Undo is the editor. No sidecar of slider state that can drift from git.

**Mouse is a caret, not a synthesizer.** Click-to-fill holes, extract-parameter, and “place on surface” are possible later. Sketch-n-Sketch-style trace inversion and output-directed refactoring are out of scope.

---

## Non-goals (product)

- Replacing Fusion, MatrixGold, Blender, or Lychee.
- A B-rep kernel, STEP, drawings, or shop-floor CAM.
- Built-in auto-supports, vat layout, or printer drivers.
- Inferring gizmos from whatever number appears in the AST.
- A visual node editor as the main UI.
- A hosted multiplayer canvas (running the open file is local, like a test runner).

---

## Shape of the system

```
lib/          pure domain code (rings, fields, images, …)
scenes/       programs that import libs and widgets
euclid2/      2D scene type: renderer, pick, widget library
euclid3/      3D scene type: Three.js view + editPoint3 / editDistance3
<other type>  another package with its own widgets + view
shell/        run a scene module, show one preview, apply text edits
```

The long-term analog of LSP is a small **artifact / pick protocol**: what this module exported, which edit sites it declared, what `pick(x,y)` hit. Scene types subscribe. euclid2 and euclid3 are two views of that idea; a later TypeGPU field view would be a third.

Repo layout: [LAYOUT.md](./LAYOUT.md).

GPU (TypeGPU), WASM kernels, and npm converters attach when a scene type needs them. They are not the identity of the project.

---

## How we work

Each prototype is an experiment: a short charter, a build, a postmortem. The next charter is written from the postmortem, not from a frozen architecture. This file is the stable *intent*. Immediate work lives in [PROTOTYPE_1.md](./PROTOTYPE_1.md). Postmortem: [PROTOTYPE_1_CONCLUSIONS.md](./PROTOTYPE_1_CONCLUSIONS.md).

Earlier adversarial notes (literal-vs-composition, fake SDFs, overlap with libfive/Zoo) are why libraries stay pure, editors are declared, and slicing/supports are views. They are not a spec.

---

## Success at the horizon (not this week)

A domain library with no UI; two different scene types looking at it; hover/select identity that a scene can bind; a drag in the scene file; an unrelated package able to consume an exported artifact (even a PNG) without a fork. If that loop works, “someone could add a support scene” is an extension point. If it does not, more scene types will not help.
